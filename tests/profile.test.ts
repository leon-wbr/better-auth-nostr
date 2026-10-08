import { finalizeEvent, nip19 } from "nostr-tools";
import { useFetchImplementation } from "nostr-tools/nip05";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PROFILE_RELAYS, fetchProfile } from "../src/profile";
import { makeKeypair } from "./helpers";

const metadataEvent = (
  keypair: ReturnType<typeof makeKeypair>,
  content: string,
  created_at = 1_700_000_000,
) =>
  finalizeEvent({ kind: 0, created_at, tags: [], content }, keypair.secretKey);

const fakePool = (events: ReturnType<typeof metadataEvent>[]) => {
  const calls: { relays: string[]; filter: any }[] = [];
  return {
    calls,
    querySync: async (relays: string[], filter: any) => {
      calls.push({ relays, filter });
      return events;
    },
  } as any;
};

const originalFetch = globalThis.fetch;
afterEach(() => useFetchImplementation(originalFetch));

describe("fetchProfile", () => {
  it("fetches kind 0 for an npub from the default relays", async () => {
    const kp = makeKeypair();
    const pool = fakePool([metadataEvent(kp, '{"name":"alice"}')]);

    const profile = await fetchProfile(nip19.npubEncode(kp.publicKey), {
      pool,
    });

    expect(profile?.pubkey).toBe(kp.publicKey);
    expect(profile?.metadata).toEqual({ name: "alice" });
    expect(pool.calls[0].relays).toEqual(DEFAULT_PROFILE_RELAYS);
    expect(pool.calls[0].filter).toEqual({
      kinds: [0],
      authors: [kp.publicKey],
    });
  });

  it("accepts a hex pubkey", async () => {
    const kp = makeKeypair();
    const profile = await fetchProfile(kp.publicKey, {
      pool: fakePool([metadataEvent(kp, '{"name":"hex"}')]),
    });
    expect(profile?.metadata.name).toBe("hex");
  });

  it("queries the relays carried by an nprofile, ahead of the defaults", async () => {
    const kp = makeKeypair();
    const pool = fakePool([metadataEvent(kp, "{}")]);
    const nprofile = nip19.nprofileEncode({
      pubkey: kp.publicKey,
      relays: ["wss://hint.example"],
    });

    const profile = await fetchProfile(nprofile, { pool });

    expect(pool.calls[0].relays).toEqual([
      "wss://hint.example",
      ...DEFAULT_PROFILE_RELAYS,
    ]);
    expect(profile?.relays).toEqual(["wss://hint.example"]);
  });

  it("resolves a NIP-05 identifier and uses its relay hints", async () => {
    const kp = makeKeypair();
    useFetchImplementation(async () =>
      Response.json({
        names: { alice: kp.publicKey },
        relays: { [kp.publicKey]: ["wss://nip05.example"] },
      }),
    );
    const pool = fakePool([metadataEvent(kp, '{"nip05":"alice@example.com"}')]);

    const profile = await fetchProfile("alice@example.com", { pool });

    expect(profile?.pubkey).toBe(kp.publicKey);
    expect(pool.calls[0].relays[0]).toBe("wss://nip05.example");
  });

  it("returns null when a NIP-05 identifier does not resolve", async () => {
    useFetchImplementation(async () => Response.json({ names: {} }));
    expect(
      await fetchProfile("ghost@example.com", { pool: fakePool([]) }),
    ).toBeNull();
  });

  it("returns null when no relay has a profile", async () => {
    const kp = makeKeypair();
    expect(await fetchProfile(kp.publicKey, { pool: fakePool([]) })).toBeNull();
  });

  it("uses the newest event when relays disagree", async () => {
    const kp = makeKeypair();
    const profile = await fetchProfile(kp.publicKey, {
      pool: fakePool([
        metadataEvent(kp, '{"name":"new"}', 200),
        metadataEvent(kp, '{"name":"old"}', 100),
      ]),
    });
    expect(profile?.metadata.name).toBe("new");
  });

  it("ignores events from other authors", async () => {
    const kp = makeKeypair();
    const other = makeKeypair();
    const profile = await fetchProfile(kp.publicKey, {
      pool: fakePool([metadataEvent(other, '{"name":"impostor"}')]),
    });
    expect(profile).toBeNull();
  });

  it("skips events whose content is not a JSON object", async () => {
    const kp = makeKeypair();
    const profile = await fetchProfile(kp.publicKey, {
      pool: fakePool([
        metadataEvent(kp, "not json", 200),
        metadataEvent(kp, '{"name":"ok"}', 100),
      ]),
    });
    expect(profile?.metadata.name).toBe("ok");
  });

  it("rejects input it cannot interpret", async () => {
    await expect(
      fetchProfile("nonsense", { pool: fakePool([]) }),
    ).rejects.toThrow(/npub|nprofile|NIP-05/);
  });

  it("rejects an nsec rather than treating it as a pubkey", async () => {
    const kp = makeKeypair();
    await expect(
      fetchProfile(nip19.nsecEncode(kp.secretKey), { pool: fakePool([]) }),
    ).rejects.toThrow();
  });

  it("discards malformed relay hints and still queries the valid relays", async () => {
    const kp = makeKeypair();
    const pool = fakePool([metadataEvent(kp, '{"name":"ok"}')]);
    const nprofile = nip19.nprofileEncode({
      pubkey: kp.publicKey,
      relays: ["wss://[", "http://not-a-relay.example", "wss://hint.example"],
    });

    const profile = await fetchProfile(nprofile, {
      pool,
      relays: ["not a url", "wss://own.example"],
    });

    expect(pool.calls[0].relays).toEqual([
      "wss://hint.example",
      "wss://own.example",
    ]);
    expect(profile?.relays).toEqual(["wss://hint.example"]);
  });

  it("does not hang on a malformed hint when no usable relay remains", async () => {
    const kp = makeKeypair();
    const nprofile = nip19.nprofileEncode({
      pubkey: kp.publicKey,
      relays: ["wss://["],
    });

    const result = await Promise.race([
      fetchProfile(nprofile, { relays: [], timeoutMs: 50 }),
      new Promise((resolve) => setTimeout(() => resolve("hung"), 1_000)),
    ]);

    expect(result).toBeNull();
  });

  it("omits known metadata fields that are not strings, keeping unknown ones", async () => {
    const kp = makeKeypair();
    const profile = await fetchProfile(kp.publicKey, {
      pool: fakePool([
        metadataEvent(
          kp,
          '{"name":42,"picture":{},"about":"hi","custom":{"a":1}}',
        ),
      ]),
    });

    expect(profile?.metadata).toEqual({ about: "hi", custom: { a: 1 } });
  });
});
