import { finalizeEvent } from "nostr-tools";
import { getToken } from "nostr-tools/nip98";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cookiesFromResponse,
  createTestAuth,
  issueNonce,
  type Keypair,
  makeKeypair,
  performLogin,
  TEST_BASE_URL,
  type TestAuth,
} from "./helpers";

/**
 * The checks every NIP-98 endpoint has to make before trusting a request.
 * Both endpoints run the same table, so a check dropped from either fails here.
 */
type Endpoint = "/nostr/login" | "/nostr/add-pubkey";

const ENDPOINTS: Endpoint[] = ["/nostr/login", "/nostr/add-pubkey"];

type TokenOptions = {
  url?: string;
  method?: string;
  payload?: Record<string, unknown>;
  createdAtOffset?: number;
};

const signToken = (
  keypair: Keypair,
  path: Endpoint,
  nonce: string,
  {
    url = `${TEST_BASE_URL}${path}`,
    method = "post",
    payload = { nonce },
    createdAtOffset = 0,
  }: TokenOptions = {},
) =>
  getToken(
    url,
    method,
    (event) =>
      finalizeEvent(
        { ...event, created_at: event.created_at + createdAtOffset },
        keypair.secretKey,
      ),
    true,
    payload,
  );

/** Sends one request to `path`, signed in first when the endpoint needs a session. */
const call = async (
  auth: TestAuth,
  path: Endpoint,
  { nonce, authorization }: { nonce: string; authorization?: string },
) => {
  const headers =
    path === "/nostr/add-pubkey"
      ? cookiesFromResponse(await performLogin(auth, makeKeypair()))
      : new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  const request = { body: { nonce }, headers, asResponse: true } as const;
  const res =
    path === "/nostr/login"
      ? await auth.api.loginNostr(request)
      : await auth.api.addPubkey(request);
  const body = (await res.json()) as { message?: string };
  return { status: res.status, message: body.message };
};

afterEach(() => {
  vi.useRealTimers();
});

describe.each(ENDPOINTS)("NIP-98 checks on %s", (path) => {
  it("accepts a correctly signed request", async () => {
    const auth = createTestAuth();
    const keypair = makeKeypair();
    const nonce = await issueNonce(auth, keypair);

    const res = await call(auth, path, {
      nonce,
      authorization: await signToken(keypair, path, nonce),
    });
    expect(res.status).toBe(200);
  });

  it("rejects a missing Authorization header with 400", async () => {
    const auth = createTestAuth();
    const nonce = await issueNonce(auth, makeKeypair());

    const res = await call(auth, path, { nonce });
    expect(res.status).toBe(400);
    expect(res.message).toMatch(/authorization token/i);
  });

  it("rejects a blank nonce with 400", async () => {
    const auth = createTestAuth();
    const keypair = makeKeypair();

    const res = await call(auth, path, {
      nonce: "   ",
      authorization: await signToken(keypair, path, "   "),
    });
    expect(res.status).toBe(400);
    expect(res.message).toBe("Missing nonce");
  });

  it("rejects a token that is not a NIP-98 token with 400", async () => {
    const auth = createTestAuth();
    const nonce = await issueNonce(auth, makeKeypair());

    const res = await call(auth, path, {
      nonce,
      authorization: "Nostr bm90IGpzb24=",
    });
    expect(res.status).toBe(400);
  });

  it.each<[string, (nonce: string, path: Endpoint) => TokenOptions]>([
    [
      "signed for another URL",
      () => ({ url: "https://evil.example/api/auth/nostr/login" }),
    ],
    [
      "signed for the other endpoint",
      (_, path) => ({
        url: `${TEST_BASE_URL}${path === "/nostr/login" ? "/nostr/add-pubkey" : "/nostr/login"}`,
      }),
    ],
    ["signed for another method", () => ({ method: "get" })],
    [
      "signed over another payload",
      () => ({ payload: { nonce: "some-other-nonce" } }),
    ],
    ["signed too long ago", () => ({ createdAtOffset: -120 })],
    ["signed in the future", () => ({ createdAtOffset: 120 })],
  ])("rejects a token %s with 401 and keeps the nonce", async (_, options) => {
    const auth = createTestAuth();
    const keypair = makeKeypair();
    const nonce = await issueNonce(auth, keypair);

    const rejected = await call(auth, path, {
      nonce,
      authorization: await signToken(
        keypair,
        path,
        nonce,
        options(nonce, path),
      ),
    });
    expect(rejected.status).toBe(401);

    // A rejected signature must not burn the nonce for the real request.
    const accepted = await call(auth, path, {
      nonce,
      authorization: await signToken(keypair, path, nonce),
    });
    expect(accepted.status).toBe(200);
  });

  it("rejects a nonce past its nonceTtlMs with 401", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const auth = createTestAuth({ nonceTtlMs: 60_000 });
    const keypair = makeKeypair();
    const nonce = await issueNonce(auth, keypair);

    vi.setSystemTime(Date.now() + 60_001);
    const res = await call(auth, path, {
      nonce,
      authorization: await signToken(keypair, path, nonce),
    });
    expect(res.status).toBe(401);
    expect(res.message).toBe("Invalid or expired nonce");
  });

  it("accepts a nonce just inside its nonceTtlMs", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const auth = createTestAuth({ nonceTtlMs: 60_000 });
    const keypair = makeKeypair();
    const nonce = await issueNonce(auth, keypair);

    vi.setSystemTime(Date.now() + 59_000);
    const res = await call(auth, path, {
      nonce,
      authorization: await signToken(keypair, path, nonce),
    });
    expect(res.status).toBe(200);
  });

  it("rejects a nonce issued for another pubkey with 401", async () => {
    const auth = createTestAuth();
    const keypair = makeKeypair();
    const nonce = await issueNonce(auth, makeKeypair());

    const res = await call(auth, path, {
      nonce,
      authorization: await signToken(keypair, path, nonce),
    });
    expect(res.status).toBe(401);
  });
});
