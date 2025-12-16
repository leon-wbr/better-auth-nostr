export interface NostrOptions {
  disableSignUp?: boolean;
  /** @todo Implement requestSignup */
  disableImplicitSignUp?: boolean;
  modelName?: string;
  /**
   * Nonce time-to-live in milliseconds. Defaults to 5 minutes.
   */
  nonceTtlMs?: number;
  fields?: {
    name?: string;
    publicKey?: string;
    userId?: string;
    createdAt?: string;
  };
}

export interface Nostr {}

export type NostrPubkey = {
  name?: string | undefined;
  publicKey: string;
  userId: string;
  createdAt: Date;
};
