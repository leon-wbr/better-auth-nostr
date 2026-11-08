import {
  type EventTemplate,
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  verifyEvent,
} from "nostr-tools";
import { unpackEventFromToken } from "nostr-tools/nip98";
import { bytesToHex } from "nostr-tools/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getNostrActions,
  NOSTR_ERROR_CODES,
  nostrClient,
  parseSecretKey,
} from "../src/client";
import { nostr } from "../src/index";
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

describe("$ERROR_CODES", () => {
  // Better Auth types `authClient.$ERROR_CODES` from the server plugin's
  // `$ERROR_CODES`; official plugins also put them on the client plugin.
  it("is exposed by the server and the client plugin", () => {
    expect(Object.keys(nostr().$ERROR_CODES).sort()).toEqual(
      [
        "NOSTR_MISSING_TOKEN",
        "NOSTR_INVALID_TOKEN",
        "NOSTR_INVALID_EVENT",
        "NOSTR_EVENT_EXPIRED",
        "NOSTR_INVALID_NONCE",
        "NOSTR_PUBKEY_NOT_REGISTERED",
        "NOSTR_PUBKEY_LINKED_TO_OTHER_USER",
        "NOSTR_FAILED_TO_CREATE_PUBKEY",
        "NOSTR_NO_SIGNER",
        "NOSTR_SIGNER_TIMEOUT",
        "NOSTR_SIGNER_TOO_SLOW",
        "NOSTR_SIGNER_CLOCK_SKEW",
        "NOSTR_SIGNER_KEY_MISMATCH",
        "NOSTR_SIGNER_INVALID_EVENT",
        "NOSTR_RELAYS_NOT_CONFIGURED",
        "NOSTR_UNKNOWN_ERROR",
      ].sort(),
    );
    expect(nostrClient().$ERROR_CODES).toBe(nostr().$ERROR_CODES);
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

    expect(result.error).toMatchObject({
      code: "NOSTR_PUBKEY_NOT_REGISTERED",
      status: 401,
    });
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
    expect(result.error?.code).toBe("NOSTR_NO_SIGNER");
  });

  // Better Auth's passkey client reports a failed client-side ceremony the
  // same way: status 400, statusText "BAD_REQUEST", a code from $ERROR_CODES.
  it("reports a client-side failure as 400 BAD_REQUEST with a plugin error code", async () => {
    const { $store } = createTestStore();
    const actions = getNostrActions(
      createTestFetch(createTestAuth()),
      {
        $store,
      },
      { baseURL: TEST_ORIGIN } as any,
    );

    const result = await actions.signIn.nostr();

    expect(result.error).toMatchObject({
      code: NOSTR_ERROR_CODES.NOSTR_NO_SIGNER.code,
      status: 400,
      statusText: "BAD_REQUEST",
    });
  });

  it("keeps the server's own status when the server rejects the sign-in", async () => {
    const auth = createTestAuth();
    const keypair = makeKeypair();
    const { $store, notified } = createTestStore();
    const $fetch = createTestFetch(auth);

    // Send a nonce the server never issued, so the real handler answers 401.
    const staleNonceFetch = ((path: string, init?: any) =>
      ($fetch as any)(
        path,
        path === "/nostr/login"
          ? { ...init, body: { nonce: "never-issued-nonce" } }
          : init,
      )) as any;
    const actions = getNostrActions(staleNonceFetch, { $store }, {
      baseURL: TEST_ORIGIN,
    } as any);

    const result = await actions.signIn.nostr({ nsec: nsecFor(keypair) });

    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({
      code: "NOSTR_INVALID_EVENT",
      status: 401,
    });
    expect(notified).toHaveLength(0);
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
  // Only Date is faked: the stub signer and the client use real timers.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Stands in for a NIP-46 bunker: async, and never exposes a secret key. */
  const remoteSigner = (
    keypair: { secretKey: Uint8Array; publicKey: string },
    { clockSkewSeconds = 0 }: { clockSkewSeconds?: number } = {},
  ) => ({
    getPublicKey: async () => keypair.publicKey,
    signEvent: async (event: EventTemplate) => {
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

  it("accepts a signature one second inside the freshness window", async () => {
    const auth = createTestAuth();
    const keypair = makeKeypair();
    const { $store } = createTestStore();

    const actions = getNostrActions(createTestFetch(auth), { $store }, {
      baseURL: TEST_ORIGIN,
    } as any);

    const result = await actions.signIn.nostr({
      signer: remoteSigner(keypair, { clockSkewSeconds: 54 }),
    });

    expect(result.error).toBeNull();
  });

  describe("a signer that returns a tampered event", () => {
    const tamperedCases: [string, (e: EventTemplate, sk: Uint8Array) => any][] =
      [
        [
          "a bad signature after serialization",
          (event, sk) =>
            JSON.parse(
              JSON.stringify({
                ...finalizeEvent(event, sk),
                content: "tampered",
              }),
            ),
        ],
        [
          "content mutated after signing, with nostr-tools' cached verification flag set",
          (event, sk) => {
            const signed = finalizeEvent(event, sk);
            signed.content = "tampered";
            return signed;
          },
        ],
      ];

    it.each(
      tamperedCases,
    )("is rejected client-side: %s", async (_name, tamper) => {
      const auth = createTestAuth();
      const keypair = makeKeypair();
      const { $store, notified } = createTestStore();
      const $fetch = createTestFetch(auth);

      const sentTokens: string[] = [];
      const spyFetch = ((path: string, init?: any) => {
        if (init?.headers?.authorization) {
          sentTokens.push(init.headers.authorization);
        }
        return ($fetch as any)(path, init);
      }) as any;
      const actions = getNostrActions(spyFetch, { $store }, {
        baseURL: TEST_ORIGIN,
      } as any);

      const result = await actions.signIn.nostr({
        signer: {
          getPublicKey: async () => keypair.publicKey,
          signEvent: async (event: EventTemplate) =>
            tamper(event, keypair.secretKey),
        },
      });

      expect(result.data).toBeNull();
      // The bad token must never leave the client, not even to be refused.
      expect(sentTokens).toEqual([]);
      expect(result.error?.code).toBe("NOSTR_SIGNER_INVALID_EVENT");
      expect(notified).toHaveLength(0);
    });
  });

  it("reports a slow approval as a timeout rather than an opaque 401", async () => {
    const auth = createTestAuth();
    const keypair = makeKeypair();
    const { $store } = createTestStore();

    const actions = getNostrActions(createTestFetch(auth), { $store }, {
      baseURL: TEST_ORIGIN,
    } as any);

    const result = await actions.signIn.nostr({
      signer: remoteSigner(keypair, { clockSkewSeconds: 55 }),
    });

    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({
      code: "NOSTR_SIGNER_TOO_SLOW",
      status: 400,
    });
  });

  it("reports a signer clock running ahead as clock skew", async () => {
    const { $store } = createTestStore();
    const actions = getNostrActions(
      createTestFetch(createTestAuth()),
      { $store },
      { baseURL: TEST_ORIGIN } as any,
    );

    const result = await actions.signIn.nostr({
      signer: remoteSigner(makeKeypair(), { clockSkewSeconds: -55 }),
    });

    expect(result.error?.code).toBe("NOSTR_SIGNER_CLOCK_SKEW");
  });

  it("reports a signer that refuses as NOSTR_UNKNOWN_ERROR with its message", async () => {
    const { $store, notified } = createTestStore();
    const actions = getNostrActions(
      createTestFetch(createTestAuth()),
      { $store },
      { baseURL: TEST_ORIGIN } as any,
    );
    const keypair = makeKeypair();

    const result = await actions.signIn.nostr({
      signer: {
        getPublicKey: async () => keypair.publicKey,
        signEvent: async () => {
          throw new Error("user denied");
        },
      },
    });

    expect(result).toEqual({
      data: null,
      error: {
        code: "NOSTR_UNKNOWN_ERROR",
        message: "user denied",
        status: 400,
        statusText: "BAD_REQUEST",
      },
    });
    expect(notified).toHaveLength(0);
  });
});

describe("client signEvent", () => {
  const actionsFor = () => {
    const { $store } = createTestStore();
    return getNostrActions(createTestFetch(createTestAuth()), { $store }, {
      baseURL: TEST_ORIGIN,
    } as any);
  };
  const note = (): EventTemplate => ({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: "hello nostr",
  });

  it("signs an arbitrary event with an nsec", async () => {
    const keypair = makeKeypair();
    const result = await actionsFor().nostr.signEvent(note(), {
      nsec: nip19.nsecEncode(keypair.secretKey),
    });

    expect(result.error).toBeNull();
    expect(result.data?.pubkey).toBe(keypair.publicKey);
    expect(result.data?.content).toBe("hello nostr");
    expect(verifyEvent(result.data!)).toBe(true);
  });

  it("signs through a supplied signer", async () => {
    const keypair = makeKeypair();
    const signer = {
      getPublicKey: async () => keypair.publicKey,
      signEvent: async (event: EventTemplate) =>
        finalizeEvent(event, keypair.secretKey),
    };
    const result = await actionsFor().nostr.signEvent(note(), { signer });

    expect(result.error).toBeNull();
    expect(result.data?.pubkey).toBe(keypair.publicKey);
  });

  it("does not touch the server", async () => {
    const { $store } = createTestStore();
    let calls = 0;
    const $fetch = (async () => {
      calls++;
      return { data: null, error: null };
    }) as any;
    const actions = getNostrActions($fetch, { $store }, {
      baseURL: TEST_ORIGIN,
    } as any);

    await actions.nostr.signEvent(note(), {
      nsec: nip19.nsecEncode(makeKeypair().secretKey),
    });
    expect(calls).toBe(0);
  });

  it("reports an error instead of throwing when no signer is available", async () => {
    const result = await actionsFor().nostr.signEvent(note());

    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({
      code: "NOSTR_NO_SIGNER",
      status: 400,
      statusText: "BAD_REQUEST",
    });
  });

  it("falls back to the code's own message when the thrown value is not an Error", async () => {
    const signer = {
      getPublicKey: async () => {
        throw "no";
      },
      signEvent: async () => {
        throw "no";
      },
    };

    const result = await actionsFor().nostr.signEvent(note(), { signer });

    expect(result.error).toMatchObject({
      code: "NOSTR_UNKNOWN_ERROR",
      message: NOSTR_ERROR_CODES.NOSTR_UNKNOWN_ERROR.message,
    });
  });

  it("times out a signer that never answers", async () => {
    const signer = {
      getPublicKey: async () => "00".repeat(32),
      signEvent: () => new Promise<never>(() => {}),
    };
    const result = await actionsFor().nostr.signEvent(note(), {
      signer,
      timeoutMs: 20,
    });

    expect(result.error).toEqual({
      code: "NOSTR_SIGNER_TIMEOUT",
      message: NOSTR_ERROR_CODES.NOSTR_SIGNER_TIMEOUT.message,
      status: 408,
      statusText: "REQUEST_TIMEOUT",
    });
  });

  it("rejects an event signed by a different key than the signer reported", async () => {
    const reported = makeKeypair();
    const actual = makeKeypair();
    const signer = {
      getPublicKey: async () => reported.publicKey,
      signEvent: async (event: EventTemplate) =>
        finalizeEvent(event, actual.secretKey),
    };
    const result = await actionsFor().nostr.signEvent(note(), { signer });

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("NOSTR_SIGNER_KEY_MISMATCH");
  });

  it("rejects an event whose signature does not verify", async () => {
    const keypair = makeKeypair();
    const signer = {
      getPublicKey: async () => keypair.publicKey,
      signEvent: async (event: EventTemplate) =>
        JSON.parse(
          JSON.stringify({
            ...finalizeEvent(event, keypair.secretKey),
            content: "tampered",
          }),
        ),
    };
    const result = await actionsFor().nostr.signEvent(note(), { signer });

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("NOSTR_SIGNER_INVALID_EVENT");
  });

  it("times out a signer whose getPublicKey never answers", async () => {
    const signer = {
      getPublicKey: () => new Promise<never>(() => {}),
      signEvent: async (event: EventTemplate) =>
        finalizeEvent(event, makeKeypair().secretKey),
    };
    const result = await actionsFor().nostr.signEvent(note(), {
      signer,
      timeoutMs: 20,
    });

    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({
      code: "NOSTR_SIGNER_TIMEOUT",
      status: 408,
    });
  });

  it("rejects a finalized event mutated after signing, without serialization", async () => {
    const keypair = makeKeypair();
    const signer = {
      getPublicKey: async () => keypair.publicKey,
      signEvent: async (event: EventTemplate) => {
        const signed = finalizeEvent(event, keypair.secretKey);
        signed.content = "tampered";
        return signed;
      },
    };
    const result = await actionsFor().nostr.signEvent(note(), { signer });

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("NOSTR_SIGNER_INVALID_EVENT");
  });
});

describe("client error paths", () => {
  const nsecFor = (keypair: { secretKey: Uint8Array }) =>
    nip19.nsecEncode(keypair.secretKey);
  const noBaseUrl = {
    code: "NOSTR_UNKNOWN_ERROR",
    message:
      "nostrClient: cannot determine absolute URL — set baseURL on the client",
  };

  it("reports a missing baseURL outside a browser instead of signing against a bad URL", async () => {
    const { $store, notified } = createTestStore();
    const actions = getNostrActions(
      createTestFetch(createTestAuth()),
      { $store },
      {} as any,
    );

    const result = await actions.signIn.nostr({
      nsec: nsecFor(makeKeypair()),
    });

    expect(result.data).toBeNull();
    expect(result.error).toMatchObject(noBaseUrl);
    expect(notified).toHaveLength(0);
  });

  it("reports the missing baseURL from addPubkey too", async () => {
    const { $store } = createTestStore();
    const actions = getNostrActions(
      createTestFetch(createTestAuth()),
      { $store },
      {} as any,
    );

    const result = await actions.nostr.addPubkey({
      nsec: nsecFor(makeKeypair()),
    });

    expect(result.data).toBeNull();
    expect(result.error).toMatchObject(noBaseUrl);
  });

  describe("when the nonce request fails", () => {
    const actionsWithNonceResponse = (response: unknown) => {
      const { $store } = createTestStore();
      const calls: string[] = [];
      const $fetch = (async (path: string) => {
        calls.push(path);
        return response;
      }) as any;
      const actions = getNostrActions($fetch, { $store }, {
        baseURL: TEST_ORIGIN,
      } as any);
      return { actions, calls };
    };

    const serverError = {
      data: null,
      error: { message: "Too many requests", status: 429 },
    };

    it("returns the server's error as is and stops before login", async () => {
      const { actions, calls } = actionsWithNonceResponse(serverError);

      const result = await actions.signIn.nostr({
        nsec: nsecFor(makeKeypair()),
      });

      expect(result).toEqual(serverError);
      expect(calls).toEqual(["/nostr/nonce"]);
    });

    it("returns it from addPubkey too", async () => {
      const { actions } = actionsWithNonceResponse(serverError);

      const result = await actions.nostr.addPubkey({
        nsec: nsecFor(makeKeypair()),
      });

      expect(result).toEqual(serverError);
    });
  });

  describe("when the signer signs with a different key than it reported", () => {
    const switchedSigner = () => {
      const reported = makeKeypair();
      const actual = makeKeypair();
      return {
        getPublicKey: async () => reported.publicKey,
        signEvent: async (event: EventTemplate) =>
          finalizeEvent(event, actual.secretKey),
      };
    };

    it("fails sign-in before anything is sent to the login endpoint", async () => {
      const { $store, notified } = createTestStore();
      const realFetch = createTestFetch(createTestAuth());
      const calls: string[] = [];
      const $fetch = (async (path: string, init?: any) => {
        calls.push(path);
        return (realFetch as any)(path, init);
      }) as any;
      const actions = getNostrActions($fetch, { $store }, {
        baseURL: TEST_ORIGIN,
      } as any);

      const result = await actions.signIn.nostr({ signer: switchedSigner() });

      expect(result.data).toBeNull();
      expect(result.error?.code).toBe("NOSTR_SIGNER_KEY_MISMATCH");
      expect(calls).toEqual(["/nostr/nonce"]);
      expect(notified).toHaveLength(0);
    });

    it("fails addPubkey the same way", async () => {
      const { $store } = createTestStore();
      const actions = getNostrActions(
        createTestFetch(createTestAuth()),
        { $store },
        { baseURL: TEST_ORIGIN } as any,
      );

      const result = await actions.nostr.addPubkey({
        signer: switchedSigner(),
      });

      expect(result.data).toBeNull();
      expect(result.error?.code).toBe("NOSTR_SIGNER_KEY_MISMATCH");
    });
  });
});
