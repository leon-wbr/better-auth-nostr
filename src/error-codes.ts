import {
  defineErrorCodes,
  type RawError,
} from "@better-auth/core/utils/error-codes";

/**
 * Exposed as `$ERROR_CODES` on both plugins, so `authClient.$ERROR_CODES`
 * includes them. The codes are public API; the messages are not.
 */
export const NOSTR_ERROR_CODES = defineErrorCodes({
  NOSTR_MISSING_TOKEN: "Missing NIP-98 authorization token",
  NOSTR_INVALID_TOKEN: "Invalid NIP-98 authorization token",
  NOSTR_INVALID_EVENT: "Invalid NIP-98 event",
  NOSTR_EVENT_EXPIRED: "The NIP-98 event was signed too long ago or ahead",
  NOSTR_INVALID_NONCE: "Invalid or expired nonce",
  NOSTR_PUBKEY_NOT_REGISTERED: "Nostr pubkey not registered",
  NOSTR_PUBKEY_LINKED_TO_OTHER_USER:
    "Pubkey is already linked to another account",
  NOSTR_FAILED_TO_CREATE_PUBKEY: "Failed to create Nostr pubkey",
  NOSTR_PUBKEY_NOT_FOUND: "Nostr pubkey not found",
  NOSTR_CANNOT_REMOVE_LAST_PUBKEY:
    "Cannot remove the last way to sign in to this account",
  NOSTR_IDENTIFIER_NOT_VERIFIED:
    "Sign-in requires a verified NIP-05 identifier on an allowed domain",
  NOSTR_NO_SIGNER:
    "No signer available — pass `signer`, pass `nsec`, or install a NIP-07 extension",
  NOSTR_SIGNER_TIMEOUT: "The signer did not respond in time",
  NOSTR_SIGNER_TOO_SLOW: "The signer took too long to approve the request",
  NOSTR_SIGNER_CLOCK_SKEW: "The signer's clock is off",
  NOSTR_SIGNER_KEY_MISMATCH:
    "The signer signed with a different key than it reported",
  NOSTR_SIGNER_INVALID_EVENT: "The signer returned an invalid event",
  NOSTR_RELAYS_NOT_CONFIGURED: "getProfile needs nostrClient({ relays })",
  NOSTR_UNKNOWN_ERROR: "Nostr action failed",
});

/** A key of `NOSTR_ERROR_CODES`. */
export type NostrErrorCode = keyof typeof NOSTR_ERROR_CODES;

/** A client-side failure the actions report with its own code. */
export class NostrClientError extends Error {
  readonly code: NostrErrorCode;

  constructor({ code, message }: RawError<NostrErrorCode>, detail = message) {
    super(detail);
    this.code = code;
  }
}
