import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
} from "nostr-tools";
import { unpackEventFromToken } from "nostr-tools/nip98";
import { bytesToHex } from "nostr-tools/utils";
import { describe, expect, it } from "vitest";
import { getNostrActions, parseSecretKey } from "../src/client";
import {
  createTestAuth,
  createTestFetch,
  createTestStore,
  makeKeypair,
  TEST_BASE_URL,
  TEST_ORIGIN,
} from "./helpers";

describe("parseSecretKey", () => {
  it("decodes a bech32 nsec", () => {
    const sk = generateSecretKey();
    const decoded = parseSecretKey(nip19.nsecEncode(sk));
    expect(bytesToHex(decoded)).toBe(bytesToHex(sk));
  });

  it("decodes a 64-char hex string", () => {
    const sk = generateSecretKey();
    const hex = bytesToHex(sk);
    expect(bytesToHex(parseSecretKey(hex))).toBe(hex);
  });

  it("accepts uppercase hex", () => {
    const sk = generateSecretKey();
    const hex = bytesToHex(sk).toUpperCase();
    expect(bytesToHex(parseSecretKey(hex))).toBe(hex.toLowerCase());
  });

  it("trims surrounding whitespace around an nsec", () => {
    const sk = generateSecretKey();
    const nsec = nip19.nsecEncode(sk);
    expect(bytesToHex(parseSecretKey(`  ${nsec}  \n`))).toBe(bytesToHex(sk));
  });

  it("throws on empty input", () => {
    expect(() => parseSecretKey("")).toThrow("Missing NSEC");
    expect(() => parseSecretKey("   ")).toThrow("Missing NSEC");
  });

  it("throws on garbage input", () => {
    expect(() => parseSecretKey("not-an-nsec")).toThrow("Invalid NSEC");
    expect(() => parseSecretKey("deadbeef")).toThrow("Invalid NSEC");
  });

  it("the parsed key derives the expected pubkey", () => {
    const sk = generateSecretKey();
    const expected = getPublicKey(sk);
    expect(getPublicKey(parseSecretKey(nip19.nsecEncode(sk)))).toBe(expected);
  });
});

describe("client sign-in", () => {
  const nsecFor = (keypair: { secretKey: Uint8Array }) =>
    nip19.nsecEncode(keypair.secretKey);

  it("signs the event against baseURL + basePath, not the bare origin", async () => {
    const auth = createTestAuth();
    const keypair = makeKeypair();
    const { $store } = createTestStore();
    const $fetch = createTestFetch(auth);

    const seen: string[] = [];
    const spyFetch = (async (path: string, init?: any) => {
      if (init?.headers?.authorization) {
        const event = await unpackEventFromToken(init.headers.authorization);
        seen.push(event.tags.find((t) => t[0] === "u")![1]!);
      }
      return ($fetch as any)(path, init);
    }) as any;

    const actions = getNostrActions(spyFetch, { $store }, {
      baseURL: TEST_ORIGIN,
    } as any);

    await actions.signIn.nostr({ nsec: nsecFor(keypair) });

    expect(seen).toEqual([`${TEST_BASE_URL}/nostr/login`]);
  });

  it("completes a full sign-in against the real handler", async () => {
    const auth = createTestAuth();
    const keypair = makeKeypair();
    const { $store, notified } = createTestStore();

    const actions = getNostrActions(createTestFetch(auth), { $store }, {
      baseURL: TEST_ORIGIN,
    } as any);

    const result = await actions.signIn.nostr({ nsec: nsecFor(keypair) });

    expect(result.error).toBeNull();
    expect(result.data?.user.name.startsWith("npub")).toBe(true);
    expect(notified).toContain("$sessionSignal");
  });

  it("honors a custom basePath", async () => {
    const auth = createTestAuth();
    const keypair = makeKeypair();
    const { $store } = createTestStore();

    const actions = getNostrActions(
      createTestFetch(auth, { basePath: "/api/auth" }),
      { $store },
      { baseURL: TEST_ORIGIN, basePath: "/api/auth" } as any,
    );

    const result = await actions.signIn.nostr({ nsec: nsecFor(keypair) });
    expect(result.error).toBeNull();
  });

  it("does not signal the session store when sign-in fails", async () => {
    const auth = createTestAuth({ disableImplicitSignUp: true });
    const keypair = makeKeypair();
    const { $store, notified } = createTestStore();

    const actions = getNostrActions(createTestFetch(auth), { $store }, {
      baseURL: TEST_ORIGIN,
    } as any);

    const result = await actions.signIn.nostr({ nsec: nsecFor(keypair) });

    expect(result.error).not.toBeNull();
    expect(notified).toHaveLength(0);
  });

  it("surfaces an error instead of throwing when no key is available", async () => {
    const auth = createTestAuth();
    const { $store } = createTestStore();

    const actions = getNostrActions(createTestFetch(auth), { $store }, {
      baseURL: TEST_ORIGIN,
    } as any);

    const result = await actions.signIn.nostr();
    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/NIP-07|NSEC/);
  });

  it("links an additional pubkey through the client action", async () => {
    const auth = createTestAuth();
    const primary = makeKeypair();
    const secondary = makeKeypair();
    const { $store } = createTestStore();

    const actions = getNostrActions(createTestFetch(auth), { $store }, {
      baseURL: TEST_ORIGIN,
    } as any);

    await actions.signIn.nostr({ nsec: nsecFor(primary) });
    const result = await actions.nostr.addPubkey({
      nsec: nsecFor(secondary),
      name: "Backup key",
    });

    expect(result.error).toBeNull();
    expect(result.data?.pubkey.publicKey).toBe(secondary.publicKey);
    expect(result.data?.pubkey.name).toBe("Backup key");
  });
});

describe("remote signer sign-in", () => {
  /** Stands in for a NIP-46 bunker: async, and never exposes a secret key. */
  const remoteSigner = (
    keypair: { secretKey: Uint8Array; publicKey: string },
    { clockSkewSeconds = 0 }: { clockSkewSeconds?: number } = {},
  ) => ({
    getPublicKey: async () => keypair.publicKey,
    signEvent: async (event: any) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return finalizeEvent(
        { ...event, created_at: event.created_at - clockSkewSeconds },
        keypair.secretKey,
      );
    },
  });

  it("completes a full sign-in through an injected signer", async () => {
    const auth = createTestAuth();
    const keypair = makeKeypair();
    const { $store, notified } = createTestStore();

    const actions = getNostrActions(createTestFetch(auth), { $store }, {
      baseURL: TEST_ORIGIN,
    } as any);

    const result = await actions.signIn.nostr({
      signer: remoteSigner(keypair),
    });

    expect(result.error).toBeNull();
    expect(result.data?.user.name).toBe(nip19.npubEncode(keypair.publicKey));
    expect(notified).toContain("$sessionSignal");
  });

  it("links an additional pubkey through an injected signer", async () => {
    const auth = createTestAuth();
    const primary = makeKeypair();
    const secondary = makeKeypair();
    const { $store } = createTestStore();

    const actions = getNostrActions(createTestFetch(auth), { $store }, {
      baseURL: TEST_ORIGIN,
    } as any);

    await actions.signIn.nostr({ nsec: nip19.nsecEncode(primary.secretKey) });
    const result = await actions.nostr.addPubkey({
      signer: remoteSigner(secondary),
      name: "Bunker key",
    });

    expect(result.error).toBeNull();
    expect(result.data?.pubkey.publicKey).toBe(secondary.publicKey);
  });

  it("reports a slow approval as a timeout rather than an opaque 401", async () => {
    const auth = createTestAuth();
    const keypair = makeKeypair();
    const { $store } = createTestStore();

    const actions = getNostrActions(createTestFetch(auth), { $store }, {
      baseURL: TEST_ORIGIN,
    } as any);

    const result = await actions.signIn.nostr({
      signer: remoteSigner(keypair, { clockSkewSeconds: 120 }),
    });

    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/too long|expired/i);
  });
});
