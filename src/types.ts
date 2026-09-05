export interface NostrOptions {
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
}

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
