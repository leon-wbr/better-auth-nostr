<h2 align="center">🪪 Better Auth Nostr</h2>

<p align="center">
  <strong>A Better Auth plugin for Nostr-based login and pubkey management.</strong>
</p>

<p align="center">
  A thin, standards-aware bridge that lets <a href="https://www.better-auth.com/">Better Auth</a> authenticate with Nostr (<a href="https://github.com/nostr-protocol/nips/blob/master/98.md">NIP-98</a>) and keeps pubkeys synced with your users.
</p>

<p align="center">
<a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
<a href="https://www.npmjs.com/package/better-auth-nostr"><img src="https://img.shields.io/npm/v/better-auth-nostr.svg" alt="npm version"></a>
</p>

## 🧭 Overview

This plugin exposes both a server-side `nostr` plugin and a client helper so Better Auth installations can:

- validate incoming NIP-98 tokens and create a session cookie without touching passwords or private keys,
- persist each Nostr public key in a configurable `nostrPubkey` model so users retain a linked identity,
- link additional pubkeys to an existing account through an authenticated endpoint.

It is designed to be as simple as possible, dropping decentralized login flows into traditional apps with minimal wiring.

## Example

```ts
import { betterAuth } from "better-auth";
import { nostr } from "better-auth-nostr";

export const auth = betterAuth({
  plugins: [nostr()],
});
```

On the client:

```ts
import { createAuthClient } from "better-auth/client";
import { nostrClient } from "better-auth-nostr/client";

export const authClient = createAuthClient({
  plugins: [nostrClient()],
});

await authClient.signIn.nostr({ nsec });

await authClient.nostr.addPubkey({ nsec, name: "Backup key" });
```

`signIn.nostr` will create and sign the NIP-98 event using, in order of precedence:

- a `signer` you pass in — anything with `getPublicKey()` and `signEvent()`, including a NIP-46 remote signer (see below),
- a passed-in `nsec` string (bech32 or 64-char hex), or
- a browser extension that exposes `window.nostr.signEvent` (NIP-07).

### Remote signers (NIP-46)

Most people keep their key in a remote signer — Amber, nsec.app, nsecbunker — rather than pasting an nsec into a web app. Both halves of NIP-46 are supported, and both produce a signer you hand to `signIn.nostr` or `nostr.addPubkey`.

The user pastes a `bunker://` URI (or a NIP-05 identifier whose provider advertises NIP-46):

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

A remote signer is a live relay subscription, so its lifetime is yours to manage: call `close()` when you are done — that closes the subscription, and the relay pool too unless you supplied your own via `pool`.

To resume a session later without a second approval prompt, persist both `signer.clientSecretKey` and `signer.bunkerUri`, then hand them back to `createBunkerSigner(bunkerUri, { clientSecretKey })`. This works for either flow: a `nostrconnect://` session learns its signer's pubkey and relays during the handshake, and `bunkerUri` is how you keep them.

Every remote call is bounded by `timeoutMs` (5 minutes by default, and settable per request through `signIn.nostr({ signer, timeoutMs })`). Without one a signer that never answers would leave the promise pending forever, since NIP-46 requests have no deadline of their own.

Both flows request only `sign_event:27235` by default — enough to authenticate, and nothing else. Widen it with `perms` if your app also signs notes. Note that some signers ignore requested permissions and prompt per signature regardless; where that happens, each signature waits on a human, which is what the staleness error below is about.

One caveat is worth knowing about: NIP-98 stamps `created_at` before the event is signed, and the server rejects anything more than 60 seconds old. A remote signer that waits on a human tapping "approve" on a phone can blow through that. The client detects it a few seconds before the server's limit — leaving room for network transit — and fails with an explicit "the signer took too long" message instead of an opaque `401`.

The action sends the resulting token in the `Authorization` header to `/nostr/login`. The endpoint then:

1. unpacks the event via `nostr-tools/nip98`,
2. verifies the signature against the canonical login URL,
3. atomically consumes the issued nonce so it cannot be replayed,
4. finds or creates a `nostrPubkey` row tied to a Better Auth user,
5. issues a session and sets the cookie.

Each login request carries a nonce in both the signed NIP-98 payload and the JSON body, so tampering with either side fails validation. The nonce is single-use — consumed atomically on the server.

`nostr.addPubkey` follows the same flow against `/nostr/add-pubkey`: it fetches a nonce for the new key, signs a NIP-98 event with it, and sends it alongside the existing session cookie. The endpoint requires both a valid session and a fresh single-use nonce, so an intercepted token cannot be replayed to attach someone else's key. Linking a pubkey that the signed-in user already owns is a no-op; linking one owned by another account returns `409`.

Because the signed event is bound to the endpoint URL, the client has to sign against `baseURL + basePath` — the same URL the server validates against. If you mount Better Auth somewhere other than the default `/api/auth`, pass `basePath` to `createAuthClient` so the two agree.

Set `baseURL` on the server as well. The event is validated against `ctx.context.baseURL`, and when that is neither configured nor supplied through `BETTER_AUTH_URL`, Better Auth derives it from the incoming request — which means a `Host` header an attacker controls decides the URL the signature is checked against. Configuring `baseURL` is what makes that binding meaningful behind a proxy.

### Signing other events

The same signer resolution powers a post-login helper, so an app can publish a note or update a profile without wiring up a second signing path:

```ts
const { data: event, error } = await authClient.nostr.signEvent(
  { kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: "gm" },
  { signer },
);
```

It takes the same `signer` / `nsec` / NIP-07 precedence and `timeoutMs` as `signIn.nostr`, makes no server request, and returns `{ data, error }` like the other actions instead of throwing. The returned event is checked before you see it: its signature must verify and its pubkey must match the one the signer reported. A remote signer only signs kinds it was granted, so widen `perms` (for example `sign_event:1`) when you create it.

### Profile metadata

Configure relays on the client and `nostr.getProfile` resolves an `npub`, `nprofile`, hex pubkey or NIP-05 identifier and returns the user's kind `0` metadata, for showing a name and avatar or prefilling a signup form:

```ts
export const authClient = createAuthClient({
  plugins: [nostrClient({ relays: ["wss://relay.example.com"] })],
});

const { data: profile, error } = await authClient.nostr.getProfile("alice@example.com");
profile?.metadata.display_name;
```

It runs in the browser and makes no server request. Relay hints from an `nprofile` or the NIP-05 record are queried alongside your `relays`, and the newest kind `0` event wins; the pool verifies its signature. `data` is `null` when the identity does not resolve or no relay has a profile, and `error` is set for input it cannot interpret. `relayTimeoutMs` bounds the wait, and `getProfile(input, { timeoutMs })` overrides it per call. `input` is required: the session does not carry the user's pubkey, so pass the one you signed in with.

`metadata` keeps the NIP-01 and NIP-24 string fields (`name`, `display_name`, `about`, `picture`, `banner`, `website`, `nip05`, `lud16`) and passes unknown keys through; a known field with the wrong type is dropped. Metadata is user-supplied and unverified: treat `picture` and `website` as untrusted URLs, and note that `nip05` is only a claim until checked against the pubkey.

### Relays

This plugin ships with no default relays, on purpose. Which relays your app talks to is a product decision (privacy, reliability, censorship resistance, who sees your users' pubkeys and IPs), and a library that picks for you makes that decision silently. Every feature that reads from relays therefore needs `relays` configured; leaving it out is a type error.

| Option           | Description                                                     |
| ---------------- | --------------------------------------------------------------- |
| `relays`                   | Relays the server reads from. No default. When set, a new user is filled from their kind `0` profile at sign-up; when unset, no lookup happens. See [Relays](#relays). |
| `relayTimeoutMs` | How long to wait on relays, in milliseconds. Defaults to 5000.  |

Both are top-level options of `nostr()` and `nostrClient()`, since they describe how to reach relays rather than what a feature does with the data. The client follows relay hints from `nprofile`s and NIP-05 records, because there they only make the user's own browser connect somewhere.

## Requirements

Better Auth `>= 1.7.0`. The nonce flow relies on `internalAdapter.consumeVerificationValue`, which was introduced in 1.7.0.

`nostr-tools >= 2.20.0`. The `nostrconnect://` flow cancels through `BunkerSigner.fromURI`'s `AbortSignal` parameter, which first ships in 2.20.0; on older versions a deadline is silently ignored.

## Configuration Options

| Option                     | Description                                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `disableSignUp`            | Reserved for future request-gated signup flows. Currently a no-op.                                                                |
| `disableImplicitSignUp`    | Reject logins from unseen pubkeys instead of auto-creating a Better Auth user.                                                    |
| `modelName`                | Override the `nostrPubkey` model name registered in the schema.                                                                   |
| `fields`                   | Customize field names for `name`, `publicKey`, `userId`, and `createdAt`.                                                         |
| `nonceTtlMs`               | Nonce time-to-live in milliseconds. Defaults to 5 minutes.                                                                        |
| `getNonce`                 | Custom nonce generator. Must return `Promise<string>`.                                                                            |
| `generateEmail`            | Customize the email used when implicitly creating a user. Receives the npub and the hex pubkey.                                   |
| `relays`                   | Relays the server reads from. No default. When set, a new user is filled from their kind `0` profile at sign-up; when unset, no lookup happens. See [Relays](#relays). |
| `relayTimeoutMs`           | How long to wait on relays, in milliseconds. Defaults to 5000.                                                                    |
| `mapProfileToUser`         | Map the profile to user fields, sync or async. The result is spread over the default mapping; extra keys go to additional fields. |
| `overrideUserInfoOnSignIn` | Also refresh an existing user from their profile on every sign-in, not only at sign-up. Needs `relays`. Defaults to `false`.        |

#### Filling the user from the Nostr profile

The profile options mirror `mapProfileToUser` and `overrideUserInfoOnSignIn` on Better Auth's social providers, so they behave the way you already know:

```ts
nostr({
  relays: ["wss://relay.example.com"],
  mapProfileToUser: ({ metadata }) => ({
    name: metadata.display_name?.slice(0, 80),
    lud16: metadata.lud16,
  }),
});
```

The default mapping, the counterpart of GitHub's `name || login` and `avatar_url`, takes `display_name` or else `name` (trimmed) and an `https:` `picture`. Whatever `mapProfileToUser` returns is spread over that, so you only return what you want to change. Extra keys are filtered through `user.additionalFields` the same way a social provider's are; keys that are not declared fields are dropped. Setting `relays` is the opt-in: without it the server never contacts a relay and the name stays the npub. A new user gets the mapped fields at sign-up; an existing user is only updated when `overrideUserInfoOnSignIn` is on, which costs a relay round-trip on every sign-in. Sign-up waits on the relay lookup for up to `relayTimeoutMs` (5 seconds by default), so lower it if sign-up latency matters.

Two things differ from a social provider, both because kind `0` is a self-claimed, best-effort relay lookup rather than part of an OAuth handshake. The lookup is best effort, and one that fails, times out or finds nothing falls back to the npub instead of failing sign-in. And `email`, `emailVerified` and `id` are typed `never` in `NostrMappedUser`: identity is the signing pubkey, and the email stays `generateEmail`'s job. The server queries only your `relays`; it never follows relay hints or resolves NIP-05, since that would let user input pick the hosts it connects to.

The plugin exports its schema so the underlying adapter sets up indexes and the foreign key to `user` automatically.

### Client exports

`better-auth-nostr/client` also exports the signer primitives directly, so you can build the flow yourself: `createPrivateKeySigner`, `createExtensionSigner`, `createBunkerSigner`, `createNostrConnectSession`, `parseSecretKey`, the `NostrSigner` / `RemoteNostrSigner` types, and the `NostrProfile`, `NostrProfileMetadata` and `RelayOptions` types. `NostrSigner` is structurally compatible with `Signer` from `nostr-tools/signer` — a compile-time assertion in the source keeps it that way — so an existing signer implementation, including a bare `PlainKeySigner`, can be passed straight through.

## Development

```bash
npm install
npm run build       # compile sources into dist via tsdown
npm run dev         # tsdown --watch for local testing
npm run typecheck
npm test
npm run test:watch
npm run coverage
```

See `src/routes.ts` and `src/client.ts` for the endpoint and action wiring, and `tests/` for end-to-end examples that boot Better Auth against the in-memory adapter. `examples/react` holds a Vite + Better Auth sandbox with its own auth server and migrations.

### Releasing

Releases are cut from a tag and published by `.github/workflows/release.yml`. There is nothing to run by hand:

```bash
npm version minor        # bumps package.json, commits, tags v0.3.0
git push --follow-tags
```

The workflow refuses to publish if the tag and `package.json` version disagree, then typechecks, tests, builds, publishes to npm, and opens a GitHub release with generated notes. It authenticates through npm trusted publishing (OIDC), so there is no token in the repository and every tarball carries a provenance attestation.

Running the same workflow manually (Actions → Release → Run workflow) does everything except publish: it performs the real OIDC token exchange through `npm publish --dry-run` and fails if npm does not hand back a token. Use it to confirm the trusted publisher entry still works before cutting a tag.

## Why It Matters

Most Nostr logins today live in bespoke, one-off integrations. Packaging it as a Better Auth plugin lets teams:

- add decentralized authentication next to their existing auth flows with a single import,
- run Nostr-first apps on Better Auth without rebuilding session, cookie, and schema plumbing.

## Project Status

- Stage: early but stable for login and basic pubkey management.
- Contributions that extend the feature set (e.g. pubkey revocation, multi-key UX, profile sync from relays) or polish the docs are welcome.

## Get Involved

- Try the plugin in your Better Auth app and report bugs at [github.com/leon-wbr/better-auth-nostr/issues](https://github.com/leon-wbr/better-auth-nostr/issues).
- Open a pull request to add client actions, extend the schema, or improve docs.
- Share ideas for future Nostr flows on the issue tracker.

## License

MIT — see [LICENSE](LICENSE).
