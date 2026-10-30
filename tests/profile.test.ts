import { finalizeEvent, nip19 } from "nostr-tools";
import { useFetchImplementation } from "nostr-tools/nip05";
import { afterEach, describe, expect, it } from "vitest";
import { fetchProfile } from "../src/profile";
import { makeKeypair } from "./helpers";

const RELAYS = ["wss://relay.example.com"];

const metadataEvent = (
  keypair: ReturnType<typeof makeKeypair>,
  content: string,
  created_at = 1_700_000_000,
) =>
  finalizeEvent({ kind: 0, created_at, tags: [], content }, keypair.secretKey);

const fakePool = (event: ReturnType<typeof metadataEvent> | null) => {
  const calls: { relays: string[]; filter: any; params: any }[] = [];
  return {
    calls,
    get: async (relays: string[], filter: any, params: any) => {
      calls.push({ relays, filter, params });
      return event;
    },
  } as any;
};

const originalFetch = globalThis.fetch;
afterEach(() => useFetchImplementation(originalFetch));

describe("fetchProfile", () => {
  it("fetches kind 0 for an npub from the given relays", async () => {
    const kp = makeKeypair();
    const pool = fakePool(metadataEvent(kp, '{"name":"alice"}'));

    const profile = await fetchProfile(nip19.npubEncode(kp.publicKey), {
      relays: RELAYS,
      pool,
    });

    expect(profile?.pubkey).toBe(kp.publicKey);
    expect(profile?.metadata).toEqual({ name: "alice" });
    expect(pool.calls[0].relays).toEqual(["wss://relay.example.com/"]);
    expect(pool.calls[0].filter).toEqual({
      kinds: [0],
      authors: [kp.publicKey],
    });
    expect(pool.calls[0].params).toEqual({ maxWait: 5_000 });
  });

  it("passes the timeout to the pool", async () => {
    const kp = makeKeypair();
    const pool = fakePool(null);
    await fetchProfile(kp.publicKey, { relays: RELAYS, timeoutMs: 1234, pool });
    expect(pool.calls[0].params).toEqual({ maxWait: 1234 });
  });

  it("accepts a hex pubkey in either case", async () => {
    const kp = makeKeypair();
    const profile = await fetchProfile(kp.publicKey.toUpperCase(), {
      relays: RELAYS,
      pool: fakePool(metadataEvent(kp, '{"name":"hex"}')),
    });
    expect(profile?.pubkey).toBe(kp.publicKey);
    expect(profile?.metadata.name).toBe("hex");
  });

  it("accepts a nostr: URI", async () => {
    const kp = makeKeypair();
    const profile = await fetchProfile(
      `nostr:${nip19.npubEncode(kp.publicKey)}`,
      { relays: RELAYS, pool: fakePool(metadataEvent(kp, "{}")) },
    );
    expect(profile?.pubkey).toBe(kp.publicKey);
  });

  it("queries the relays carried by an nprofile when following hints", async () => {
    const kp = makeKeypair();
    const pool = fakePool(metadataEvent(kp, "{}"));
    const nprofile = nip19.nprofileEncode({
      pubkey: kp.publicKey,
      relays: ["wss://hint.example"],
    });

    const profile = await fetchProfile(nprofile, {
      relays: RELAYS,
      followRelayHints: true,
      pool,
    });

    expect(pool.calls[0].relays).toEqual([
      "wss://hint.example/",
      "wss://relay.example.com/",
    ]);
    expect(profile?.relays).toEqual(["wss://hint.example"]);
  });

  it("ignores nprofile hints unless told to follow them", async () => {
    const kp = makeKeypair();
    const pool = fakePool(metadataEvent(kp, "{}"));
    const nprofile = nip19.nprofileEncode({
      pubkey: kp.publicKey,
      relays: ["wss://attacker.example"],
    });

    const profile = await fetchProfile(nprofile, { relays: RELAYS, pool });

    expect(pool.calls[0].relays).toEqual(["wss://relay.example.com/"]);
    expect(profile?.relays).toEqual([]);
  });

  it("resolves a NIP-05 identifier and uses its relay hints", async () => {
    const kp = makeKeypair();
    useFetchImplementation(async () =>
      Response.json({
        names: { alice: kp.publicKey },
        relays: { [kp.publicKey]: ["wss://nip05.example"] },
      }),
    );
    const pool = fakePool(metadataEvent(kp, '{"nip05":"alice@example.com"}'));

    const profile = await fetchProfile("alice@example.com", {
      relays: RELAYS,
      followRelayHints: true,
      pool,
    });

    expect(profile?.pubkey).toBe(kp.publicKey);
    expect(pool.calls[0].relays[0]).toBe("wss://nip05.example/");
  });

  it("never resolves NIP-05 unless following hints", async () => {
    let fetched = false;
    useFetchImplementation(async () => {
      fetched = true;
      return Response.json({ names: {} });
    });

    await expect(
      fetchProfile("alice@example.com", {
        relays: RELAYS,
        pool: fakePool(null),
      }),
    ).rejects.toThrow(/npub/);
    expect(fetched).toBe(false);
  });

  it("returns null when a NIP-05 identifier does not resolve", async () => {
    useFetchImplementation(async () => Response.json({ names: {} }));
    expect(
      await fetchProfile("ghost@example.com", {
        relays: RELAYS,
        followRelayHints: true,
        pool: fakePool(null),
      }),
    ).toBeNull();
  });

  it("returns null when no relay has a profile", async () => {
    const kp = makeKeypair();
    expect(
      await fetchProfile(kp.publicKey, {
        relays: RELAYS,
        pool: fakePool(null),
      }),
    ).toBeNull();
  });

  it("returns null when the relay query fails", async () => {
    const kp = makeKeypair();
    const pool = {
      get: async () => {
        throw new Error("relay down");
      },
    } as any;
    expect(
      await fetchProfile(kp.publicKey, { relays: RELAYS, pool }),
    ).toBeNull();
  });

  it.each([
    "not json",
    "[1,2]",
    "null",
  ])("returns null when the content is %s", async (content) => {
    const kp = makeKeypair();
    const profile = await fetchProfile(kp.publicKey, {
      relays: RELAYS,
      pool: fakePool(metadataEvent(kp, content)),
    });
    expect(profile).toBeNull();
  });

  it("rejects input it cannot interpret", async () => {
    await expect(
      fetchProfile("nonsense", {
        relays: RELAYS,
        followRelayHints: true,
        pool: fakePool(null),
      }),
    ).rejects.toThrow(/npub|nprofile|NIP-05/);
  });

  it("rejects an nsec rather than treating it as a pubkey", async () => {
    const kp = makeKeypair();
    await expect(
      fetchProfile(nip19.nsecEncode(kp.secretKey), {
        relays: RELAYS,
        pool: fakePool(null),
      }),
    ).rejects.toThrow();
  });

  it("discards malformed relay URLs and de-duplicates the rest", async () => {
    const kp = makeKeypair();
    const pool = fakePool(metadataEvent(kp, '{"name":"ok"}'));
    const nprofile = nip19.nprofileEncode({
      pubkey: kp.publicKey,
      relays: ["wss://[", "http://not-a-relay.example", "wss://hint.example"],
    });

    const profile = await fetchProfile(nprofile, {
      relays: ["not a url", "wss://own.example", "wss://hint.example/"],
      followRelayHints: true,
      pool,
    });

    expect(pool.calls[0].relays).toEqual([
      "wss://hint.example/",
      "wss://own.example/",
    ]);
    expect(profile?.relays).toEqual(["wss://hint.example"]);
  });

  it("returns null without querying when no usable relay remains", async () => {
    const kp = makeKeypair();
    const pool = fakePool(null);
    const nprofile = nip19.nprofileEncode({
      pubkey: kp.publicKey,
      relays: ["wss://["],
    });

    expect(
      await fetchProfile(nprofile, {
        relays: [],
        followRelayHints: true,
        pool,
      }),
    ).toBeNull();
    expect(pool.calls).toHaveLength(0);
  });

  it("drops known metadata fields that are not strings, keeping unknown ones", async () => {
    const kp = makeKeypair();
    const profile = await fetchProfile(kp.publicKey, {
      relays: RELAYS,
      pool: fakePool(
        metadataEvent(
          kp,
          '{"name":42,"picture":{},"about":"hi","custom":{"a":1}}',
        ),
      ),
    });

    expect(profile?.metadata).toEqual({ about: "hi", custom: { a: 1 } });
  });
});
