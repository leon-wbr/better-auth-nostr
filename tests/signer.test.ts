import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
} from "nostr-tools";
import { verifyEvent } from "nostr-tools/pure";
import { bytesToHex } from "nostr-tools/utils";
import { describe, expect, it } from "vitest";
import {
  assertFreshlySigned,
  createBunkerSigner,
  createNostrConnectSession,
  createPrivateKeySigner,
  NIP98_MAX_CLOCK_DRIFT_SECONDS,
  resolveSigner,
} from "../src/signer";
import { makeKeypair } from "./helpers";

const template = {
  kind: 1,
  tags: [],
  content: "hello",
  created_at: Math.floor(Date.now() / 1000),
};

describe("createPrivateKeySigner", () => {
  it("exposes the pubkey of the given nsec", async () => {
    const sk = generateSecretKey();
    const signer = createPrivateKeySigner(nip19.nsecEncode(sk));
    expect(await signer.getPublicKey()).toBe(getPublicKey(sk));
  });

  it("produces a verifiable event", async () => {
    const sk = generateSecretKey();
    const signed = await createPrivateKeySigner(bytesToHex(sk)).signEvent(
      template,
    );
    expect(verifyEvent(signed)).toBe(true);
    expect(signed.pubkey).toBe(getPublicKey(sk));
  });

  it("rejects an invalid key eagerly", () => {
    expect(() => createPrivateKeySigner("not-an-nsec")).toThrow("Invalid NSEC");
  });
});

describe("resolveSigner", () => {
  it("prefers an explicit signer over an nsec", async () => {
    const sk = generateSecretKey();
    const custom = {
      getPublicKey: async () => "explicit",
      signEvent: async (t: typeof template) => finalizeEvent(t, sk),
    };
    const signer = resolveSigner({
      signer: custom,
      nsec: nip19.nsecEncode(sk),
    });
    expect(await signer.getPublicKey()).toBe("explicit");
  });

  it("falls back to the nsec when no signer is given", async () => {
    const sk = generateSecretKey();
    const signer = resolveSigner({ nsec: nip19.nsecEncode(sk) });
    expect(await signer.getPublicKey()).toBe(getPublicKey(sk));
  });

  it("throws an actionable error when nothing is available", () => {
    expect(() => resolveSigner()).toThrow(/NIP-07/);
    expect(() => resolveSigner()).toThrow(/signer/i);
  });
});

describe("createBunkerSigner input validation", () => {
  it("rejects an empty input", async () => {
    await expect(createBunkerSigner("  ")).rejects.toThrow(/bunker/i);
  });

  it("rejects a string that is neither a bunker URI nor a NIP-05", async () => {
    await expect(createBunkerSigner("totally-not-a-bunker")).rejects.toThrow(
      /bunker:\/\//,
    );
  });

  it("rejects a bunker URI without a relay, before opening a connection", async () => {
    const pubkey = makeKeypair().publicKey;
    await expect(createBunkerSigner(`bunker://${pubkey}`)).rejects.toThrow(
      /relay/i,
    );
  });
});

describe("createNostrConnectSession", () => {
  it("builds a nostrconnect:// URI the signer can scan", () => {
    const session = createNostrConnectSession({
      relays: ["wss://relay.example.com"],
      perms: ["sign_event:27235"],
      metadata: { name: "Test App" },
    });

    const url = new URL(session.uri);
    expect(url.protocol).toBe("nostrconnect:");
    expect(url.hostname || url.pathname.replace(/\//g, "")).toBe(
      getPublicKey(session.clientSecretKey),
    );
    expect(url.searchParams.getAll("relay")).toEqual([
      "wss://relay.example.com",
    ]);
    expect(url.searchParams.get("secret")).toBeTruthy();
    expect(url.searchParams.get("perms")).toBe("sign_event:27235");
    expect(url.searchParams.get("name")).toBe("Test App");
  });

  it("defaults to a usable relay so the URI is never relay-less", () => {
    const session = createNostrConnectSession();
    expect(
      new URL(session.uri).searchParams.getAll("relay").length,
    ).toBeGreaterThan(0);
  });

  it("reuses a caller-supplied client key so sessions can be persisted", () => {
    const clientSecretKey = generateSecretKey();
    const session = createNostrConnectSession({ clientSecretKey });
    expect(bytesToHex(session.clientSecretKey)).toBe(
      bytesToHex(clientSecretKey),
    );
  });

  it("mints a fresh secret per session", () => {
    const secretOf = (uri: string) => new URL(uri).searchParams.get("secret");
    expect(secretOf(createNostrConnectSession().uri)).not.toBe(
      secretOf(createNostrConnectSession().uri),
    );
  });

  it("rejects an empty relay list rather than emitting an unusable URI", () => {
    expect(() => createNostrConnectSession({ relays: [] })).toThrow(/relay/i);
  });
});

/**
 * Stands in for a relay pool. `subscribe` hands back a closer and never
 * delivers a response, which is what an offline bunker looks like from here.
 * The abort wiring mirrors abstract-relay's: aborting closes the subscription,
 * which fires `onclose`.
 */
const stubPool = (onSubscribe?: (params: any) => void) => {
  const pool: any = {
    destroyed: false,
    subscribe: (_relays: string[], _filter: unknown, params: any) => {
      onSubscribe?.(params);
      params?.abort?.addEventListener?.("abort", () =>
        params.onclose?.("aborted"),
      );
      return { close: () => {} };
    },
    publish: () => [Promise.resolve("ok")],
    destroy: () => {
      pool.destroyed = true;
    },
  };
  return pool;
};

const bunkerUriFor = (pubkey: string) =>
  `bunker://${pubkey}?relay=wss://relay.example.com`;

describe("remote signer timeouts", () => {
  it("gives up on a bunker that never answers instead of hanging", async () => {
    const pool = stubPool();
    const pubkey = makeKeypair().publicKey;

    await expect(
      createBunkerSigner(bunkerUriFor(pubkey), { pool, timeoutMs: 50 }),
    ).rejects.toThrow(/in time/i);
  });

  it("leaves a caller-supplied pool open after a failed connect", async () => {
    const pool = stubPool();
    const pubkey = makeKeypair().publicKey;

    await createBunkerSigner(bunkerUriFor(pubkey), {
      pool,
      timeoutMs: 50,
    }).catch(() => {});

    expect(pool.destroyed).toBe(false);
  });

  it("converts a numeric connect() deadline into an AbortSignal", async () => {
    // A number reaches nostr-tools as `maxWait`, which never rejects; only
    // `abort` is wired to a close-and-reject path.
    let seen: any;
    const pool = stubPool((params) => {
      seen = params;
    });
    const session = createNostrConnectSession({
      relays: ["wss://relay.example.com"],
      pool,
    });

    await expect(session.connect(50)).rejects.toThrow();
    expect(seen.abort).toBeInstanceOf(AbortSignal);
    expect(seen.maxWait).toBeUndefined();
  });

  it("rejects a second connect() on the same session", async () => {
    const session = createNostrConnectSession({
      relays: ["wss://relay.example.com"],
      pool: stubPool(),
    });

    await session.connect(50).catch(() => {});
    await expect(session.connect(50)).rejects.toThrow(/already connecting/i);
  });
});

describe("assertFreshlySigned", () => {
  const at = (offsetSeconds: number) =>
    ({
      created_at: Math.round(Date.now() / 1000) - offsetSeconds,
    }) as any;

  it("accepts an event signed just now", () => {
    expect(assertFreshlySigned(at(0))).toBeDefined();
  });

  it("accepts an event comfortably inside the window", () => {
    expect(assertFreshlySigned(at(30))).toBeDefined();
  });

  it("rejects before the server's limit, leaving room for transit", () => {
    expect(() =>
      assertFreshlySigned(at(NIP98_MAX_CLOCK_DRIFT_SECONDS - 1)),
    ).toThrow(/too long/i);
  });

  it("names the clock, not the approval, when the signer runs ahead", () => {
    expect(() => assertFreshlySigned(at(-120))).toThrow(/clock/i);
  });
});
