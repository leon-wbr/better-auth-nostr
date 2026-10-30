import type { NostrProfile } from "./profile";

/** How to reach relays; shared by every feature that reads from them. */
export interface RelayOptions {
  /**
   * Relays this app reads from. There is no default: this library never picks relays for you.
   * On the server, setting them fills a new user from their kind 0 profile at sign-up
   * (best effort; sign-up waits on the lookup up to `relayTimeoutMs`).
   */
  relays?: [string, ...string[]];
  /** How long to wait on relays, in milliseconds. Defaults to 5000. */
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

interface NostrBaseOptions extends RelayOptions {
  disableSignUp?: boolean;
  /** @todo Implement requestSignup */
  disableImplicitSignUp?: boolean;
  modelName?: string;
  /**
   * Nonce time-to-live in milliseconds. Defaults to 5 minutes.
   */
  nonceTtlMs?: number;
  /**
   * Function to generate a unique nonce for each sign-in attempt.
   * You can implement this function to override the default nonce generator.
   */
  getNonce?: () => Promise<string>;
  /**
   * Customize the email assigned to a user created via implicit sign-up.
   * Receives the npub and the hex public key.
   */
  generateEmail?: (npub: string, pubkey: string) => string | Promise<string>;
  fields?: {
    name?: string;
    publicKey?: string;
    userId?: string;
    createdAt?: string;
  };
  /** Map the kind 0 profile to user fields. The result is spread over the default `display_name || name` and https `picture` mapping. */
  mapProfileToUser?: (
    profile: NostrProfile,
  ) => NostrMappedUser | Promise<NostrMappedUser>;
  /** Also refresh an existing user's fields from their profile on every sign-in; needs `relays`. Defaults to false. */
  overrideUserInfoOnSignIn?: boolean;
}

export type NostrOptions = NostrBaseOptions;

export interface Nostr {
  id: string;
  publicKey: string;
  userId: string;
  name?: string | undefined;
  createdAt: Date;
}

export type NostrPubkey = {
  id?: string;
  name?: string | undefined;
  publicKey: string;
  userId: string;
  createdAt: Date;
};
