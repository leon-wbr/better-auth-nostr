import { createAuthClient } from "better-auth/client";
import { nip19 } from "nostr-tools";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nostrClient } from "../src/client";
import {
  cookiesFromResponse,
  createTestAuth,
  issueNonce,
  type Keypair,
  makeKeypair,
  performLogin,
  signAddPubkeyToken,
  TEST_ORIGIN,
  type TestAuth,
} from "./helpers";

const signIn = async (auth: TestAuth, keypair = makeKeypair()) => {
  const res = await performLogin(auth, keypair);
  const { user } = (await res.json()) as { user: { id: string } };
  return { keypair, headers: cookiesFromResponse(res), userId: user.id };
};

const addKey = async (
  auth: TestAuth,
  headers: Headers,
  name?: string,
  keypair: Keypair = makeKeypair(),
) => {
  const nonce = await issueNonce(auth, keypair);
  const authorization = await signAddPubkeyToken(keypair, nonce);
  const { pubkey } = await auth.api.addPubkey({
    body: { nonce, name },
    headers: new Headers({ ...Object.fromEntries(headers), authorization }),
  });
  return pubkey;
};

const list = (auth: TestAuth, headers: Headers) =>
  auth.api.listPubkeys({ headers });

const remove = (auth: TestAuth, headers: Headers, id: string) =>
  auth.api.removePubkey({ body: { id }, headers });

const nostrAccounts = async (auth: TestAuth, headers: Headers) =>
  (await auth.api.listUserAccounts({ headers }))
    .filter((account) => account.providerId === "nostr")
    .map((account) => account.accountId)
    .sort();

const errorOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as { statusCode: number; body: { code: string } };
  }
  throw new Error("expected the call to fail");
};

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /nostr/list-pubkeys", () => {
  it("lists the session user's pubkeys with npub, name and last use", async () => {
    const auth = createTestAuth();
    const { keypair, headers } = await signIn(auth);
    const backup = await addKey(auth, headers, "backup");
    await signIn(auth);

    const pubkeys = await list(auth, headers);

    expect(pubkeys).toHaveLength(2);
    expect(pubkeys).toContainEqual({
      id: expect.any(String),
      publicKey: keypair.publicKey,
      npub: nip19.npubEncode(keypair.publicKey),
      name: null,
      createdAt: expect.any(Date),
      lastUsedAt: expect.any(Date),
    });
    expect(pubkeys).toContainEqual({
      id: backup.id,
      publicKey: backup.publicKey,
      npub: nip19.npubEncode(backup.publicKey),
      name: "backup",
      createdAt: expect.any(Date),
      lastUsedAt: null,
    });
  });

  it("rejects a request without a session", async () => {
    const error = await errorOf(list(createTestAuth(), new Headers()));

    expect(error.statusCode).toBe(401);
  });
});

describe("lastUsedAt", () => {
  it("is set on every sign-in", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const auth = createTestAuth();
    const { keypair, headers } = await signIn(auth);
    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));

    await performLogin(auth, keypair);

    const [pubkey] = await list(auth, headers);
    expect(pubkey!.lastUsedAt).toEqual(new Date("2026-01-02T00:00:00Z"));
  });
});

describe("POST /nostr/update-pubkey", () => {
  it("renames one of the user's pubkeys", async () => {
    const auth = createTestAuth();
    const { headers } = await signIn(auth);
    const added = await addKey(auth, headers, "old");

    const { pubkey } = await auth.api.updatePubkey({
      body: { id: added.id, name: "laptop" },
      headers,
    });

    expect(pubkey).toMatchObject({ id: added.id, name: "laptop" });
    expect(await list(auth, headers)).toContainEqual(
      expect.objectContaining({ id: added.id, name: "laptop" }),
    );
  });

  it("answers 404 for another user's pubkey and leaves it unchanged", async () => {
    const auth = createTestAuth();
    const alice = await signIn(auth);
    const theirs = await addKey(auth, alice.headers, "alice's");
    const mallory = await signIn(auth);

    const error = await errorOf(
      auth.api.updatePubkey({
        body: { id: theirs.id, name: "stolen" },
        headers: mallory.headers,
      }),
    );

    expect(error.statusCode).toBe(404);
    expect(error.body.code).toBe("NOSTR_PUBKEY_NOT_FOUND");
    expect(await list(auth, alice.headers)).toContainEqual(
      expect.objectContaining({ id: theirs.id, name: "alice's" }),
    );
  });
});

describe("POST /nostr/remove-pubkey", () => {
  it("removes a pubkey together with its account row", async () => {
    const auth = createTestAuth();
    const { keypair, headers } = await signIn(auth);
    const backup = await addKey(auth, headers);

    expect(await remove(auth, headers, backup.id)).toEqual({ status: true });

    expect((await list(auth, headers)).map((p) => p.publicKey)).toEqual([
      keypair.publicKey,
    ]);
    expect(await nostrAccounts(auth, headers)).toEqual([keypair.publicKey]);
  });

  it("answers 404 for another user's pubkey and keeps it", async () => {
    const auth = createTestAuth();
    const alice = await signIn(auth);
    await addKey(auth, alice.headers);
    const [theirs] = await list(auth, alice.headers);
    const mallory = await signIn(auth);

    const error = await errorOf(remove(auth, mallory.headers, theirs!.id));

    expect(error.statusCode).toBe(404);
    expect(error.body.code).toBe("NOSTR_PUBKEY_NOT_FOUND");
    expect(await list(auth, alice.headers)).toHaveLength(2);
  });

  it("refuses to remove the user's last way to sign in", async () => {
    const auth = createTestAuth();
    const { headers } = await signIn(auth);
    const [only] = await list(auth, headers);

    const error = await errorOf(remove(auth, headers, only!.id));

    expect(error.statusCode).toBe(400);
    expect(error.body.code).toBe("NOSTR_CANNOT_REMOVE_LAST_PUBKEY");
    expect(await list(auth, headers)).toHaveLength(1);
  });

  it("removes the last pubkey when another account can still sign in", async () => {
    const auth = createTestAuth();
    const { headers, userId } = await signIn(auth);
    const [only] = await list(auth, headers);
    const ctx = await auth.$context;
    await ctx.internalAdapter.createAccount({
      providerId: "github",
      accountId: "12345",
      userId,
    });

    await remove(auth, headers, only!.id);

    expect(await list(auth, headers)).toEqual([]);
  });

  it("removes the last pubkey when allowUnlinkingAll is set", async () => {
    const auth = createTestAuth(undefined, {
      account: { accountLinking: { allowUnlinkingAll: true } },
    });
    const { headers } = await signIn(auth);
    const [only] = await list(auth, headers);

    await remove(auth, headers, only!.id);

    expect(await list(auth, headers)).toEqual([]);
    expect(await nostrAccounts(auth, headers)).toEqual([]);
  });

  it("requires a fresh session", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const auth = createTestAuth(undefined, { session: { freshAge: 60 } });
    const { headers } = await signIn(auth);
    const backup = await addKey(auth, headers);
    vi.setSystemTime(Date.now() + 120_000);

    const error = await errorOf(remove(auth, headers, backup.id));

    expect(error.statusCode).toBe(403);
    expect(await list(auth, headers)).toHaveLength(2);
  });
});

describe("account mirror", () => {
  it("registers every linked pubkey as a nostr account", async () => {
    const auth = createTestAuth();
    const { keypair, headers } = await signIn(auth);
    const backup = await addKey(auth, headers);

    expect(await nostrAccounts(auth, headers)).toEqual(
      [keypair.publicKey, backup.publicKey].sort(),
    );
  });

  it("removes the pubkey when its account is unlinked", async () => {
    const auth = createTestAuth();
    const { keypair, headers } = await signIn(auth);
    const backup = await addKey(auth, headers);
    const accounts = await auth.api.listUserAccounts({ headers });
    const account = accounts.find((a) => a.accountId === backup.publicKey)!;

    await auth.api.unlinkAccount({ body: { accountId: account.id }, headers });

    expect((await list(auth, headers)).map((p) => p.publicKey)).toEqual([
      keypair.publicKey,
    ]);
  });

  it("keeps Better Auth's last-account guard for a Nostr-only user", async () => {
    const auth = createTestAuth();
    const { headers } = await signIn(auth);
    const [account] = await auth.api.listUserAccounts({ headers });

    const error = await errorOf(
      auth.api.unlinkAccount({ body: { accountId: account!.id }, headers }),
    );

    expect(error.body.code).toBe("FAILED_TO_UNLINK_LAST_ACCOUNT");
    expect(await list(auth, headers)).toHaveLength(1);
  });
});

describe("client actions", () => {
  it("lists, renames and removes keys through authClient.nostr", async () => {
    const auth = createTestAuth();
    let cookie = "";
    const client = createAuthClient({
      baseURL: TEST_ORIGIN,
      plugins: [nostrClient()],
      fetchOptions: {
        customFetchImpl: async (input, init) => {
          const request = new Request(input, init);
          if (cookie) request.headers.set("cookie", cookie);
          const response = await auth.handler(request);
          const set = response.headers.getSetCookie();
          if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
          return response;
        },
      },
    });
    const main = makeKeypair();
    await client.signIn.nostr({ nsec: nip19.nsecEncode(main.secretKey) });
    await client.nostr.addPubkey({
      nsec: nip19.nsecEncode(makeKeypair().secretKey),
      name: "backup",
    });

    const listed = await client.nostr.listPubkeys();
    const backup = listed.data!.find((pubkey) => pubkey.name === "backup")!;
    const renamed = await client.nostr.updatePubkey({
      id: backup.id,
      name: "laptop",
    });
    const removed = await client.nostr.removePubkey({ id: backup.id });

    expect(renamed.data?.pubkey.name).toBe("laptop");
    expect(removed.data).toEqual({ status: true });
    expect((await client.nostr.listPubkeys()).data).toEqual([
      expect.objectContaining({ publicKey: main.publicKey }),
    ]);
  });
});
