---
title: better-auth-nostr
---

The server plugin, imported from `better-auth-nostr`.

## Type Aliases

### NostrErrorCode

> **NostrErrorCode** = keyof *typeof* [`NOSTR_ERROR_CODES`](#nostr_error_codes)

A key of `NOSTR_ERROR_CODES`.

## Variables

### NOSTR\_ERROR\_CODES

> `const` **NOSTR\_ERROR\_CODES**: `object`

Exposed as `$ERROR_CODES` on both plugins, so `authClient.$ERROR_CODES`
includes them. The codes are public API; the messages are not.

#### Type Declaration

| Name | Type |
| ------ | ------ |
| <a id="property-nostr_missing_token"></a> `NOSTR_MISSING_TOKEN` | `RawError`\<`"NOSTR_MISSING_TOKEN"`\> |
| <a id="property-nostr_invalid_token"></a> `NOSTR_INVALID_TOKEN` | `RawError`\<`"NOSTR_INVALID_TOKEN"`\> |
| <a id="property-nostr_invalid_event"></a> `NOSTR_INVALID_EVENT` | `RawError`\<`"NOSTR_INVALID_EVENT"`\> |
| <a id="property-nostr_event_expired"></a> `NOSTR_EVENT_EXPIRED` | `RawError`\<`"NOSTR_EVENT_EXPIRED"`\> |
| <a id="property-nostr_invalid_nonce"></a> `NOSTR_INVALID_NONCE` | `RawError`\<`"NOSTR_INVALID_NONCE"`\> |
| <a id="property-nostr_pubkey_not_registered"></a> `NOSTR_PUBKEY_NOT_REGISTERED` | `RawError`\<`"NOSTR_PUBKEY_NOT_REGISTERED"`\> |
| <a id="property-nostr_sign_up_disabled"></a> `NOSTR_SIGN_UP_DISABLED` | `RawError`\<`"NOSTR_SIGN_UP_DISABLED"`\> |
| <a id="property-nostr_pubkey_linked_to_other_user"></a> `NOSTR_PUBKEY_LINKED_TO_OTHER_USER` | `RawError`\<`"NOSTR_PUBKEY_LINKED_TO_OTHER_USER"`\> |
| <a id="property-nostr_failed_to_create_pubkey"></a> `NOSTR_FAILED_TO_CREATE_PUBKEY` | `RawError`\<`"NOSTR_FAILED_TO_CREATE_PUBKEY"`\> |
| <a id="property-nostr_pubkey_not_found"></a> `NOSTR_PUBKEY_NOT_FOUND` | `RawError`\<`"NOSTR_PUBKEY_NOT_FOUND"`\> |
| <a id="property-nostr_cannot_remove_last_pubkey"></a> `NOSTR_CANNOT_REMOVE_LAST_PUBKEY` | `RawError`\<`"NOSTR_CANNOT_REMOVE_LAST_PUBKEY"`\> |
| <a id="property-nostr_no_signer"></a> `NOSTR_NO_SIGNER` | `RawError`\<`"NOSTR_NO_SIGNER"`\> |
| <a id="property-nostr_signer_timeout"></a> `NOSTR_SIGNER_TIMEOUT` | `RawError`\<`"NOSTR_SIGNER_TIMEOUT"`\> |
| <a id="property-nostr_signer_too_slow"></a> `NOSTR_SIGNER_TOO_SLOW` | `RawError`\<`"NOSTR_SIGNER_TOO_SLOW"`\> |
| <a id="property-nostr_signer_clock_skew"></a> `NOSTR_SIGNER_CLOCK_SKEW` | `RawError`\<`"NOSTR_SIGNER_CLOCK_SKEW"`\> |
| <a id="property-nostr_signer_key_mismatch"></a> `NOSTR_SIGNER_KEY_MISMATCH` | `RawError`\<`"NOSTR_SIGNER_KEY_MISMATCH"`\> |
| <a id="property-nostr_signer_invalid_event"></a> `NOSTR_SIGNER_INVALID_EVENT` | `RawError`\<`"NOSTR_SIGNER_INVALID_EVENT"`\> |
| <a id="property-nostr_relays_not_configured"></a> `NOSTR_RELAYS_NOT_CONFIGURED` | `RawError`\<`"NOSTR_RELAYS_NOT_CONFIGURED"`\> |
| <a id="property-nostr_unknown_error"></a> `NOSTR_UNKNOWN_ERROR` | `RawError`\<`"NOSTR_UNKNOWN_ERROR"`\> |

## Functions

### nostr()

> **nostr**(`options?`): `object`

The server plugin.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options?` | [`NostrOptions`](better-auth-nostr/client.md#nostroptions) |

#### Returns

`object`

| Name | Type | Default value |
| ------ | ------ | ------ |
| `id` | `"nostr"` | `"nostr"` |
| `version` | `string` | `PACKAGE_VERSION` |

## References

### NostrOptions

Re-exports [NostrOptions](better-auth-nostr/client.md#nostroptions)

***

### NostrSignUpCandidate

Re-exports [NostrSignUpCandidate](better-auth-nostr/client.md#nostrsignupcandidate)
