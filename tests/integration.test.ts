import { describe, expect, it } from "vitest";
import {
  cookiesFromResponse,
  createTestAuth,
  issueNonce,
  makeKeypair,
  performLogin,
  signAddPubkeyToken,
  signLoginToken,
} from "./helpers";

/** Lets the clock move on so later verification rows get a later createdAt. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("POST /nostr/nonce", () => {
  it("issues a nonce for a valid hex pubkey", async () => {
    const auth = createTestAuth();
    const keypair = makeKeypair();

    const { nonce } = await auth.api.getNostrNonce({
      body: { publicKey: keypair.publicKey },
    });

    expect(typeof nonce).toBe("string");
    expect(nonce.length).toBeGreaterThanOrEqual(16);
  });

  it("rejects a malformed pubkey", async () => {
    const auth = createTestAuth();
    await expect(
      auth.api.getNostrNonce({ body: { publicKey: "not-hex" } }),
    ).rejects.toThrow();
  });

  it("honors a custom getNonce()", async () => {
    const auth = createTestAuth({ getNonce: async () => "fixed-nonce-123" });
    const keypair = makeKeypair();

    const { nonce } = await auth.api.getNostrNonce({
      body: { publicKey: keypair.publicKey },
    });

    expect(nonce).toBe("fixed-nonce-123");
  });

  it.each([
    ["too short", "short"],
    ["too long", "a".repeat(250)],
    ["outside the allowed characters", "has spaces in it"],
  ])("rejects a custom getNonce() value that is %s", async (_, value) => {
    const auth = createTestAuth({ getNonce: async () => value });
    const keypair = makeKeypair();

    await expect(
      auth.api.getNostrNonce({ body: { publicKey: keypair.publicKey } }),
    ).rejects.toThrow(/getNonce/);
  });
});

describe("POST /nostr/login", () => {
  it("creates a user + session on first login", async () => {
    const auth = createTestAuth();
    const keypair = makeKeypair();

    const res = await performLogin(auth, keypair);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      session: { id: string; userId: string };
      user: { id: string; name: string };
    };
    expect(body.session.userId).toBe(body.user.id);
    expect(body.user.name.startsWith("npub")).toBe(true);

    expect(res.headers.getSetCookie().length).toBeGreaterThan(0);
  });

  it("reuses the same user on a second login from the same pubkey", async () => {
    const auth = createTestAuth();
    const keypair = makeKeypair();

    const first = await performLogin(auth, keypair);
    const second = await performLogin(auth, keypair);

    const firstBody = (await first.json()) as { user: { id: string } };
    const secondBody = (await second.json()) as { user: { id: string } };

    expect(secondBody.user.id).toBe(firstBody.user.id);
  });

  it("rejects a replayed nonce (single-use)", async () => {
    const auth = createTestAuth();
    const keypair = makeKeypair();

    const nonce = await issueNonce(auth, keypair);
    const token = await signLoginToken(keypair, nonce);

    const first = await auth.api.loginNostr({
      body: { nonce },
      headers: new Headers({ authorization: token }),
      asResponse: true,
    });
    expect(first.status).toBe(200);

    await expect(
      auth.api.loginNostr({
        body: { nonce },
        headers: new Headers({ authorization: token }),
      }),
    ).rejects.toThrow(/Invalid or expired nonce/);
  });

  const loginWith = (
    auth: ReturnType<typeof createTestAuth>,
    nonce: string,
    token: string,
  ) =>
    auth.api.loginNostr({
      body: { nonce },
      headers: new Headers({ authorization: token }),
      asResponse: true,
    });

  it("keeps an earlier nonce valid after a later nonce request for the same pubkey", async () => {
    const auth = createTestAuth();
    const keypair = makeKeypair();

    const nonce = await issueNonce(auth, keypair);
    await tick();
    await issueNonce(auth, keypair);
    await tick();
    await issueNonce(auth, keypair);

    const res = await loginWith(
      auth,
      nonce,
      await signLoginToken(keypair, nonce),
    );
    expect(res.status).toBe(200);
  });

  it("accepts two concurrent nonces for one pubkey, each once", async () => {
    const auth = createTestAuth();
    const keypair = makeKeypair();

    const first = await issueNonce(auth, keypair);
    const second = await issueNonce(auth, keypair);
    expect(first).not.toBe(second);

    const firstToken = await signLoginToken(keypair, first);
    const secondToken = await signLoginToken(keypair, second);

    const [a, b] = await Promise.all([
      loginWith(auth, second, secondToken),
      loginWith(auth, first, firstToken),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    for (const [nonce, token] of [
      [first, firstToken],
      [second, secondToken],
    ] as const) {
      const replay = await loginWith(auth, nonce, token);
      expect(replay.status).toBe(401);
    }
  });

  it("rejects a nonce that was issued for a different pubkey", async () => {
    const auth = createTestAuth();
    const alice = makeKeypair();
    const bob = makeKeypair();

    const nonce = await issueNonce(auth, alice);

    await expect(
      auth.api.loginNostr({
        body: { nonce },
        headers: new Headers({
          authorization: await signLoginToken(bob, nonce),
        }),
      }),
    ).rejects.toThrow(/Invalid or expired nonce/);
  });

  it("rejects a nonce the server never issued", async () => {
    const auth = createTestAuth();
    const keypair = makeKeypair();

    await issueNonce(auth, keypair);
    const token = await signLoginToken(keypair, "bogus-nonce");

    await expect(
      auth.api.loginNostr({
        body: { nonce: "bogus-nonce" },
        headers: new Headers({ authorization: token }),
      }),
    ).rejects.toThrow();
  });

  it("rejects an unknown pubkey when disableImplicitSignUp is set", async () => {
    const auth = createTestAuth({ disableImplicitSignUp: true });
    const keypair = makeKeypair();

    const nonce = await issueNonce(auth, keypair);
    const token = await signLoginToken(keypair, nonce);

    await expect(
      auth.api.loginNostr({
        body: { nonce },
        headers: new Headers({ authorization: token }),
      }),
    ).rejects.toThrow(/not registered/);
  });

  it("rejects a request with no Authorization header", async () => {
    const auth = createTestAuth();
    const keypair = makeKeypair();
    const nonce = await issueNonce(auth, keypair);

    await expect(
      auth.api.loginNostr({ body: { nonce }, headers: new Headers() }),
    ).rejects.toThrow();
  });

  it("honors a custom generateEmail()", async () => {
    const auth = createTestAuth({
      generateEmail: (npub) => `${npub}@example.test`,
    });
    const keypair = makeKeypair();

    const res = await performLogin(auth, keypair);
    const body = (await res.json()) as { user: { email: string } };

    expect(body.user.email.endsWith("@example.test")).toBe(true);
  });

  it("works with a custom modelName and renamed fields", async () => {
    const auth = createTestAuth({
      modelName: "nostrIdentity",
      fields: { publicKey: "pub_key", userId: "owner_id" },
    });
    const keypair = makeKeypair();

    const res = await performLogin(auth, keypair);
    expect(res.status).toBe(200);
  });
});

describe("POST /nostr/add-pubkey", () => {
  const linkPubkey = async (
    auth: ReturnType<typeof createTestAuth>,
    sessionHeaders: Headers,
    keypair: ReturnType<typeof makeKeypair>,
    name?: string,
  ) => {
    const nonce = await issueNonce(auth, keypair);
    const token = await signAddPubkeyToken(keypair, nonce);
    const headers = new Headers(sessionHeaders);
    headers.set("authorization", token);
    return auth.api.addPubkey({
      body: name ? { nonce, name } : { nonce },
      headers,
    });
  };

  it("links a second pubkey to an authenticated user", async () => {
    const auth = createTestAuth();
    const primary = makeKeypair();
    const secondary = makeKeypair();

    const loginRes = await performLogin(auth, primary);
    const sessionHeaders = cookiesFromResponse(loginRes);

    const result = await linkPubkey(
      auth,
      sessionHeaders,
      secondary,
      "Backup key",
    );

    expect(result.pubkey.publicKey).toBe(secondary.publicKey);
    expect(result.pubkey.name).toBe("Backup key");
  });

  it("rejects when not signed in", async () => {
    const auth = createTestAuth();
    const keypair = makeKeypair();

    await expect(linkPubkey(auth, new Headers(), keypair)).rejects.toThrow();
  });

  it("rejects a replayed add-pubkey token", async () => {
    const auth = createTestAuth();
    const primary = makeKeypair();
    const secondary = makeKeypair();

    const loginRes = await performLogin(auth, primary);
    const sessionHeaders = cookiesFromResponse(loginRes);

    const nonce = await issueNonce(auth, secondary);
    const token = await signAddPubkeyToken(secondary, nonce);
    const headers = new Headers(sessionHeaders);
    headers.set("authorization", token);

    await auth.api.addPubkey({ body: { nonce }, headers });

    await expect(
      auth.api.addPubkey({ body: { nonce }, headers }),
    ).rejects.toThrow(/Invalid or expired nonce/);
  });

  it("keeps an earlier add-pubkey nonce valid after a later nonce request", async () => {
    const auth = createTestAuth();
    const primary = makeKeypair();
    const secondary = makeKeypair();

    const sessionHeaders = cookiesFromResponse(
      await performLogin(auth, primary),
    );

    const nonce = await issueNonce(auth, secondary);
    await tick();
    await issueNonce(auth, secondary);

    const headers = new Headers(sessionHeaders);
    headers.set("authorization", await signAddPubkeyToken(secondary, nonce));
    const result = await auth.api.addPubkey({ body: { nonce }, headers });
    expect(result.pubkey.publicKey).toBe(secondary.publicKey);
  });

  it("rejects an add-pubkey nonce that was issued for a different pubkey", async () => {
    const auth = createTestAuth();
    const primary = makeKeypair();
    const secondary = makeKeypair();
    const other = makeKeypair();

    const sessionHeaders = cookiesFromResponse(
      await performLogin(auth, primary),
    );

    const nonce = await issueNonce(auth, other);
    const headers = new Headers(sessionHeaders);
    headers.set("authorization", await signAddPubkeyToken(secondary, nonce));

    await expect(
      auth.api.addPubkey({ body: { nonce }, headers }),
    ).rejects.toThrow(/Invalid or expired nonce/);
  });

  it("returns 409 when the pubkey already belongs to a different user", async () => {
    const auth = createTestAuth();

    const userA = makeKeypair();
    await performLogin(auth, userA);

    const userB = makeKeypair();
    const loginB = await performLogin(auth, userB);
    const sessionHeaders = cookiesFromResponse(loginB);

    await expect(linkPubkey(auth, sessionHeaders, userA)).rejects.toThrow(
      /already linked/,
    );
  });

  it("is idempotent for a pubkey the same user already owns", async () => {
    const auth = createTestAuth();
    const keypair = makeKeypair();

    const loginRes = await performLogin(auth, keypair);
    const sessionHeaders = cookiesFromResponse(loginRes);

    const result = await linkPubkey(auth, sessionHeaders, keypair);
    expect(result.pubkey.publicKey).toBe(keypair.publicKey);
  });
});
