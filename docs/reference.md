---
title: Reference
description: Every endpoint, client action and error code of the plugin.
---

The endpoints, client actions and error codes of the plugin; the schema and options are on [Getting started](index.mdx#schema). The [guide](guide.md) explains how the pieces fit together.

## API

Every export and option of [`better-auth-nostr`](api/better-auth-nostr.md) and [`better-auth-nostr/client`](api/better-auth-nostr/client.md) has its own generated page, from the JSDoc in `src/`:

| Function | Options |
| --- | --- |
| `nostr(options?)` | [`NostrOptions`](api/better-auth-nostr/client.md#nostroptions) |
| `nostrClient(options?)` | [`RelayOptions`](api/better-auth-nostr/client.md#relayoptions) |
| `signIn.nostr`, `nostr.addPubkey`, `nostr.signEvent` | [`SignerSource`](api/better-auth-nostr/client.md#signersource) |
| `createBunkerSigner(input, options?)` | [`BunkerSignerOptions`](api/better-auth-nostr/client.md#bunkersigneroptions) |
| `createNostrConnectSession(options?)` | [`NostrConnectOptions`](api/better-auth-nostr/client.md#nostrconnectoptions) |

The client signs against `baseURL + basePath` from `createAuthClient`, falling back to `window.location.origin` and `/api/auth`. Outside a browser and without a `baseURL`, `signIn.nostr` and `nostr.addPubkey` fail with `NOSTR_UNKNOWN_ERROR`.

## Endpoints

Paths are relative to Better Auth's base path, `/api/auth` by default. Every endpoint answers JSON, and the `POST` ones take a JSON body. Besides the codes listed, a malformed body answers `400 VALIDATION_ERROR`, and a client over the endpoint's [rate limit](guide.md#rate-limits) `429`.

### POST /nostr/nonce

Issues a single-use nonce bound to a public key. No session needed.

- Body: `{ publicKey }`, 64 hex characters.
- Response: `{ nonce }`.
- Errors: a `getNonce` that returns an invalid value makes this a `500`.

### POST /nostr/login

Signs in with a NIP-98 token, creating the user on first sign-in unless `disableImplicitSignUp` is set. Sets the session cookie.

- Header: `Authorization: Nostr <base64 event>`, a kind `27235` event signed for this endpoint's absolute URL, method `post` and the body's hash.
- Body: `{ nonce }`, from `/nostr/nonce` for the same key.
- Response: `{ session, user }`.
- Errors: `NOSTR_MISSING_TOKEN`, `NOSTR_INVALID_TOKEN`, `NOSTR_INVALID_EVENT`, `NOSTR_EVENT_EXPIRED`, `NOSTR_INVALID_NONCE`, `NOSTR_PUBKEY_NOT_REGISTERED`, `NOSTR_FAILED_TO_CREATE_PUBKEY`, and Better Auth's `USER_NOT_FOUND` (401, the key's user is gone), `FAILED_TO_CREATE_USER` (500) and `FAILED_TO_CREATE_SESSION` (500 when storage fails, 401 when a hook denies the session).

### POST /nostr/add-pubkey

Links the key that signed the token to the signed-in user. Needs a session, and like every session-authenticated Better Auth endpoint an `Origin` header matching `baseURL` (browsers send it; scripts must, or get `403`).

- Header: `Authorization`, as for `/nostr/login` but signed for this endpoint's URL.
- Body: `{ nonce, name? }`, with `name` 1–120 characters.
- Response: `{ pubkey }`, the `NostrPubkey` row. Linking a key the user already owns returns the existing row.
- Errors: the token and nonce codes of `/nostr/login`, `NOSTR_PUBKEY_LINKED_TO_OTHER_USER` (409) and `NOSTR_FAILED_TO_CREATE_PUBKEY` (500). Without a session, `401`.

### GET /nostr/list-pubkeys

Lists the keys linked to the signed-in user. Needs a session.

- Response: `{ id, publicKey, npub, name, createdAt, lastUsedAt }[]`. `name` and `lastUsedAt` are `null` until set.
- Errors: without a session, `401`.

### POST /nostr/update-pubkey

Renames one of the signed-in user's keys. Needs a session.

- Body: `{ id, name }`, with `id` from `/nostr/list-pubkeys` and `name` 1–120 characters.
- Response: `{ pubkey }`, the updated `NostrPubkey` row.
- Errors: `NOSTR_PUBKEY_NOT_FOUND` (404) for an id the user doesn't own. Without a session, `401`.

### POST /nostr/remove-pubkey

Unlinks one of the signed-in user's keys and deletes its `account` row. Needs a fresh session, like Better Auth's `unlinkAccount`.

- Body: `{ id }`.
- Response: `{ status: true }`.
- Errors: `NOSTR_PUBKEY_NOT_FOUND` (404) for an id the user doesn't own, `NOSTR_CANNOT_REMOVE_LAST_PUBKEY` (400) when it is the user's last way to sign in and `account.accountLinking.allowUnlinkingAll` is off. Without a session, `401`; with a session older than `session.freshAge`, `403 SESSION_NOT_FRESH`.

## Client actions

Every action resolves to Better Auth's `{ data, error }` and never throws. `error` carries `code`, `message`, `status` and `statusText`.

### signIn.nostr

```ts
authClient.signIn.nostr(options?: SignerSource, fetchOptions?: BetterFetchOption)
```

Fetches a nonce, signs the NIP-98 event and calls `/nostr/login`. `data` is `{ session, user }`. On success the session store refreshes, so `useSession` picks up the new user.

### nostr.addPubkey

```ts
authClient.nostr.addPubkey(options?: SignerSource & { name?: string }, fetchOptions?: BetterFetchOption)
```

Same flow against `/nostr/add-pubkey`, with the current session. `name` is a label of 1–120 characters stored with the key. `data` is `{ pubkey }`.

### nostr.listPubkeys

```ts
authClient.nostr.listPubkeys(fetchOptions?: BetterFetchOption)
```

Calls `GET /nostr/list-pubkeys`. `data` is the list of the user's keys.

### nostr.updatePubkey

```ts
authClient.nostr.updatePubkey({ id, name }, fetchOptions?: BetterFetchOption)
```

Calls `POST /nostr/update-pubkey`. `data` is `{ pubkey }`.

### nostr.removePubkey

```ts
authClient.nostr.removePubkey({ id }, fetchOptions?: BetterFetchOption)
```

Calls `POST /nostr/remove-pubkey`. `data` is `{ status: true }`.

### nostr.signEvent

```ts
authClient.nostr.signEvent(template: EventTemplate, options?: SignerSource)
```

Signs any event with the resolved signer, without a server request. `data` is the signed event, after its signature and pubkey have been checked.

### nostr.getProfile

```ts
authClient.nostr.getProfile(input: string, options?: { timeoutMs?: number })
```

Only present when `nostrClient` has `relays`. Resolves an npub, nprofile, hex pubkey or NIP-05 identifier and fetches the newest kind `0` event from your relays and the input's relay hints. `timeoutMs` overrides `relayTimeoutMs` for the call. `data` is a `NostrProfile`, or `null` when nothing is found.

## Error codes

Every action resolves to `{ data, error }`. On failure, `error.code` is one of the codes below and `error.message` a default English message. Match on the code: codes are public API from 1.0 and only change in a breaking release, while messages can change in any release. Both plugins declare the codes as `$ERROR_CODES`, so `keyof typeof authClient.$ERROR_CODES` includes them for error translations, and `NOSTR_ERROR_CODES` and its `NostrErrorCode` type are exported for comparing at runtime.

### From the server

Besides these, the endpoints answer with Better Auth's own `VALIDATION_ERROR` (400), `USER_NOT_FOUND` (401), `FAILED_TO_CREATE_USER` (500) and `FAILED_TO_CREATE_SESSION`, and with 429 over the [rate limit](guide.md#rate-limits).

<!-- generated:server-errors -->

| Code | Status | When | What to do |
| --- | --- | --- | --- |
| `NOSTR_MISSING_TOKEN` | 400 | No NIP-98 token in the `Authorization` header. | Call through `signIn.nostr` or `nostr.addPubkey`, which send it, or send `Authorization: Nostr <base64 event>`. |
| `NOSTR_INVALID_TOKEN` | 400 | The header is not a NIP-98 token. | Send a base64-encoded kind `27235` event after `Nostr `. |
| `NOSTR_INVALID_EVENT` | 401 | The event's signature, kind, URL, method or payload is wrong. | Make the client's `baseURL` and `basePath` match the server's, so the event is signed for the URL the server checks. |
| `NOSTR_EVENT_EXPIRED` | 401 | The event was signed more than 60 seconds before or after now. | Sign again, and check the signing device's clock. |
| `NOSTR_INVALID_NONCE` | 400 or 401 | The nonce is blank (400), or unknown, used, expired or issued for another key (401). | Fetch a new nonce for the same key and sign again; the actions do this on every call. |
| `NOSTR_PUBKEY_NOT_REGISTERED` | 401 | `disableImplicitSignUp` is set and the key has no user. | Sign in another way and link the key with `nostr.addPubkey` first. |
| `NOSTR_PUBKEY_LINKED_TO_OTHER_USER` | 409 | `addPubkey` for a key another user owns. | Sign in with that key to reach the account that owns it. |
| `NOSTR_FAILED_TO_CREATE_PUBKEY` | 500 | Storing the key failed. | Check the server log and the database, then retry. |
| `NOSTR_PUBKEY_NOT_FOUND` | 404 | `updatePubkey` or `removePubkey` for a key id the user does not own. | Take the id from `nostr.listPubkeys` for the signed-in user. |
| `NOSTR_CANNOT_REMOVE_LAST_PUBKEY` | 400 | `removePubkey` for the user's last way to sign in. | Link another key or sign-in method first, or set `account.accountLinking.allowUnlinkingAll`. See [Key loss and recovery](key-loss.md). |

<!-- /generated:server-errors -->

### From the client

The client reports these before or instead of a request, in the shape Better Auth's passkey client uses: `statusText` is `"REQUEST_TIMEOUT"` for 408 and `"BAD_REQUEST"` otherwise.

<!-- generated:client-errors -->

| Code | Status | When | What to do |
| --- | --- | --- | --- |
| `NOSTR_NO_SIGNER` | 400 | No `signer`, no `nsec` and no NIP-07 extension. | Pass a `signer` or `nsec`, or ask the user to install a NIP-07 extension. |
| `NOSTR_SIGNER_TIMEOUT` | 408 | The signer did not answer within `timeoutMs`. | Retry, or raise `timeoutMs` for a remote signer that waits on a person. |
| `NOSTR_SIGNER_TOO_SLOW` | 400 | The signer approved so late that the server would reject the event. | Retry and approve within a minute. |
| `NOSTR_SIGNER_CLOCK_SKEW` | 400 | The signer's clock runs ahead of this device's. | Fix the clock on the signing device. |
| `NOSTR_SIGNER_KEY_MISMATCH` | 400 | The signer signed with a different key than it reported. | Sign in again with the key the signer holds now. |
| `NOSTR_SIGNER_INVALID_EVENT` | 400 | The signer's event does not verify. | Try another signer, and report the broken one to its maintainers. |
| `NOSTR_RELAYS_NOT_CONFIGURED` | 400 | `getProfile` without `nostrClient({ relays })`. | Pass `relays` to `nostrClient`. |
| `NOSTR_UNKNOWN_ERROR` | 400 | Anything else, such as a signer that refuses, an invalid `nsec` or a missing `baseURL`. | Read `error.message`. Outside a browser, set `baseURL` on the client. |

<!-- /generated:client-errors -->
