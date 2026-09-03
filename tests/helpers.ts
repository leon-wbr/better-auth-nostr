import type { ClientStore } from "@better-auth/core";
import type { BetterFetch } from "@better-fetch/fetch";
import { betterAuth } from "better-auth";
import { memoryAdapter, type MemoryDB } from "better-auth/adapters/memory";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { getToken } from "nostr-tools/nip98";
import { nostr } from "../src/index";
import type { NostrOptions } from "../src/types";

export const TEST_ORIGIN = "http://localhost:3000";
export const TEST_BASE_PATH = "/api/auth";
export const TEST_BASE_URL = `${TEST_ORIGIN}${TEST_BASE_PATH}`;

const createMemoryDb = (modelName: string): MemoryDB => ({
  [modelName]: [],
});

export const createTestAuth = (options?: NostrOptions) => {
  const modelName = options?.modelName ?? "nostrPubkey";
  return betterAuth({
    baseURL: TEST_ORIGIN,
    secret: "test-secret-do-not-use-in-production",
    database: memoryAdapter(createMemoryDb(modelName)),
    emailAndPassword: { enabled: false },
    plugins: [nostr(options)],
    advanced: { disableCSRFCheck: true },
  });
};

export type TestAuth = ReturnType<typeof createTestAuth>;

export type Keypair = {
  secretKey: Uint8Array;
  publicKey: string;
};

export const makeKeypair = (): Keypair => {
  const secretKey = generateSecretKey();
  return { secretKey, publicKey: getPublicKey(secretKey) };
};

const signToken = (keypair: Keypair, path: string, nonce: string) =>
  getToken(
    `${TEST_BASE_URL}${path}`,
    "post",
    (event) => finalizeEvent(event, keypair.secretKey),
    true,
    { nonce },
  );

export const signLoginToken = (keypair: Keypair, nonce: string) =>
  signToken(keypair, "/nostr/login", nonce);

export const signAddPubkeyToken = (keypair: Keypair, nonce: string) =>
  signToken(keypair, "/nostr/add-pubkey", nonce);

export const issueNonce = async (auth: TestAuth, keypair: Keypair) => {
  const { nonce } = await auth.api.getNostrNonce({
    body: { publicKey: keypair.publicKey },
  });
  return nonce;
};

export const performLogin = async (
  auth: TestAuth,
  keypair: Keypair,
): Promise<Response> => {
  const nonce = await issueNonce(auth, keypair);
  const token = await signLoginToken(keypair, nonce);

  return auth.api.loginNostr({
    body: { nonce },
    headers: new Headers({ authorization: token }),
    asResponse: true,
  });
};

export const cookiesFromResponse = (res: Response): Headers => {
  const headers = new Headers();
  const setCookie = res.headers.getSetCookie();
  if (setCookie.length === 0) return headers;
  const cookieHeader = setCookie
    .map((c) => c.split(";", 1)[0]!.trim())
    .join("; ");
  headers.set("cookie", cookieHeader);
  return headers;
};

/**
 * A $fetch that resolves relative paths the way better-fetch does — against
 * `baseURL + basePath` — and drives the real auth handler. This is what makes
 * the client's own URL derivation observable to the tests.
 */
export const createTestFetch = (
  auth: TestAuth,
  { origin = TEST_ORIGIN, basePath = TEST_BASE_PATH } = {},
) => {
  const cookies = new Map<string, string>();

  const $fetch = async (path: string, init?: Record<string, any>) => {
    const headers = new Headers({ "content-type": "application/json" });
    for (const [key, value] of Object.entries(init?.headers ?? {})) {
      headers.set(key, String(value));
    }
    if (cookies.size > 0) {
      headers.set(
        "cookie",
        [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
      );
    }

    const request = new Request(`${origin}${basePath}${path}`, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });

    const response = await auth.handler(request);
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";", 1);
      const index = pair!.indexOf("=");
      cookies.set(pair!.slice(0, index), pair!.slice(index + 1));
    }

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

    if (!response.ok) {
      return {
        data: null,
        error: {
          status: response.status,
          statusText: response.statusText,
          message: data?.message ?? response.statusText,
        },
      };
    }
    return { data, error: null };
  };

  return $fetch as unknown as BetterFetch;
};

export const createTestStore = () => {
  const notified: string[] = [];
  const $store = {
    notify: (signal: string) => {
      notified.push(signal);
    },
    listen: () => {},
    atoms: {},
  } as unknown as ClientStore;
  return { notified, $store };
};
