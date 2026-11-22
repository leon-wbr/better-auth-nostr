---
title: better-auth-nostr/client
---

The client plugin and signers, imported from `better-auth-nostr/client`.

## Interfaces

### NostrSigner

Anything that can hand out a public key and sign an event: a local secret
key, a NIP-07 extension, or a NIP-46 remote signer. Every `Signer` from
`nostr-tools/signer` is one; this type is wider (it doesn't require a
`VerifiedEvent`) so that any caller-supplied signer fits.

#### Extended by

- [`RemoteNostrSigner`](#remotenostrsigner)

#### Methods

##### getPublicKey()

> **getPublicKey**(): `Promise`\<`string`\>

###### Returns

`Promise`\<`string`\>

##### signEvent()

> **signEvent**(`event`): `Promise`\<`NostrEvent`\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `event` | `EventTemplate` |

###### Returns

`Promise`\<`NostrEvent`\>

***

### RemoteNostrSigner

A signer backed by a live NIP-46 connection to a remote signer.

#### Extends

- [`NostrSigner`](#nostrsigner)

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-clientsecretkey"></a> `clientSecretKey` | `public` | `Uint8Array` | Persist alongside `bunkerUri` to resume without a new approval prompt. |
| <a id="property-bunkeruri"></a> `bunkerUri` | `readonly` | `string` | The connection as a `bunker://` URI, resolved after the handshake. Persist it with `clientSecretKey` and hand both back to `createBunkerSigner` to resume — this is the only way to resume a `nostrconnect://` session, whose remote pubkey and relays are not known until the signer answers. |

#### Methods

##### getPublicKey()

> **getPublicKey**(): `Promise`\<`string`\>

###### Returns

`Promise`\<`string`\>

###### Inherited from

[`NostrSigner`](#nostrsigner).[`getPublicKey`](#getpublickey)

##### signEvent()

> **signEvent**(`event`): `Promise`\<`NostrEvent`\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `event` | `EventTemplate` |

###### Returns

`Promise`\<`NostrEvent`\>

###### Inherited from

[`NostrSigner`](#nostrsigner).[`signEvent`](#signevent)

##### close()

> **close**(): `Promise`\<`void`\>

Closes the relay subscription, and the pool if we opened it.

###### Returns

`Promise`\<`void`\>

***

### BunkerSignerOptions

Options of `createBunkerSigner`.

#### Extends

- `RemoteTransportOptions`

#### Properties

| Property | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-clientsecretkey-1"></a> `clientSecretKey?` | `Uint8Array`\<`ArrayBufferLike`\> | `a new key` | The client-side key that talks to the remote signer. Pass the persisted one, with `signer.bunkerUri`, to resume a session without a new approval prompt. |
| <a id="property-onauthurl"></a> `onAuthUrl?` | (`url`) => `void` | `undefined` | Called with a URL the user must open to approve the connection. |
| <a id="property-perms"></a> `perms?` | `string`[] | `["sign_event:27235"]` | NIP-46 permissions to request. The default only covers sign-in. |
| <a id="property-metadata"></a> `metadata?` | `ClientMetadata` | `undefined` | `name`, `url` and `image` the remote signer shows while approving. |
| <a id="property-pool"></a> `pool?` | `AbstractSimplePool` | `a new pool` | A `nostr-tools` relay pool. One you pass stays open on `close()`; one opened for you is closed. |
| <a id="property-timeoutms"></a> `timeoutMs?` | `number` | `300000 (5 minutes)` | How long to wait for the connection to be approved. |

***

### NostrConnectOptions

Options of `createNostrConnectSession`.

#### Extends

- `RemoteTransportOptions`

#### Properties

| Property | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-clientsecretkey-2"></a> `clientSecretKey?` | `Uint8Array`\<`ArrayBufferLike`\> | `a new key` | The client-side key that talks to the remote signer. Pass the persisted one, with `signer.bunkerUri`, to resume a session without a new approval prompt. |
| <a id="property-onauthurl-1"></a> `onAuthUrl?` | (`url`) => `void` | `undefined` | Called with a URL the user must open to approve the connection. |
| <a id="property-perms-1"></a> `perms?` | `string`[] | `["sign_event:27235"]` | NIP-46 permissions to request. The default only covers sign-in. |
| <a id="property-metadata-1"></a> `metadata?` | `ClientMetadata` | `undefined` | `name`, `url` and `image` the remote signer shows while approving. |
| <a id="property-pool-1"></a> `pool?` | `AbstractSimplePool` | `a new pool` | A `nostr-tools` relay pool. One you pass stays open on `close()`; one opened for you is closed. |
| <a id="property-relays"></a> `relays?` | `string`[] | `["wss://relay.nsec.app"]` | Relays the remote signer should answer on. |
| <a id="property-secret"></a> `secret?` | `string` | `random` | The connection secret in the URI. |

***

### RelayOptions

`relays` and `relayTimeoutMs`: the client options of `nostrClient(options?)`, shared with the server options.

#### Extended by

- [`NostrOptions`](#nostroptions)

#### Properties

| Property | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-relays-1"></a> `relays?` | \[`string`, `...string[]`\] | `none` | Relays this app reads from, at least one. This library never picks relays for you. On the server, a new user is filled from their kind `0` profile at sign-up (best effort; sign-up waits on the lookup up to `relayTimeoutMs`); when unset, the server never contacts a relay. On the client, `nostr.getProfile` reads from them; without them it is missing from the client's types and returns `NOSTR_RELAYS_NOT_CONFIGURED`. |
| <a id="property-relaytimeoutms"></a> `relayTimeoutMs?` | `number` | `5000` | How long to wait on relays, in milliseconds. |

***

### NostrOptions

The server options of `nostr(options?)`. All are optional.

#### Extends

- [`RelayOptions`](#relayoptions)

#### Properties

| Property | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-relays-2"></a> `relays?` | \[`string`, `...string[]`\] | `none` | Relays this app reads from, at least one. This library never picks relays for you. On the server, a new user is filled from their kind `0` profile at sign-up (best effort; sign-up waits on the lookup up to `relayTimeoutMs`); when unset, the server never contacts a relay. On the client, `nostr.getProfile` reads from them; without them it is missing from the client's types and returns `NOSTR_RELAYS_NOT_CONFIGURED`. |
| <a id="property-relaytimeoutms-1"></a> `relayTimeoutMs?` | `number` | `5000` | How long to wait on relays, in milliseconds. |
| <a id="property-disablesignup"></a> `disableSignUp?` | `boolean` | `false` | Reject sign-ins from keys that are not linked to a user yet (`NOSTR_PUBKEY_NOT_REGISTERED`) instead of creating a user. |
| <a id="property-disableimplicitsignup"></a> ~~`disableImplicitSignUp?`~~ | `boolean` | `undefined` | **Deprecated** Use `disableSignUp`; removed in 1.0. |
| <a id="property-schema"></a> `schema?` | `object` | `undefined` | Rename the pubkey model and its columns, for an existing table, as with Better Auth's own plugins. **Example** ``{ nostrPubkey: { modelName: "nostr_keys", fields: { publicKey: "pub_key" } } }`` |
| `schema.nostrPubkey?` | `object` | `...` | - |
| `schema.nostrPubkey.modelName?` | `string` | `undefined` | - |
| `schema.nostrPubkey.fields?` | `object` | `undefined` | - |
| `schema.nostrPubkey.fields.name?` | `string` | `...` | - |
| `schema.nostrPubkey.fields.publicKey?` | `string` | `...` | - |
| `schema.nostrPubkey.fields.userId?` | `string` | `...` | - |
| `schema.nostrPubkey.fields.createdAt?` | `string` | `...` | - |
| `schema.nostrPubkey.fields.lastUsedAt?` | `string` | `...` | - |
| `schema.nostrPubkey.fields.nip05?` | `string` | `...` | - |
| `schema.nostrPubkey.fields.nip05VerifiedAt?` | `string` | `...` | - |
| <a id="property-modelname"></a> ~~`modelName?`~~ | `string` | `undefined` | **Deprecated** Use `schema.nostrPubkey.modelName`; removed in 1.0. |
| <a id="property-noncettlms"></a> `nonceTtlMs?` | `number` | `300000 (5 minutes)` | How long an issued nonce stays valid, in milliseconds. |
| <a id="property-getnonce"></a> `getNonce?` | () => `Promise`\<`string`\> | `16 random bytes as hex` | Your own nonce generator. Each call must return a fresh value of 8–249 characters from `[A-Za-z0-9_-]`; anything else makes `/nostr/nonce` fail. |
| <a id="property-generateemail"></a> `generateEmail?` | (`npub`, `pubkey`) => `string` \| `Promise`\<`string`\> | `npub1…@nostr.placeholder.invalid` | The email of a user created at sign-in, sync or async. Receives the npub and the hex pubkey. |
| <a id="property-fields"></a> ~~`fields?`~~ | `object` | `undefined` | **Deprecated** Use `schema.nostrPubkey.fields`; removed in 1.0. |
| `fields.name?` | `string` | `...` | - |
| `fields.publicKey?` | `string` | `...` | - |
| `fields.userId?` | `string` | `...` | - |
| `fields.createdAt?` | `string` | `...` | - |
| `fields.lastUsedAt?` | `string` | `...` | - |
| `fields.nip05?` | `string` | `...` | - |
| `fields.nip05VerifiedAt?` | `string` | `...` | - |
| <a id="property-mapprofiletouser"></a> `mapProfileToUser?` | (`profile`) => [`NostrMappedUser`](#nostrmappeduser) \| `Promise`\<[`NostrMappedUser`](#nostrmappeduser)\> | `display_name` or `name`, and an `https:` `picture` | Maps a `NostrProfile` to user fields, sync or async. The result is spread over the default mapping; extra keys go to `user.additionalFields`; `email`, `emailVerified` and `id` are not allowed. |
| <a id="property-ratelimit"></a> `rateLimit?` | `Partial`\<`Record`\<`"nonce"` \| `"login"` \| `"addPubkey"`, \{ `window`: `number`; `max`: `number`; \}\>\> | `nonce 10 per 60s, login 3 per 10s, add-pubkey 5 per 60s` | Rate limits per endpoint, in Better Auth's `{ window, max }` form (seconds, requests). Like every Better Auth rate limit, they apply only where `rateLimit.enabled` is on, by default in production. |
| <a id="property-allowdynamicbaseurl"></a> `allowDynamicBaseURL?` | `boolean` | `false` | Accept a server without `baseURL` or `BETTER_AUTH_URL`, whose URL, and so the URL NIP-98 signatures are bound to, comes from each request's `Host` header. Without it the plugin warns at init, and refuses to start in production. |
| <a id="property-overrideuserinfoonsignin"></a> `overrideUserInfoOnSignIn?` | `boolean` | `false` | Also refresh an existing user from their profile on every sign-in, not only at sign-up. Needs `relays`. |
| <a id="property-verifynip05"></a> `verifyNip05?` | `true` \| \{ `allowedDomains?`: `string`[]; `required?`: `boolean`; `timeoutMs?`: `number`; \} | `off` | Check the `nip05` claim of the kind `0` profile against the domain's `nostr.json` at sign-up, and store a match on the pubkey row as `nip05` and `nip05VerifiedAt`. Needs `relays`. The server then makes an HTTPS request to a host named in the profile: `allowedDomains` limits it to your domains, `required` refuses sign-up and every sign-in (each re-verified) without a match (`NOSTR_IDENTIFIER_NOT_VERIFIED`), and `timeoutMs` bounds the request (default 5000). |

***

### NostrPubkey

A row of the `nostrPubkey` model, as stored and as returned to clients.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-id"></a> `id` | `string` | - |
| <a id="property-publickey"></a> `publicKey` | `string` | - |
| <a id="property-userid"></a> `userId` | `string` | - |
| <a id="property-name"></a> `name?` | `string` \| `null` | - |
| <a id="property-createdat"></a> `createdAt` | `Date` | - |
| <a id="property-lastusedat"></a> `lastUsedAt?` | `Date` \| `null` | When the pubkey last signed in; null until then. |
| <a id="property-nip05"></a> `nip05?` | `string` \| `null` | The NIP-05 identifier `verifyNip05` last verified, as `name@domain`. |
| <a id="property-nip05verifiedat"></a> `nip05VerifiedAt?` | `Date` \| `null` | When `nip05` was verified. |

## Type Aliases

### NostrProfileMetadata

> **NostrProfileMetadata** = `z.infer`\<*typeof* `profileMetadataSchema`\>

The kind `0` fields: `name`, `display_name`, `about`, `picture`, `banner`, `website`, `nip05`, `lud16`, plus unknown keys.

***

### NostrProfile

> **NostrProfile** = `Required`\<`ProfilePointer`\> & `object`

A kind `0` profile: `pubkey`, `relays`, `metadata` and the source `event`.

#### Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `metadata` | [`NostrProfileMetadata`](#nostrprofilemetadata) | - |
| `event` | `NostrEvent` | The kind 0 event the metadata came from. |

***

### SignerSource

> **SignerSource** = `object`

Which signer `signIn.nostr`, `nostr.addPubkey` and `nostr.signEvent` use.
Without `signer` or `nsec`, the NIP-07 extension at `window.nostr` signs.

#### Properties

| Property | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-signer"></a> `signer?` | [`NostrSigner`](#nostrsigner) | `undefined` | Any `NostrSigner`: a bunker session, a hardware signer, a test double. Wins over `nsec`. |
| <a id="property-nsec"></a> `nsec?` | `string` | `undefined` | A bech32 nsec or 64-character hex secret key. Used when no `signer` is given. |
| <a id="property-timeoutms-1"></a> `timeoutMs?` | `number` | `300000 (5 minutes)` | How long to wait for the signer before failing with `NOSTR_SIGNER_TIMEOUT`. |

***

### NostrConnectSession

> **NostrConnectSession** = `object`

A `nostrconnect://` URI plus `connect()`, from `createNostrConnectSession`.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-uri"></a> `uri` | `string` | Show this to the user as a QR code or a copyable link. |
| <a id="property-clientsecretkey-3"></a> `clientSecretKey` | `Uint8Array` | Persist this with the resulting signer's `bunkerUri` to resume later. |
| <a id="property-connect"></a> `connect` | (`timeoutMsOrSignal?`) => `Promise`\<[`RemoteNostrSigner`](#remotenostrsigner)\> | Resolves once the remote signer has approved the connection, and rejects when the deadline passes. Call it once per session. |

***

### NostrMappedUser

> **NostrMappedUser** = `object`

What `mapProfileToUser` returns, as for a social provider: spread over the
default mapping, with extra keys going to the user's additional fields.
Identity and email never come from a self-claimed kind 0 profile.

#### Indexable

> \[`key`: `string`\]: `unknown`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-name-1"></a> `name?` | `string` |
| <a id="property-image"></a> `image?` | `string` |
| <a id="property-email"></a> `email?` | `never` |
| <a id="property-emailverified"></a> `emailVerified?` | `never` |
| <a id="property-id-1"></a> `id?` | `never` |

***

### ~~Nostr~~

> **Nostr** = [`NostrPubkey`](#nostrpubkey)

#### Deprecated

Use `NostrPubkey`.

## Functions

### getNostrActions()

> **getNostrActions**(`$fetch`, `__namedParameters`, `options?`, `relayOptions?`): `object`

Builds the actions `nostrClient` installs; for wiring them into a custom client.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `$fetch` | `BetterFetch` |
| `__namedParameters` | \{ `$store`: `ClientStore`; \} |
| `__namedParameters.$store` | `ClientStore` |
| `options?` | `BetterAuthClientOptions` |
| `relayOptions?` | [`RelayOptions`](#relayoptions) |

#### Returns

`object`

| Name | Type |
| ------ | ------ |
| `signIn` | \{ `nostr`: (`signInOptions?`, `fetchOptions?`) => `Promise`\<`Error$1`\<`ServerError`\> \| `Data`\<\{ `session`: \{ `id`: `string`; `userId`: `string`; `expiresAt`: `Date`; \}; `user`: \{ `id`: `string`; `email`: `string`; `name`: `string`; \}; \}\>\>; \} |
| `nostr` | \{ `addPubkey`: (`addOptions?`, `fetchOptions?`) => `Promise`\<`Error$1`\<`ServerError`\> \| `Data`\<\{ `pubkey`: [`NostrPubkey`](#nostrpubkey); \}\>\>; `signEvent`: (`template`, `source?`) => `Promise`\<`ActionResult`\<`NostrEvent`\>\>; `getProfile`: (`input`, `callOptions?`) => `Promise`\<`ActionResult`\<[`NostrProfile`](#nostrprofile) \| `null`\>\>; \} |
| `$Infer` | \{ `Nostr`: [`NostrPubkey`](#nostrpubkey); \} |

***

### nostrClient()

> **nostrClient**\<`O`\>(`relayOptions?`): `object`

The client plugin. Its options are `RelayOptions`.

#### Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| <a id="type-parameter-o"></a> `O` *extends* [`RelayOptions`](#relayoptions) | [`RelayOptions`](#relayoptions) |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `relayOptions?` | `O` |

#### Returns

`object`

| Name | Type | Default value |
| ------ | ------ | ------ |
| `id` | `"nostr"` | `"nostr"` |
| `version` | `string` | `PACKAGE_VERSION` |

***

### parseSecretKey()

> **parseSecretKey**(`input`): `Uint8Array`

Decodes a bech32 nsec or hex secret key; throws on anything else.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | `string` |

#### Returns

`Uint8Array`

***

### createPrivateKeySigner()

> **createPrivateKeySigner**(`nsec`): [`NostrSigner`](#nostrsigner)

Signs locally with a raw secret key held in the browser.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `nsec` | `string` |

#### Returns

[`NostrSigner`](#nostrsigner)

***

### createExtensionSigner()

> **createExtensionSigner**(): [`NostrSigner`](#nostrsigner) \| `null`

Signs through the NIP-07 extension at `window.nostr`; `null` without one.

#### Returns

[`NostrSigner`](#nostrsigner) \| `null`

***

### createBunkerSigner()

> **createBunkerSigner**(`input`, `options?`): `Promise`\<[`RemoteNostrSigner`](#remotenostrsigner)\>

Connects to a NIP-46 remote signer the user already has, addressed by a
`bunker://` URI or a NIP-05 identifier (nsec.app, Amber, nsecbunker, …).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | `string` |
| `options?` | [`BunkerSignerOptions`](#bunkersigneroptions) |

#### Returns

`Promise`\<[`RemoteNostrSigner`](#remotenostrsigner)\>

***

### createNostrConnectSession()

> **createNostrConnectSession**(`options?`): [`NostrConnectSession`](#nostrconnectsession)

Starts the client-initiated half of NIP-46: we mint a `nostrconnect://` URI
for the user to scan, then wait for the remote signer to reach out to us.

URI generation is synchronous so the QR code can be rendered immediately;
nothing touches the network until `connect()` is awaited.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options?` | [`NostrConnectOptions`](#nostrconnectoptions) |

#### Returns

[`NostrConnectSession`](#nostrconnectsession)

## References

### NOSTR\_ERROR\_CODES

Re-exports [NOSTR_ERROR_CODES](../better-auth-nostr.md#nostr_error_codes)

***

### NostrErrorCode

Re-exports [NostrErrorCode](../better-auth-nostr.md#nostrerrorcode)
