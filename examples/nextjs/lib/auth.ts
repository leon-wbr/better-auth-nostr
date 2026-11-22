import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { nostr } from "better-auth-nostr";

export const auth = betterAuth({
  // NIP-98 signatures are checked against this URL, never the Host header.
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  // No `database`, so Better Auth keeps users in memory until the server
  // restarts. Pass your database here, then run `npx auth@latest migrate`.
  plugins: [nostr(), nextCookies()],
});
