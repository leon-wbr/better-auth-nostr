import type { MemoryDB } from "better-auth/adapters/memory";
import { finalizeEvent, nip19 } from "nostr-tools";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getNostrActions } from "../src/client";
import type { NostrOptions, NostrSignUpCandidate } from "../src/types";
import {
  cookiesFromResponse,
  createTestAuth,
  createTestFetch,
  createTestStore,
  issueNonce,
  type Keypair,
  makeKeypair,
  performLogin,
  prepareLogin,
  signAddPubkeyToken,
  TEST_ORIGIN,
  type TestAuth,
} from "./helpers";

const relay = vi.hoisted(() => ({ event: null as unknown, calls: 0 }));

vi.mock("nostr-tools/pool", () => ({
  SimplePool: class {
    async get() {
      relay.calls++;
      return relay.event;
    }
    close() {}
  },
}));

beforeEach(() => {
  relay.event = null;
  relay.calls = 0;
});

const RELAYS: [string] = ["wss://relay.example.com"];

const setup = (options: NostrOptions) => {
  const db: MemoryDB = { user: [], account: [], nostrPubkey: [] };
  return { db, auth: createTestAuth(options, { db }) };
};

const expectNoRows = (db: MemoryDB) => {
  expect(db.user).toHaveLength(0);
  expect(db.account).toHaveLength(0);
  expect(db.nostrPubkey).toHaveLength(0);
};

const signInFromClient = (auth: TestAuth, keypair: Keypair) => {
  const { $store } = createTestStore();
  const actions = getNostrActions(createTestFetch(auth), { $store }, {
    baseURL: TEST_ORIGIN,
  } as any);
  return actions.signIn.nostr({ nsec: nip19.nsecEncode(keypair.secretKey) });
};

const errorCode = async (res: Response) =>
  ((await res.json()) as { code?: string }).code;

describe("allowSignUp", () => {
  it.each([
    ["sync", () => true],
    ["async", async () => true],
  ])("lets a %s true sign the key up", async (_, allowSignUp) => {
    const { db, auth } = setup({ allowSignUp });
    const res = await performLogin(auth, makeKeypair());
    expect(res.status).toBe(200);
    expect(db.user).toHaveLength(1);
    expect(db.nostrPubkey).toHaveLength(1);
  });

  it.each([
    ["sync", () => false],
    ["async", async () => false],
  ])("rejects a %s false with 403 NOSTR_SIGN_UP_DISABLED and writes nothing", async (_, allowSignUp) => {
    const { db, auth } = setup({ allowSignUp });
    const res = await performLogin(auth, makeKeypair());
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("NOSTR_SIGN_UP_DISABLED");
    expectNoRows(db);
  });

  it("leaves the nonce consumed when it rejects", async () => {
    const { auth } = setup({ allowSignUp: () => false });
    const login = await prepareLogin(auth, makeKeypair());
    expect((await login()).status).toBe(403);
    const retry = await login();
    expect(retry.status).toBe(401);
    expect(await errorCode(retry)).toBe("NOSTR_INVALID_NONCE");
  });

  it("answers 500 and writes nothing when it throws", async () => {
    const { db, auth } = setup({
      allowSignUp: () => {
        throw new Error("gate down");
      },
    });
    const result = await signInFromClient(auth, makeKeypair());
    expect(result.error).toMatchObject({ status: 500 });
    expectNoRows(db);
  });

  it("gets the lower-case hex pubkey, the npub, a null profile without relays and no request for auth.api calls", async () => {
    const allowSignUp = vi.fn(() => true);
    const { auth } = setup({ allowSignUp });
    const keypair = makeKeypair();
    await performLogin(auth, keypair);
    expect(allowSignUp).toHaveBeenCalledExactlyOnceWith({
      pubkey: keypair.publicKey,
      npub: nip19.npubEncode(keypair.publicKey),
      profile: null,
      request: undefined,
    });
    expect(relay.calls).toBe(0);
  });

  it("gets the kind 0 profile with relays, fetched once for the gate and autofill", async () => {
    const keypair = makeKeypair();
    relay.event = finalizeEvent(
      {
        kind: 0,
        created_at: 1_700_000_000,
        tags: [],
        content: JSON.stringify({ name: "alice" }),
      },
      keypair.secretKey,
    );
    const allowSignUp = vi.fn((_: NostrSignUpCandidate) => true);
    const { db, auth } = setup({ relays: RELAYS, allowSignUp });
    expect((await performLogin(auth, keypair)).status).toBe(200);
    expect(allowSignUp.mock.calls[0]![0].profile).toMatchObject({
      pubkey: keypair.publicKey,
      metadata: { name: "alice" },
    });
    expect(relay.calls).toBe(1);
    expect(db.user![0]!.name).toBe("alice");
  });

  it("is not called for a key that already has a user", async () => {
    const allowSignUp = vi.fn(() => true);
    const { auth } = setup({ allowSignUp });
    const keypair = makeKeypair();
    await performLogin(auth, keypair);
    allowSignUp.mockReturnValue(false);
    expect((await performLogin(auth, keypair)).status).toBe(200);
    expect(allowSignUp).toHaveBeenCalledOnce();
  });

  it("is not called when a signed-in user adds a key", async () => {
    const allowSignUp = vi.fn(() => true);
    const { auth } = setup({ allowSignUp });
    const headers = cookiesFromResponse(
      await performLogin(auth, makeKeypair()),
    );
    allowSignUp.mockReturnValue(false);
    const second = makeKeypair();
    const nonce = await issueNonce(auth, second);
    headers.set("authorization", await signAddPubkeyToken(second, nonce));
    const res = await auth.api.addPubkey({
      body: { nonce },
      headers,
      asResponse: true,
    });
    expect(res.status).toBe(200);
    expect(allowSignUp).toHaveBeenCalledOnce();
  });

  it.each([
    "disableSignUp",
    "disableImplicitSignUp",
  ] as const)("never runs when %s is set, which keeps its own code", async (option) => {
    const allowSignUp = vi.fn(() => true);
    const { db, auth } = setup({ [option]: true, allowSignUp });
    const res = await performLogin(auth, makeKeypair());
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("NOSTR_PUBKEY_NOT_REGISTERED");
    expect(allowSignUp).not.toHaveBeenCalled();
    expectNoRows(db);
  });

  it("reaches the client as error.code NOSTR_SIGN_UP_DISABLED, with the request passed to the gate", async () => {
    const allowSignUp = vi.fn((_: NostrSignUpCandidate) => false);
    const result = await signInFromClient(
      createTestAuth({ allowSignUp }),
      makeKeypair(),
    );

    expect(result.error).toMatchObject({
      code: "NOSTR_SIGN_UP_DISABLED",
      status: 403,
    });
    expect(allowSignUp.mock.calls[0]![0].request).toBeInstanceOf(Request);
  });
});
