import {
  getPublicKey as derivePublicKey,
  type EventTemplate,
  finalizeEvent,
  generateSecretKey,
  type Event as NostrEvent,
  nip19,
} from "nostr-tools";
import type { AbstractSimplePool } from "nostr-tools/abstract-pool";
import {
  type BunkerPointer,
  BunkerSigner,
  createNostrConnectURI,
  parseBunkerInput,
} from "nostr-tools/nip46";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import type { NostrSigner, RemoteNostrSigner } from "./types";

/** NIP-98 servers accept an event whose `created_at` is within 60s of now. */
export const NIP98_MAX_CLOCK_DRIFT_SECONDS = 60;

const DEFAULT_NOSTR_CONNECT_RELAYS = ["wss://relay.nsec.app"];

/** Enough to mint NIP-98 tokens; apps needing more can widen it. */
const DEFAULT_PERMS = ["sign_event:27235"];

type WindowNostr = {
  getPublicKey: () => Promise<string> | string;
  signEvent: (event: EventTemplate) => Promise<NostrEvent> | NostrEvent;
};

export const parseSecretKey = (input: string): Uint8Array => {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Missing NSEC private key");

  const lower = trimmed.toLowerCase();
  if (nip19.NostrTypeGuard.isNSec(lower)) {
    const decoded = nip19.decode(lower);
    if (decoded.type !== "nsec") {
      throw new Error("Invalid NSEC private key");
    }
    return decoded.data;
  }

  if (/^[a-f0-9]{64}$/i.test(trimmed)) {
    return hexToBytes(trimmed.toLowerCase());
  }

  throw new Error("Invalid NSEC private key");
};

/** Signs locally with a raw secret key held in the browser. */
export const createPrivateKeySigner = (nsec: string): NostrSigner => {
  const secretKey = parseSecretKey(nsec);
  return {
    getPublicKey: async () => derivePublicKey(secretKey),
    signEvent: async (event) => finalizeEvent(event, secretKey),
  };
};

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

export type BunkerSignerOptions = {
  /**
   * Client-side key used to talk to the remote signer. Persist
   * `signer.clientSecretKey` and pass it back to resume a session without a
   * fresh approval prompt.
   */
  clientSecretKey?: Uint8Array;
  /** Called with a URL the user must open to approve the connection. */
  onAuthUrl?: (url: string) => void;
  /** Metadata shown to the user by the remote signer. */
  metadata?: { name?: string; url?: string; image?: string };
  pool?: AbstractSimplePool;
};

const wrapBunker = (
  signer: BunkerSigner,
  clientSecretKey: Uint8Array,
): RemoteNostrSigner => ({
  clientSecretKey,
  getPublicKey: () => signer.getPublicKey(),
  signEvent: (event) => signer.signEvent(event),
  close: () => signer.close(),
});

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
  const signer = BunkerSigner.fromBunker(clientSecretKey, pointer, {
    pool: options.pool,
    onauth: options.onAuthUrl,
  });

  try {
    await signer.connect(options.metadata);
  } catch (error) {
    await signer.close().catch(() => {});
    throw error;
  }

  return wrapBunker(signer, clientSecretKey);
};

export type NostrConnectOptions = Omit<BunkerSignerOptions, "metadata"> & {
  /** Relays the remote signer should answer on. */
  relays?: string[];
  /** NIP-46 permissions to request. Defaults to signing NIP-98 events only. */
  perms?: string[];
  /** Shown to the user by the remote signer while approving. */
  name?: string;
  url?: string;
  image?: string;
  /** Connection secret. Generated when omitted. */
  secret?: string;
};

export type NostrConnectSession = {
  /** Show this to the user as a QR code or a copyable link. */
  uri: string;
  /** Persist this to resume the session later. */
  clientSecretKey: Uint8Array;
  /** Resolves once the remote signer has approved the connection. */
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
  const secret = options.secret ?? bytesToHex(generateSecretKey()).slice(0, 32);

  const uri = createNostrConnectURI({
    clientPubkey: derivePublicKey(clientSecretKey),
    relays,
    secret,
    perms: options.perms ?? DEFAULT_PERMS,
    name: options.name,
    url: options.url,
    image: options.image,
  });

  return {
    uri,
    clientSecretKey,
    connect: async (timeoutMsOrSignal) => {
      const signer = await BunkerSigner.fromURI(
        clientSecretKey,
        uri,
        { pool: options.pool, onauth: options.onAuthUrl },
        timeoutMsOrSignal,
      );
      return wrapBunker(signer, clientSecretKey);
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
  const ageSeconds = Math.abs(Math.round(Date.now() / 1000) - event.created_at);
  if (ageSeconds >= NIP98_MAX_CLOCK_DRIFT_SECONDS) {
    throw new Error(
      `The signer took too long to approve the request (signed event is ${ageSeconds}s old, the server accepts ${NIP98_MAX_CLOCK_DRIFT_SECONDS}s). Try again.`,
    );
  }
  return event;
};
