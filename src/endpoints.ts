/** Endpoint paths relative to Better Auth's base path. */
export const NOSTR_PATHS = {
  nonce: "/nostr/nonce",
  login: "/nostr/login",
  addPubkey: "/nostr/add-pubkey",
} as const;

export type NostrPath = (typeof NOSTR_PATHS)[keyof typeof NOSTR_PATHS];

/** Better Auth's default `basePath`, used when the client sets none. */
export const DEFAULT_BASE_PATH = "/api/auth";

/**
 * The absolute URL of an endpoint, which is what a NIP-98 `u` tag carries. A
 * signature only verifies when the client's tag equals the server's URL byte
 * for byte, so both sides build it here. `baseURL` includes the base path,
 * like the server's `ctx.context.baseURL`.
 */
export const endpointURL = (baseURL: string, path: string) => {
  const trimmed = baseURL.endsWith("/") ? baseURL.slice(0, -1) : baseURL;
  return `${trimmed}${path.startsWith("/") ? path : `/${path}`}`;
};
