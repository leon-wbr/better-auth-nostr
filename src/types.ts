import type { NostrProfile } from "./profile";

/** `relays` and `relayTimeoutMs`: the client options of `nostrClient(options?)`, shared with the server options. */
export interface RelayOptions {
  /**
   * Relays this app reads from, at least one. This library never picks relays for you.
   *
   * On the server, a new user is filled from their kind `0` profile at sign-up (best effort; sign-up
   * waits on the lookup up to `relayTimeoutMs`); when unset, the server never contacts a relay. On the
   * client, `nostr.getProfile` reads from them; without them it is missing from the client's types and
   * returns `NOSTR_RELAYS_NOT_CONFIGURED`.
   *
   * @defaultValue none
   */
  relays?: [string, ...string[]];
  /**
   * How long to wait on relays, in milliseconds.
   *
   * @defaultValue 5000
   */
  relayTimeoutMs?: number;
}

/**
 * What `mapProfileToUser` returns, as for a social provider: spread over the
 * default mapping, with extra keys going to the user's additional fields.
 * Identity and email never come from a self-claimed kind 0 profile.
 */
export type NostrMappedUser = {
  name?: string;
  image?: string;
  email?: never;
  emailVerified?: never;
  id?: never;
  [key: string]: unknown;
};

/** The server options of `nostr(options?)`. All are optional. */
export interface NostrOptions extends RelayOptions {
  /**
   * @deprecated Has no effect. Use `disableImplicitSignUp` to reject pubkeys
   * that are not linked to a user yet.
   */
  // TODO: implement requestSignup
  disableSignUp?: boolean;
  /**
   * Reject sign-ins from keys that are not linked to a user yet
   * (`NOSTR_PUBKEY_NOT_REGISTERED`) instead of creating a user.
   *
   * @defaultValue false
   */
  disableImplicitSignUp?: boolean;
  /**
   * Table name of the pubkey model.
   *
   * @defaultValue "nostrPubkey"
   */
  modelName?: string;
  /**
   * How long an issued nonce stays valid, in milliseconds.
   *
   * @defaultValue 300000 (5 minutes)
   */
  nonceTtlMs?: number;
  /**
   * Your own nonce generator. Each call must return a fresh value of 8–249
   * characters from `[A-Za-z0-9_-]`; anything else makes `/nostr/nonce` fail.
   *
   * @defaultValue 16 random bytes as hex
   */
  getNonce?: () => Promise<string>;
  /**
   * The email of a user created at sign-in, sync or async. Receives the npub
   * and the hex pubkey.
   *
   * @defaultValue `npub1…@nostr.local`
   */
  generateEmail?: (npub: string, pubkey: string) => string | Promise<string>;
  /** Column names of the pubkey model, for an existing table: any of `name`, `publicKey`, `userId` and `createdAt`. */
  fields?: {
    name?: string;
    publicKey?: string;
    userId?: string;
    createdAt?: string;
    lastUsedAt?: string;
  };
  /**
   * Maps a `NostrProfile` to user fields, sync or async. The result is spread
   * over the default mapping; extra keys go to `user.additionalFields`;
   * `email`, `emailVerified` and `id` are not allowed.
   *
   * @defaultValue `display_name` or `name`, and an `https:` `picture`
   */
  mapProfileToUser?: (
    profile: NostrProfile,
  ) => NostrMappedUser | Promise<NostrMappedUser>;
  /**
   * Rate limits per endpoint, in Better Auth's `{ window, max }` form (seconds,
   * requests). Like every Better Auth rate limit, they apply only where
   * `rateLimit.enabled` is on, by default in production.
   *
   * @defaultValue nonce 10 per 60s, login 3 per 10s, add-pubkey 5 per 60s
   */
  rateLimit?: Partial<
    Record<"nonce" | "login" | "addPubkey", { window: number; max: number }>
  >;
  /**
   * Accept a server without `baseURL` or `BETTER_AUTH_URL`, whose URL, and so
   * the URL NIP-98 signatures are bound to, comes from each request's `Host`
   * header. Without it the plugin warns at init, and refuses to start in
   * production.
   *
   * @defaultValue false
   */
  allowDynamicBaseURL?: boolean;
  /**
   * Also refresh an existing user from their profile on every sign-in, not
   * only at sign-up. Needs `relays`.
   *
   * @defaultValue false
   */
  overrideUserInfoOnSignIn?: boolean;
}

/** A row of the `nostrPubkey` model, as stored and as returned to clients. */
export interface NostrPubkey {
  id: string;
  publicKey: string;
  userId: string;
  name?: string | null | undefined;
  createdAt: Date;
  /** When the pubkey last signed in; null until then. */
  lastUsedAt?: Date | null | undefined;
}

/** @deprecated Use `NostrPubkey`. */
export type Nostr = NostrPubkey;
