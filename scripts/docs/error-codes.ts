import type { NostrErrorCode } from "../../src/error-codes";

type ErrorDoc = {
  /** Who reports it: the server in a response, or the client without a request. */
  from: "server" | "client";
  status: string;
  when: string;
  fix: string;
};

/** What docs/reference.md says about each error code. */
export const ERROR_DOCS: Record<NostrErrorCode, ErrorDoc> = {
  NOSTR_MISSING_TOKEN: {
    from: "server",
    status: "400",
    when: "No NIP-98 token in the `Authorization` header.",
    fix: "Call through `signIn.nostr` or `nostr.addPubkey`, which send it, or send `Authorization: Nostr <base64 event>`.",
  },
  NOSTR_INVALID_TOKEN: {
    from: "server",
    status: "400",
    when: "The header is not a NIP-98 token.",
    fix: "Send a base64-encoded kind `27235` event after `Nostr `.",
  },
  NOSTR_INVALID_EVENT: {
    from: "server",
    status: "401",
    when: "The event's signature, kind, URL, method or payload is wrong.",
    fix: "Make the client's `baseURL` and `basePath` match the server's, so the event is signed for the URL the server checks.",
  },
  NOSTR_EVENT_EXPIRED: {
    from: "server",
    status: "401",
    when: "The event was signed more than 60 seconds before or after now.",
    fix: "Sign again, and check the signing device's clock.",
  },
  NOSTR_INVALID_NONCE: {
    from: "server",
    status: "400 or 401",
    when: "The nonce is blank (400), or unknown, used, expired or issued for another key (401).",
    fix: "Fetch a new nonce for the same key and sign again; the actions do this on every call.",
  },
  NOSTR_PUBKEY_NOT_REGISTERED: {
    from: "server",
    status: "401",
    when: "`disableSignUp` is set and the key has no user.",
    fix: "Sign in another way and link the key with `nostr.addPubkey` first.",
  },
  NOSTR_PUBKEY_LINKED_TO_OTHER_USER: {
    from: "server",
    status: "409",
    when: "`addPubkey` for a key another user owns.",
    fix: "Sign in with that key to reach the account that owns it.",
  },
  NOSTR_FAILED_TO_CREATE_PUBKEY: {
    from: "server",
    status: "500",
    when: "Storing the key failed.",
    fix: "Check the server log and the database, then retry.",
  },
  NOSTR_PUBKEY_NOT_FOUND: {
    from: "server",
    status: "404",
    when: "`updatePubkey` or `removePubkey` for a key id the user does not own.",
    fix: "Take the id from `nostr.listPubkeys` for the signed-in user.",
  },
  NOSTR_CANNOT_REMOVE_LAST_PUBKEY: {
    from: "server",
    status: "400",
    when: "`removePubkey` for the user's last way to sign in.",
    fix: "Link another key or sign-in method first, or set `account.accountLinking.allowUnlinkingAll`. See [Key loss and recovery](key-loss.md).",
  },
  NOSTR_IDENTIFIER_NOT_VERIFIED: {
    from: "server",
    status: "403",
    when: "`verifyNip05.required` is set and the key's profile has no `nip05` that its domain's `nostr.json` maps to the key, on an allowed domain.",
    fix: "Publish a kind `0` profile with a `nip05` on an allowed domain, and add the key to that domain's `nostr.json`.",
  },
  NOSTR_NO_SIGNER: {
    from: "client",
    status: "400",
    when: "No `signer`, no `nsec` and no NIP-07 extension.",
    fix: "Pass a `signer` or `nsec`, or ask the user to install a NIP-07 extension.",
  },
  NOSTR_SIGNER_TIMEOUT: {
    from: "client",
    status: "408",
    when: "The signer did not answer within `timeoutMs`.",
    fix: "Retry, or raise `timeoutMs` for a remote signer that waits on a person.",
  },
  NOSTR_SIGNER_TOO_SLOW: {
    from: "client",
    status: "400",
    when: "The signer approved so late that the server would reject the event.",
    fix: "Retry and approve within a minute.",
  },
  NOSTR_SIGNER_CLOCK_SKEW: {
    from: "client",
    status: "400",
    when: "The signer's clock runs ahead of this device's.",
    fix: "Fix the clock on the signing device.",
  },
  NOSTR_SIGNER_KEY_MISMATCH: {
    from: "client",
    status: "400",
    when: "The signer signed with a different key than it reported.",
    fix: "Sign in again with the key the signer holds now.",
  },
  NOSTR_SIGNER_INVALID_EVENT: {
    from: "client",
    status: "400",
    when: "The signer's event does not verify.",
    fix: "Try another signer, and report the broken one to its maintainers.",
  },
  NOSTR_RELAYS_NOT_CONFIGURED: {
    from: "client",
    status: "400",
    when: "`getProfile` without `nostrClient({ relays })`.",
    fix: "Pass `relays` to `nostrClient`.",
  },
  NOSTR_UNKNOWN_ERROR: {
    from: "client",
    status: "400",
    when: "Anything else, such as a signer that refuses, an invalid `nsec` or a missing `baseURL`.",
    fix: "Read `error.message`. Outside a browser, set `baseURL` on the client.",
  },
};
