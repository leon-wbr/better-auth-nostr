import { defineErrorCodes } from "@better-auth/core/utils/error-codes";

/**
 * Codes for failures on the client, before or instead of a server response.
 * Exposed as `$ERROR_CODES` on both plugins, so `authClient.$ERROR_CODES`
 * includes them.
 */
export const NOSTR_ERROR_CODES = defineErrorCodes({
  NOSTR_SIGN_IN_FAILED: "Nostr sign-in failed",
  NOSTR_ADD_PUBKEY_FAILED: "Failed to add pubkey",
  NOSTR_SIGN_EVENT_FAILED: "Failed to sign event",
  NOSTR_GET_PROFILE_FAILED: "Failed to fetch profile",
});

export type NostrErrorCode = keyof typeof NOSTR_ERROR_CODES;
