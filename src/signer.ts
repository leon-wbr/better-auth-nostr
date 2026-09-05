import {
  getPublicKey as derivePublicKey,
  type EventTemplate,
  generateSecretKey,
  type Event as NostrEvent,
  nip19,
} from "nostr-tools";
import type { AbstractSimplePool } from "nostr-tools/abstract-pool";
import {
  type BunkerPointer,
  BunkerSigner,
  type ClientMetadata,
  createNostrConnectURI,
  parseBunkerInput,
  toBunkerURL,
} from "nostr-tools/nip46";
import { SimplePool } from "nostr-tools/pool";
import { PlainKeySigner, type Signer } from "nostr-tools/signer";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";

/**
 * Anything that can hand out a public key and sign an event: a local secret
 * key, a NIP-07 extension, or a NIP-46 remote signer. Deliberately wider than
 * `Signer` from `nostr-tools/signer` (which returns `VerifiedEvent`) so that
 * arbitrary caller-supplied signers fit; the assertion below keeps the two
 * compatible in the direction that matters.
 */
export interface NostrSigner {
  getPublicKey(): Promise<string>;
  signEvent(event: EventTemplate): Promise<NostrEvent>;
}

/** Fails to compile if upstream's `Signer` stops satisfying `NostrSigner`. */
const _signerCompat: NostrSigner = null as unknown as Signer;
void _signerCompat;

/** A signer backed by a live NIP-46 connection to a remote signer. */
export interface RemoteNostrSigner extends NostrSigner {
  /** Persist alongside `bunkerUri` to resume without a new approval prompt. */
  clientSecretKey: Uint8Array;
  /**
   * The connection as a `bunker://` URI, resolved after the handshake. Persist
   * it with `clientSecretKey` and hand both back to `createBunkerSigner` to
   * resume — this is the only way to resume a `nostrconnect://` session, whose
   * remote pubkey and relays are not known until the signer answers.
   */
  readonly bunkerUri: string;
  /** Closes the relay subscription, and the pool if we opened it. */
  close(): Promise<void>;
}

/**
 * `nostr-tools` validates a NIP-98 event's `created_at` against this window.
 * It is the *server's* constant, mirrored here so a doomed token can be
 * reported before it is sent — not a value defined by NIP-98 itself.
 */
export const NIP98_MAX_CLOCK_DRIFT_SECONDS = 60;

/** Reject a little before the server does, leaving room for network transit. */
const CLIENT_FRESHNESS_MARGIN_SECONDS = 5;

const DEFAULT_NOSTR_CONNECT_RELAYS = ["wss://relay.nsec.app"];

/** Enough to mint NIP-98 tokens; apps needing more can widen it. */
const DEFAULT_PERMS = ["sign_event:27235"];

/** How long to wait on a remote signer before giving up. */
export const DEFAULT_SIGNER_TIMEOUT_MS = 300_000;

type WindowNostr = {
  getPublicKey: () => Promise<string> | string;
  signEvent: (event: EventTemplate) => Promise<NostrEvent> | NostrEvent;
};

/**
 * NIP-46 requests park a promise until the signer answers over a relay, and
 * `nostr-tools` never times them out. Without this, an offline bunker or an
 * ignored approval prompt hangs the caller forever with no error at all.
 */
export const withTimeout = async <T>(
  work: Promise<T>,
  ms: number,
  message: string,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const parseSecretKey = (input: string): Uint8Array => {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Missing NSEC private key");

  const lower = trimmed.toLowerCase();
  if (nip19.NostrTypeGuard.isNSec(lower)) {
    // The type guard only checks the shape, so a bad checksum still reaches
    // decode() and would surface as a raw bech32 error.
    try {
      const decoded = nip19.decode(lower);
      if (decoded.type !== "nsec") throw new Error();
      return decoded.data;
    } catch {
      throw new Error("Invalid NSEC private key");
    }
  }

  if (/^[a-f0-9]{64}$/i.test(trimmed)) {
    return hexToBytes(trimmed.toLowerCase());
  }

  throw new Error("Invalid NSEC private key");
};

/** Signs locally with a raw secret key held in the browser. */
export const createPrivateKeySigner = (nsec: string): NostrSigner =>
  new PlainKeySigner(parseSecretKey(nsec));

const getExtension = (): WindowNostr | null => {
  if (typeof window === "undefined") return null;
  const ext = (window as unknown as { nostr?: WindowNostr }).nostr;
  return ext && typeof ext.signEvent === "function" ? ext : null;
};

/** Signs through a NIP-07 browser extension, if one is installed. */
export const createExtensionSigner = (): NostrSigner | null => {
  const ext = getExtension();
  if (!ext) return null;
  return {
    getPublicKey: async () => await ext.getPublicKey(),
    signEvent: async (event) => await ext.signEvent(event),
  };
};

export type SignerSource = {
  /** Any signer: a bunker session, a hardware signer, a test double. */
  signer?: NostrSigner;
  /** Bech32 nsec or 64-char hex secret. */
  nsec?: string;
  /** How long to wait for a signature before failing. */
  timeoutMs?: number;
};

/**
 * Picks the signer for a request: an explicitly passed one wins, then a raw
 * secret key, then a NIP-07 extension.
 */
export const resolveSigner = (source?: SignerSource): NostrSigner => {
  if (source?.signer) return source.signer;
  if (source?.nsec) return createPrivateKeySigner(source.nsec);
  const extension = createExtensionSigner();
  if (extension) return extension;
  throw new Error(
    "No signer available — pass `signer`, pass `nsec`, or install a NIP-07 extension",
  );
};

type RemoteTransportOptions = {
  /**
   * Client-side key used to talk to the remote signer. Persist it with
   * `signer.bunkerUri` to resume a session without a fresh approval prompt.
   */
  clientSecretKey?: Uint8Array;
  /** Called with a URL the user must open to approve the connection. */
  onAuthUrl?: (url: string) => void;
  /** NIP-46 permissions to request. Defaults to signing NIP-98 events only. */
  perms?: string[];
  /** Shown to the user by the remote signer while approving. */
  metadata?: ClientMetadata;
  /**
   * Relay pool to use. When omitted we open one and close it in `close()`;
   * when supplied, its lifetime stays yours.
   */
  pool?: AbstractSimplePool;
};

export type BunkerSignerOptions = RemoteTransportOptions & {
  /** How long to wait for the connection to be approved. */
  timeoutMs?: number;
};

const wrapBunker = (
  signer: BunkerSigner,
  clientSecretKey: Uint8Array,
  ownedPool?: SimplePool,
): RemoteNostrSigner => ({
  clientSecretKey,
  // A getter, because switchRelays() can rewrite `bp` after the handshake.
  get bunkerUri() {
    return toBunkerURL(signer.bp);
  },
  getPublicKey: () => signer.getPublicKey(),
  signEvent: (event) => signer.signEvent(event),
  close: async () => {
    await signer.close();
    ownedPool?.destroy();
  },
});

/**
 * `BunkerSigner.connect()` hardcodes an empty string in NIP-46's permission
 * slot, so requested permissions never reach the signer and it re-prompts on
 * every signature. Sending the request ourselves is state-equivalent —
 * `connect()` touches nothing else.
 */
const connectWithPerms = (
  signer: BunkerSigner,
  pointer: BunkerPointer,
  options: RemoteTransportOptions,
) =>
  signer.sendRequest("connect", [
    pointer.pubkey,
    pointer.secret ?? "",
    (options.perms ?? DEFAULT_PERMS).join(","),
    JSON.stringify(options.metadata ?? {}),
  ]);

/**
 * Connects to a NIP-46 remote signer the user already has, addressed by a
 * `bunker://` URI or a NIP-05 identifier (nsec.app, Amber, nsecbunker, …).
 */
export const createBunkerSigner = async (
  input: string,
  options: BunkerSignerOptions = {},
): Promise<RemoteNostrSigner> => {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Missing bunker:// URI or NIP-05 identifier");
  }

  const pointer: BunkerPointer | null = await parseBunkerInput(trimmed);
  if (!pointer) {
    throw new Error(
      `Not a bunker:// URI or a NIP-05 identifier with a NIP-46 provider: ${trimmed}`,
    );
  }
  if (pointer.relays.length === 0) {
    throw new Error(
      "bunker:// URI has no relay parameter — the remote signer cannot be reached",
    );
  }

  const clientSecretKey = options.clientSecretKey ?? generateSecretKey();
  const ownedPool = options.pool ? undefined : new SimplePool();
  const signer = BunkerSigner.fromBunker(clientSecretKey, pointer, {
    pool: options.pool ?? ownedPool,
    onauth: options.onAuthUrl,
  });

  try {
    await withTimeout(
      connectWithPerms(signer, pointer, options),
      options.timeoutMs ?? DEFAULT_SIGNER_TIMEOUT_MS,
      "The remote signer did not approve the connection in time",
    );
  } catch (error) {
    await signer.close().catch(() => {});
    ownedPool?.destroy();
    throw error;
  }

  return wrapBunker(signer, clientSecretKey, ownedPool);
};

export type NostrConnectOptions = RemoteTransportOptions & {
  /** Relays the remote signer should answer on. */
  relays?: string[];
  /** Connection secret. Generated when omitted. */
  secret?: string;
};

export type NostrConnectSession = {
  /** Show this to the user as a QR code or a copyable link. */
  uri: string;
  /** Persist this with the resulting signer's `bunkerUri` to resume later. */
  clientSecretKey: Uint8Array;
  /**
   * Resolves once the remote signer has approved the connection, and rejects
   * when the deadline passes. Call it once per session.
   */
  connect: (
    timeoutMsOrSignal?: number | AbortSignal,
  ) => Promise<RemoteNostrSigner>;
};

/**
 * Starts the client-initiated half of NIP-46: we mint a `nostrconnect://` URI
 * for the user to scan, then wait for the remote signer to reach out to us.
 *
 * URI generation is synchronous so the QR code can be rendered immediately;
 * nothing touches the network until `connect()` is awaited.
 */
export const createNostrConnectSession = (
  options: NostrConnectOptions = {},
): NostrConnectSession => {
  const relays = options.relays ?? DEFAULT_NOSTR_CONNECT_RELAYS;
  if (relays.length === 0) {
    throw new Error(
      "createNostrConnectSession: at least one relay is required",
    );
  }

  const clientSecretKey = options.clientSecretKey ?? generateSecretKey();
  const secret =
    options.secret ?? bytesToHex(crypto.getRandomValues(new Uint8Array(16)));

  const uri = createNostrConnectURI({
    clientPubkey: derivePublicKey(clientSecretKey),
    relays,
    secret,
    perms: options.perms ?? DEFAULT_PERMS,
    ...options.metadata,
  });

  let started = false;

  return {
    uri,
    clientSecretKey,
    connect: async (timeoutMsOrSignal = DEFAULT_SIGNER_TIMEOUT_MS) => {
      if (started) {
        throw new Error(
          "This nostrconnect:// session is already connecting — create a new one",
        );
      }
      started = true;

      // A number reaches nostr-tools as `maxWait`, which only drives the EOSE
      // and connection timeouts and never rejects. `abort` is the only path
      // wired to sub.close() → onclose → reject, so convert to a signal.
      const signal =
        typeof timeoutMsOrSignal === "number"
          ? AbortSignal.timeout(timeoutMsOrSignal)
          : timeoutMsOrSignal;

      const ownedPool = options.pool ? undefined : new SimplePool();
      try {
        const signer = await BunkerSigner.fromURI(
          clientSecretKey,
          uri,
          { pool: options.pool ?? ownedPool, onauth: options.onAuthUrl },
          signal,
        );
        return wrapBunker(signer, clientSecretKey, ownedPool);
      } catch (error) {
        ownedPool?.destroy();
        throw error;
      }
    },
  };
};

/**
 * Remote signers round-trip through a relay and often wait on a human tapping
 * "approve". NIP-98 stamps `created_at` before signing, so a slow approval
 * yields a token the server rejects with a bare 401. Catch that here and say
 * what actually happened.
 */
export const assertFreshlySigned = (event: NostrEvent): NostrEvent => {
  const driftSeconds = Math.round(Date.now() / 1000) - event.created_at;
  const limit = NIP98_MAX_CLOCK_DRIFT_SECONDS - CLIENT_FRESHNESS_MARGIN_SECONDS;
  if (Math.abs(driftSeconds) < limit) return event;

  throw new Error(
    driftSeconds > 0
      ? `The signer took too long to approve the request (signed event is ${driftSeconds}s old, the server accepts ${NIP98_MAX_CLOCK_DRIFT_SECONDS}s). Try again.`
      : `The signer's clock is ${Math.abs(driftSeconds)}s ahead of this device, so the server will reject its signature. Check the clock on your signing device.`,
  );
};
