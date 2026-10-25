import { kinds, type Event as NostrEvent } from "nostr-tools";
import type { AbstractSimplePool } from "nostr-tools/abstract-pool";
import { isNip05, queryProfile } from "nostr-tools/nip05";
import { decodeNostrURI, type ProfilePointer } from "nostr-tools/nip19";
import { SimplePool } from "nostr-tools/pool";
import { isHex32, normalizeURL } from "nostr-tools/utils";
import * as z from "zod";

/** NIP-01 kind 0 plus the NIP-24 extra fields. Unknown keys pass through; a known key with the wrong type is dropped. */
const profileMetadataSchema = z.looseObject({
  name: z.string().optional().catch(undefined),
  display_name: z.string().optional().catch(undefined),
  about: z.string().optional().catch(undefined),
  picture: z.string().optional().catch(undefined),
  banner: z.string().optional().catch(undefined),
  website: z.string().optional().catch(undefined),
  nip05: z.string().optional().catch(undefined),
  lud16: z.string().optional().catch(undefined),
});

export type NostrProfileMetadata = z.infer<typeof profileMetadataSchema>;

export type NostrProfile = Required<ProfilePointer> & {
  metadata: NostrProfileMetadata;
  /** The kind 0 event the metadata came from. */
  event: NostrEvent;
};

export type FetchProfileOptions = {
  relays: readonly string[];
  timeoutMs?: number;
  /**
   * Also query the relays named by an nprofile or NIP-05 record, and resolve
   * NIP-05 identifiers at all. Both connect to hosts chosen by the input, so
   * only the browser turns this on.
   */
  followRelayHints?: boolean;
  /** When omitted a pool is opened and closed for the call. */
  pool?: AbstractSimplePool;
};

export const DEFAULT_RELAY_TIMEOUT_MS = 5_000;

const relayUrl = z.url({ protocol: /^wss?$/ });

const resolvePointer = async (
  input: string,
  followRelayHints: boolean,
): Promise<ProfilePointer | null> => {
  const value = input.trim();
  if (isHex32(value.toLowerCase())) return { pubkey: value.toLowerCase() };

  const decoded = decodeNostrURI(value);
  if (decoded.type === "npub") return { pubkey: decoded.data };
  if (decoded.type === "nprofile") return decoded.data;

  if (followRelayHints && isNip05(value)) return queryProfile(value);

  throw new Error(
    followRelayHints
      ? "Expected an npub, nprofile, hex pubkey or NIP-05 identifier"
      : "Expected an npub, nprofile or hex pubkey",
  );
};

/**
 * Resolve a profile reference and fetch its newest kind 0 event. Resolves to
 * `null` when the identity does not resolve or no relay has a usable profile.
 */
export const fetchProfile = async (
  input: string,
  {
    relays,
    timeoutMs = DEFAULT_RELAY_TIMEOUT_MS,
    followRelayHints = false,
    pool,
  }: FetchProfileOptions,
): Promise<NostrProfile | null> => {
  const pointer = await resolvePointer(input, followRelayHints);
  if (!pointer) return null;

  const isRelayUrl = (url: string) => relayUrl.safeParse(url).success;
  const hints = followRelayHints
    ? (pointer.relays ?? []).filter(isRelayUrl)
    : [];
  const urls = [
    ...new Set([...hints, ...relays.filter(isRelayUrl)].map(normalizeURL)),
  ];
  if (urls.length === 0) return null;

  const ownedPool = pool ? undefined : new SimplePool();
  try {
    const event = await (pool ?? (ownedPool as SimplePool)).get(
      urls,
      { kinds: [kinds.Metadata], authors: [pointer.pubkey] },
      { maxWait: timeoutMs },
    );
    if (!event) return null;
    const metadata = profileMetadataSchema.safeParse(JSON.parse(event.content));
    if (!metadata.success) return null;
    return {
      pubkey: pointer.pubkey,
      relays: hints,
      metadata: metadata.data,
      event,
    };
  } catch {
    return null;
  } finally {
    ownedPool?.close(urls);
  }
};
