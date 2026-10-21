import { type Event as NostrEvent, nip19, verifyEvent } from "nostr-tools";
import type { AbstractSimplePool } from "nostr-tools/abstract-pool";
import { isNip05, queryProfile } from "nostr-tools/nip05";
import { SimplePool } from "nostr-tools/pool";

/** Fields from NIP-01 and common usage; relays may carry arbitrary others. */
export type NostrProfileMetadata = {
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  banner?: string;
  website?: string;
  nip05?: string;
  lud16?: string;
  [key: string]: unknown;
};

export type NostrProfile = {
  pubkey: string;
  /** Relay hints from the nprofile or NIP-05 record, if any. */
  relays: string[];
  metadata: NostrProfileMetadata;
  /** The kind 0 event the metadata came from. */
  event: NostrEvent;
};

export type FetchProfileOptions = {
  /** Relays queried after any hints carried by the input. */
  relays?: string[];
  /** Relay pool to use; when omitted one is opened and closed for the call. */
  pool?: Pick<AbstractSimplePool, "querySync">;
  /** How long to wait on relays. */
  timeoutMs?: number;
};

export const DEFAULT_PROFILE_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nsec.app",
];

const DEFAULT_TIMEOUT_MS = 5_000;

const KNOWN_STRING_FIELDS = [
  "name",
  "display_name",
  "about",
  "picture",
  "banner",
  "website",
  "nip05",
  "lud16",
] as const;

const unique = (values: string[]) => [...new Set(values)];

export const hasUrlProtocol = (
  value: unknown,
  protocols: string[],
): value is string => {
  if (typeof value !== "string") return false;
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

const isRelayUrl = (value: unknown): value is string =>
  hasUrlProtocol(value, ["wss:", "ws:"]);

const resolvePointer = async (
  input: string,
): Promise<{ pubkey: string; relays: string[] } | null> => {
  const value = input.trim();
  const lower = value.toLowerCase();

  if (/^[a-f0-9]{64}$/.test(lower)) return { pubkey: lower, relays: [] };

  if (lower.startsWith("npub1") || lower.startsWith("nprofile1")) {
    let decoded: ReturnType<typeof nip19.decode>;
    try {
      decoded = nip19.decode(lower);
    } catch {
      throw new Error("Invalid npub or nprofile");
    }
    if (decoded.type === "npub") return { pubkey: decoded.data, relays: [] };
    if (decoded.type === "nprofile") {
      return {
        pubkey: decoded.data.pubkey,
        relays: decoded.data.relays ?? [],
      };
    }
  }

  if (isNip05(value)) {
    const pointer = await queryProfile(value);
    return pointer
      ? { pubkey: pointer.pubkey, relays: pointer.relays ?? [] }
      : null;
  }

  throw new Error(
    "Unrecognised profile reference — expected an npub, nprofile, hex pubkey or NIP-05 identifier",
  );
};

const parseMetadata = (content: string): NostrProfileMetadata | null => {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const metadata = { ...parsed } as NostrProfileMetadata;
    for (const field of KNOWN_STRING_FIELDS) {
      if (field in metadata && typeof metadata[field] !== "string") {
        delete metadata[field];
      }
    }
    return metadata;
  } catch {
    return null;
  }
};

/**
 * Resolve an npub, nprofile, hex pubkey or NIP-05 identifier and fetch its
 * kind 0 profile metadata. Resolves to `null` when the identity cannot be
 * resolved or no relay holds a usable profile.
 */
export const fetchProfile = async (
  input: string,
  options: FetchProfileOptions = {},
): Promise<NostrProfile | null> => {
  const pointer = await resolvePointer(input);
  if (!pointer) return null;

  const hints = pointer.relays.filter(isRelayUrl);
  const relays = unique([
    ...hints,
    ...(options.relays ?? DEFAULT_PROFILE_RELAYS).filter(isRelayUrl),
  ]);
  if (relays.length === 0) return null;
  const ownedPool = options.pool ? undefined : new SimplePool();
  const pool = options.pool ?? (ownedPool as SimplePool);

  try {
    const events = await pool.querySync(
      relays,
      { kinds: [0], authors: [pointer.pubkey] },
      { maxWait: options.timeoutMs ?? DEFAULT_TIMEOUT_MS },
    );

    const candidates = events
      .filter((e) => e.kind === 0 && e.pubkey === pointer.pubkey)
      .sort((a, b) => b.created_at - a.created_at);

    for (const event of candidates) {
      const metadata = parseMetadata(event.content);
      if (metadata && verifyEvent(event)) {
        return {
          pubkey: pointer.pubkey,
          relays: hints,
          metadata,
          event,
        };
      }
    }
    return null;
  } finally {
    ownedPool?.close(relays);
  }
};
