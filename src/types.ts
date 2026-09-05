import type { EventTemplate, Event as NostrEvent } from "nostr-tools";

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

/**
 * Anything that can hand out a public key and sign an event: a local secret
 * key, a NIP-07 extension, or a NIP-46 remote signer. Structurally compatible
 * with `Signer` from `nostr-tools/signer`.
 */
export interface NostrSigner {
  getPublicKey(): Promise<string>;
  signEvent(event: EventTemplate): Promise<NostrEvent>;
}

/** A signer backed by a live NIP-46 connection to a remote signer. */
export interface RemoteNostrSigner extends NostrSigner {
  /** Persist this to resume the session without a new approval prompt. */
  clientSecretKey: Uint8Array;
  /** Closes the relay subscription. */
  close(): Promise<void>;
}
