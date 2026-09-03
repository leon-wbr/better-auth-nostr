import { createAuthClient } from "better-auth/react";
import { nostrClient } from "better-auth-nostr/client";

// Both are injected from the server-side env by vite.config.ts, so a single
// shell variable keeps the client and the server on the same URL. The NIP-98
// event is signed against baseURL + basePath and validated against the same
// pair on the server: if they drift, every signature fails.
export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_AUTH_BASE_URL,
  basePath: import.meta.env.VITE_AUTH_BASE_PATH,
  plugins: [nostrClient()],
});
