# Guide

[Getting started](index.md) gets a first sign-in working. This page explains the parts around it: where signatures come from, how profiles and relays work, and what the server checks. Every option named here is listed in the [API pages](api/index.md).

## Signers

`signIn.nostr`, `nostr.addPubkey` and `nostr.signEvent` all need something that signs. They pick it in this order:

1. a `signer` you pass in: anything with `getPublicKey()` and `signEvent()`, including a NIP-46 remote signer,
2. an `nsec` you pass in, bech32 or 64-character hex,
3. a browser extension that exposes `window.nostr.signEvent` (NIP-07).

If none is there, the action fails with `NOSTR_NO_SIGNER`.

### Browser extensions (NIP-07)

Alby, nos2x and similar extensions inject `window.nostr`. Call the action without a signer and the extension prompts the user:

```ts
await authClient.signIn.nostr();
```

### A private key (nsec)

```ts
await authClient.signIn.nostr({ nsec });
```

The key stays in the browser and is used for one signature. Asking people to paste an nsec into a web app is risky, though: prefer an extension or a remote signer, and keep this for test keys and for apps that hold keys on purpose.

### Your own signer

Any object with `getPublicKey(): Promise<string>` and `signEvent(template): Promise<Event>` works. `NostrSigner` is structurally compatible with `Signer` from `nostr-tools/signer` (a compile-time assertion in the source keeps it that way), so an existing implementation, including a bare `PlainKeySigner`, can be passed straight through:

```ts
await authClient.signIn.nostr({ signer: mySigner });
```

### Remote signers (NIP-46)

Most people keep their key in a remote signer, such as Amber, nsec.app or nsecbunker, rather than pasting an nsec into a web app. Both halves of NIP-46 are supported, and both produce a signer you hand to `signIn.nostr` or `nostr.addPubkey`.

The user pastes a `bunker://` URI, or a NIP-05 identifier whose provider advertises NIP-46:

```ts
import { createBunkerSigner } from "better-auth-nostr/client";

const signer = await createBunkerSigner(uri, {
  onAuthUrl: (url) => window.open(url, "_blank"),
  metadata: { name: "My App", url: window.location.origin },
  timeoutMs: 120_000,
});

try {
  await authClient.signIn.nostr({ signer });
} finally {
  await signer.close();
}
```

Or the app mints a `nostrconnect://` URI for the user to scan. The URI is generated synchronously so you can render the QR code immediately; nothing touches the network until `connect()` is awaited:

```ts
import { createNostrConnectSession } from "better-auth-nostr/client";

const session = createNostrConnectSession({
  metadata: { name: "My App" },
  relays: ["wss://relay.nsec.app"],
});
showQrCode(session.uri);

// Resolves once the signer approves, rejects when the deadline passes.
const signer = await session.connect(120_000);
await authClient.signIn.nostr({ signer });
```

A remote signer is a live relay subscription, so its lifetime is yours to manage: call `close()` when you are done. That closes the subscription, and the relay pool too unless you supplied your own via `pool`.

**Resuming.** To resume a session later without a second approval prompt, persist both `signer.clientSecretKey` and `signer.bunkerUri`, then hand them back to `createBunkerSigner(bunkerUri, { clientSecretKey })`. This works for either flow: a `nostrconnect://` session learns its signer's pubkey and relays during the handshake, and `bunkerUri` is how you keep them.

**Timeouts.** Every remote call is bounded by `timeoutMs`: 5 minutes by default, and settable per request through `signIn.nostr({ signer, timeoutMs })`. Without one, a signer that never answers would leave the promise pending forever, since NIP-46 requests have no deadline of their own. A timeout fails with `NOSTR_SIGNER_TIMEOUT` (status 408).

**Permissions.** Both flows request only `sign_event:27235` by default, which is enough to authenticate and nothing else. Widen it with `perms` if your app also signs notes. Some signers ignore requested permissions and prompt for every signature; there, each signature waits on a human, which is what the next paragraph is about.

**The 60-second limit.** NIP-98 stamps `created_at` before the event is signed, and the server rejects anything more than 60 seconds off. A remote signer that waits on someone tapping "approve" on a phone can run past that. The client notices a few seconds before the server's limit, leaving room for network transit, and fails with `NOSTR_SIGNER_TOO_SLOW` instead of an opaque `401`. A signer whose clock runs ahead fails with `NOSTR_SIGNER_CLOCK_SKEW`.

### Signing other events

The same signer resolution powers a post-login helper, so an app can publish a note or update a profile without a second signing path:

```ts
const { data: event, error } = await authClient.nostr.signEvent(
  { kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: "gm" },
  { signer },
);
```

It takes the same `signer`, `nsec` and NIP-07 precedence and the same `timeoutMs` as `signIn.nostr`, makes no server request, and returns `{ data, error }` instead of throwing. The event is checked before you see it: its signature must verify (`NOSTR_SIGNER_INVALID_EVENT`) and its pubkey must match the one the signer reported (`NOSTR_SIGNER_KEY_MISMATCH`). A remote signer only signs kinds it was granted, so widen `perms` (for example `sign_event:1`) when you create it.

## Profiles and relays

### No default relays

This plugin ships with no default relays, on purpose. Which relays your app talks to is a product decision (privacy, reliability, censorship resistance, who sees your users' pubkeys and IP addresses), and a library that picks for you makes that decision silently. Every feature that reads from relays therefore needs `relays` configured. On the client, `nostr.getProfile` doesn't even exist in the types until you set them.

Two options set this up. Both are top-level options of `nostr()` and `nostrClient()`, since they describe how to reach relays rather than what a feature does with the data:

- `relays`: the relays to read from. No default.
- `relayTimeoutMs`: how long to wait on relays, in milliseconds. Defaults to 5000.

The `nostrconnect://` flow is the one exception: `createNostrConnectSession` falls back to `wss://relay.nsec.app` when you pass no `relays`, because the signer has to be told somewhere to answer.

### Showing a profile in the browser

Configure relays on the client and `nostr.getProfile` resolves an npub, nprofile, hex pubkey or NIP-05 identifier and returns the newest kind `0` metadata, for showing a name and avatar or prefilling a sign-up form:

```ts
export const authClient = createAuthClient({
  plugins: [nostrClient({ relays: ["wss://relay.example.com"] })],
});

const { data: profile, error } = await authClient.nostr.getProfile("alice@example.com");
profile?.metadata.display_name;
```

It runs in the browser and makes no server request. Relay hints from an nprofile or the NIP-05 record are queried alongside your `relays`, the newest kind `0` event wins, and the pool verifies its signature. `data` is `null` when the identity does not resolve or no relay has a profile, and `error` is set for input it cannot interpret. `relayTimeoutMs` bounds the wait, and `getProfile(input, { timeoutMs })` overrides it per call. `input` is required: the session does not carry the user's pubkey, so pass the one you signed in with.

`metadata` keeps the NIP-01 and NIP-24 string fields (`name`, `display_name`, `about`, `picture`, `banner`, `website`, `nip05`, `lud16`) and passes unknown keys through; a known field with the wrong type is dropped. Metadata is user-supplied and unverified: treat `picture` and `website` as untrusted URLs, and `nip05` as a claim until you have checked it against the pubkey.

### Filling the user from the profile

Set `relays` on the server and a new user is filled from their kind `0` profile at sign-up. The profile options mirror `mapProfileToUser` and `overrideUserInfoOnSignIn` on Better Auth's social providers, so they behave the way you already know:

```ts
nostr({
  relays: ["wss://relay.example.com"],
  mapProfileToUser: ({ metadata }) => ({
    name: metadata.display_name?.slice(0, 80),
    lud16: metadata.lud16,
  }),
});
```

The default mapping, the counterpart of GitHub's `name || login` and `avatar_url`, takes `display_name` or else `name` (trimmed) and an `https:` `picture`. Whatever `mapProfileToUser` returns is spread over that, so you only return what you want to change. Extra keys are filtered through `user.additionalFields` the same way a social provider's are; keys that are not declared fields are dropped.

Setting `relays` is the opt-in: without it the server never contacts a relay and the name stays the npub. A new user gets the mapped fields at sign-up; an existing user is only updated when `overrideUserInfoOnSignIn` is on, which costs a relay round-trip on every sign-in. Sign-up waits on the relay lookup for up to `relayTimeoutMs` (5 seconds by default), so lower it if sign-up latency matters.

Two things differ from a social provider, both because kind `0` is a self-claimed, best-effort relay lookup rather than part of an OAuth handshake:

- A lookup that fails, times out or finds nothing falls back to the npub instead of failing sign-in.
- `email`, `emailVerified` and `id` are typed `never` in `NostrMappedUser`: identity is the signing pubkey, and the email stays `generateEmail`'s job.

The server queries only your `relays`. Unlike the browser, it never follows relay hints or resolves NIP-05, since that would let user input pick the hosts it connects to.

## How it works

### Sign-in

`signIn.nostr` makes two requests:

1. `POST /nostr/nonce` with the signer's public key. The server stores a random single-use nonce bound to that key, valid for `nonceTtlMs` (5 minutes by default).
2. `POST /nostr/login` with the nonce in the JSON body and a NIP-98 token in the `Authorization` header. The token is a kind `27235` event signed for that endpoint's absolute URL, the `post` method and a hash of the body.

The login endpoint then:

1. unpacks the event with `nostr-tools/nip98`,
2. checks the signature, kind, URL, method, body hash and the 60-second time window,
3. consumes the nonce atomically, and only if it was issued for the key that signed, so it cannot be replayed,
4. finds the `nostrPubkey` row for the key, or creates a user, the row and its `nostr` account row in one transaction,
5. creates a session, records the key's `lastUsedAt` and sets the cookie.

Because the nonce sits in both the signed payload and the body, tampering with either side fails validation. Two concurrent first sign-ins with the same key end up as one user: the second insert fails on the unique index, rolls back and signs in as the user the first one created.

### Linking a key

`nostr.addPubkey` runs the same flow against `/nostr/add-pubkey`: it fetches a nonce for the new key, signs a NIP-98 event with it, and sends it alongside the existing session cookie. The endpoint requires both a valid session and a fresh nonce, so an intercepted token cannot be replayed to attach someone else's key. Linking a key the user already owns is a no-op; linking one owned by another account returns `409`, also when two users link the same key at the same moment.

### Managing linked keys

Users can see, rename and remove the keys linked to their account. The endpoints are modelled on Better Auth's passkey plugin:

```ts
const { data: pubkeys } = await authClient.nostr.listPubkeys();
// [{ id, publicKey, npub, name, createdAt, lastUsedAt }]

await authClient.nostr.updatePubkey({ id, name: "Laptop" });
await authClient.nostr.removePubkey({ id });
```

`lastUsedAt` is set on every sign-in and is `null` until a key's first one. Renaming and removing check that the key belongs to the session user, and answer `404 NOSTR_PUBKEY_NOT_FOUND` for one that doesn't, whether it belongs to someone else or doesn't exist. Removing needs a fresh session (Better Auth's `session.freshAge`, a day by default), like `unlinkAccount`.

A user can't remove their last way to sign in. Removal is refused with `NOSTR_CANNOT_REMOVE_LAST_PUBKEY` when the key's own account row is the user's only one, unless `account.accountLinking.allowUnlinkingAll` is set. Another Nostr key, an email and password or a social account all count.

Every linked key is also an `account` row with `providerId: "nostr"` and the hex pubkey as `accountId`. The plugin writes it at sign-up and in `addPubkey`, and removes it with the key. As a result:

- `listUserAccounts` lists Nostr keys next to the user's other accounts,
- `unlinkAccount` on a Nostr account removes its key as well, and Better Auth's own last-account guard still applies,
- admin tooling sees a Nostr-only user as having a credential.

Keys linked by a version without this have no account row yet. The plugin creates the missing rows for a user when that user signs in or removes a key, so there is nothing to run. This backfill is temporary and [1.0 removes it](https://github.com/leon-wbr/better-auth-nostr/issues/69): upgrade through a 0.x release with it, or run the SQL in the 1.0 upgrade guide, before moving to 1.0. What to do when a user loses a key is in [Key loss and recovery](key-loss.md).

### Why baseURL matters

The signed event names the absolute URL of the endpoint, and the server checks it against `baseURL + basePath`. That binding is what stops a token signed for another site from working on yours. The client signs against its own `baseURL + basePath`, so both sides have to agree; pass `basePath` to `createAuthClient` when Better Auth is not mounted at `/api/auth`.

Set `baseURL` on the server too. When it is neither configured nor supplied through `BETTER_AUTH_URL`, Better Auth derives it from the incoming request, and then a `Host` header an attacker controls decides the URL the signature is checked against. Configuring `baseURL` is what makes the binding mean something behind a proxy. Without `baseURL` or `BETTER_AUTH_URL` the plugin warns at startup, and in production (`NODE_ENV=production`) it refuses to start unless you pass `allowDynamicBaseURL: true`. A dynamic `baseURL` with `allowedHosts` counts as configured.

### Rate limits

The three sign-in endpoints carry their own rate limits, like Better Auth's magic-link and phone-number plugins: `/nostr/nonce` 10 requests per 60 seconds, `/nostr/login` 3 per 10 seconds (Better Auth's sign-in limit) and `/nostr/add-pubkey` 5 per 60 seconds, per client IP. They apply wherever Better Auth's rate limiter is on, which by default is production only. Override them with `rateLimit: { nonce: { window: 60, max: 20 } }`, or turn one off with Better Auth's `rateLimit.customRules`.

## Other Better Auth plugins

Better Auth's two-factor plugin does not apply to Nostr sign-in. It only intercepts its own list of sign-in paths (email, username and phone number), the same as for passkey and SIWE sign-in.
