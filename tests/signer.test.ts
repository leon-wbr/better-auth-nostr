import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
} from "nostr-tools";
import { BunkerSigner } from "nostr-tools/nip46";
import { verifyEvent } from "nostr-tools/pure";
import { bytesToHex } from "nostr-tools/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertFreshlySigned,
  createBunkerSigner,
  createExtensionSigner,
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
  // Only Date is faked: relay and signer timeouts still need real timers.
  const NOW_SECONDS = 1_800_000_000;
  const LIMIT = NIP98_MAX_CLOCK_DRIFT_SECONDS - 5;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_SECONDS * 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const at = (offsetSeconds: number) =>
    ({ created_at: NOW_SECONDS - offsetSeconds }) as any;

  it("accepts an event signed just now", () => {
    expect(assertFreshlySigned(at(0))).toBeDefined();
  });

  it("accepts an event one second inside the window", () => {
    expect(assertFreshlySigned(at(LIMIT - 1))).toBeDefined();
  });

  it("rejects an event exactly at the window edge, leaving room for transit", () => {
    expect(() => assertFreshlySigned(at(LIMIT))).toThrow(/too long/i);
  });

  it("rejects well before the server's own limit", () => {
    expect(LIMIT).toBeLessThan(NIP98_MAX_CLOCK_DRIFT_SECONDS);
    expect(() =>
      assertFreshlySigned(at(NIP98_MAX_CLOCK_DRIFT_SECONDS - 1)),
    ).toThrow(/too long/i);
  });

  it("accepts a signer clock one second inside the future window", () => {
    expect(assertFreshlySigned(at(-(LIMIT - 1)))).toBeDefined();
  });

  it("names the clock, not the approval, when the signer runs ahead", () => {
    expect(() => assertFreshlySigned(at(-LIMIT))).toThrow(/clock/i);
    expect(() => assertFreshlySigned(at(-120))).toThrow(/clock/i);
  });

  it("rounds the current time to the nearest second", () => {
    vi.setSystemTime(NOW_SECONDS * 1000 + 499);
    expect(assertFreshlySigned(at(LIMIT - 1))).toBeDefined();
    vi.setSystemTime(NOW_SECONDS * 1000 + 500);
    expect(() => assertFreshlySigned(at(LIMIT - 1))).toThrow(/too long/i);
  });
});

describe("createExtensionSigner", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const signed = { ...template, id: "id", pubkey: "pk", sig: "sig" };

  it("returns null when there is no window", () => {
    expect(createExtensionSigner()).toBeNull();
  });

  it("returns null when window.nostr cannot sign", () => {
    vi.stubGlobal("window", { nostr: { getPublicKey: () => "pk" } });
    expect(createExtensionSigner()).toBeNull();
  });

  it("delegates getPublicKey to window.nostr, sync or async", async () => {
    vi.stubGlobal("window", {
      nostr: { getPublicKey: () => "sync-pk", signEvent: vi.fn() },
    });
    expect(await createExtensionSigner()?.getPublicKey()).toBe("sync-pk");

    vi.stubGlobal("window", {
      nostr: { getPublicKey: async () => "async-pk", signEvent: vi.fn() },
    });
    expect(await createExtensionSigner()?.getPublicKey()).toBe("async-pk");
  });

  it("passes the event template to signEvent and returns its result", async () => {
    const signEvent = vi.fn().mockResolvedValue(signed);
    vi.stubGlobal("window", { nostr: { getPublicKey: vi.fn(), signEvent } });

    await expect(createExtensionSigner()?.signEvent(template)).resolves.toBe(
      signed,
    );
    expect(signEvent).toHaveBeenCalledExactlyOnceWith(template);
  });

  it("propagates the extension's rejections", async () => {
    vi.stubGlobal("window", {
      nostr: {
        getPublicKey: vi.fn().mockRejectedValue(new Error("locked")),
        signEvent: vi.fn().mockRejectedValue(new Error("user denied")),
      },
    });
    const signer = createExtensionSigner();
    await expect(signer?.getPublicKey()).rejects.toThrow("locked");
    await expect(signer?.signEvent(template)).rejects.toThrow("user denied");
  });

  it("is what resolveSigner falls back to", async () => {
    vi.stubGlobal("window", {
      nostr: { getPublicKey: () => "ext-pk", signEvent: vi.fn() },
    });
    expect(await resolveSigner().getPublicKey()).toBe("ext-pk");
  });
});

describe("signers returned by createBunkerSigner and connect()", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const signed = { ...template, id: "id", pubkey: "pk", sig: "sig" };

  const fakeBunker = () => {
    const bunker = {
      bp: {
        pubkey: makeKeypair().publicKey,
        relays: ["wss://relay.example.com"],
        secret: null as string | null,
      },
      sendRequest: vi.fn().mockResolvedValue("ack"),
      getPublicKey: vi.fn().mockResolvedValue("remote-pk"),
      signEvent: vi.fn().mockResolvedValue(signed),
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(BunkerSigner, "fromBunker").mockReturnValue(bunker as never);
    return bunker;
  };

  const connect = (options = {}) =>
    createBunkerSigner(bunkerUriFor(makeKeypair().publicKey), options);

  it("sends connect with the default perms, then delegates to the bunker", async () => {
    const bunker = fakeBunker();
    const signer = await connect({ pool: stubPool() });

    expect(bunker.sendRequest).toHaveBeenCalledWith("connect", [
      expect.any(String),
      "",
      "sign_event:27235",
      "{}",
    ]);
    expect(await signer.getPublicKey()).toBe("remote-pk");
    expect(await signer.signEvent(template)).toBe(signed);
    expect(bunker.signEvent).toHaveBeenCalledExactlyOnceWith(template);
  });

  it("propagates remote signing errors", async () => {
    const bunker = fakeBunker();
    const signer = await connect({ pool: stubPool() });
    bunker.signEvent.mockRejectedValue(new Error("rejected by signer"));
    bunker.getPublicKey.mockRejectedValue(new Error("offline"));

    await expect(signer.signEvent(template)).rejects.toThrow(
      "rejected by signer",
    );
    await expect(signer.getPublicKey()).rejects.toThrow("offline");
  });

  it("exposes the client key it was given", async () => {
    fakeBunker();
    const clientSecretKey = generateSecretKey();
    const signer = await connect({ pool: stubPool(), clientSecretKey });
    expect(signer.clientSecretKey).toBe(clientSecretKey);
  });

  it("reads bunkerUri live, so relays rewritten after the handshake show up", async () => {
    const bunker = fakeBunker();
    const signer = await connect({ pool: stubPool() });
    expect(signer.bunkerUri).toContain("relay.example.com");

    bunker.bp.relays = ["wss://other.example.com"];
    expect(signer.bunkerUri).toContain("other.example.com");
    expect(signer.bunkerUri).not.toContain("relay.example.com");
  });

  it("close() closes the bunker but leaves a caller-supplied pool open", async () => {
    const bunker = fakeBunker();
    const pool = stubPool();
    const signer = await connect({ pool });

    await signer.close();
    expect(bunker.close).toHaveBeenCalledOnce();
    expect(pool.destroyed).toBe(false);
  });

  it("close() also destroys a pool it opened itself", async () => {
    const bunker = fakeBunker();
    const destroy = vi
      .spyOn((await import("nostr-tools/pool")).SimplePool.prototype, "destroy")
      .mockImplementation(() => {});
    const signer = await connect();

    await signer.close();
    expect(bunker.close).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("close() does not destroy the pool if closing the bunker fails", async () => {
    const bunker = fakeBunker();
    bunker.close.mockRejectedValue(new Error("close failed"));
    const pool = stubPool();
    const signer = await connect({ pool });

    await expect(signer.close()).rejects.toThrow("close failed");
    expect(pool.destroyed).toBe(false);
  });

  it("wraps the signer from a nostrconnect session the same way", async () => {
    const bunker = fakeBunker();
    vi.spyOn(BunkerSigner, "fromURI").mockResolvedValue(bunker as never);
    const session = createNostrConnectSession({
      relays: ["wss://relay.example.com"],
      pool: stubPool(),
    });

    const signer = await session.connect(1000);
    expect(signer.clientSecretKey).toBe(session.clientSecretKey);
    expect(await signer.signEvent(template)).toBe(signed);
  });
});
