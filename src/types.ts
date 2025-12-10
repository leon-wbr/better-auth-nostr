export interface NostrOptions {
  disableSignUp?: boolean;
  /** @todo Implement requestSignup */
  disableImplicitSignUp?: boolean;
  modelName?: string;
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
