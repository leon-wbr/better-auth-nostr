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

`signIn.nostr` will create and sign the NIP-98 event using:

- a passed-in `nsec` string (bech32 or 64-char hex), or
- a browser extension that exposes `window.nostr.signEvent` (NIP-07).

The action sends the resulting token in the `Authorization` header to `/nostr/login`. The endpoint then:

1. unpacks the event via `nostr-tools/nip98`,
2. verifies the signature against the canonical login URL,
3. atomically consumes the issued nonce so it cannot be replayed,
4. finds or creates a `nostrPubkey` row tied to a Better Auth user,
5. issues a session and sets the cookie.

Each login request carries a nonce in both the signed NIP-98 payload and the JSON body, so tampering with either side fails validation. The nonce is single-use — consumed atomically on the server.

`nostr.addPubkey` follows the same flow against `/nostr/add-pubkey`: it fetches a nonce for the new key, signs a NIP-98 event with it, and sends it alongside the existing session cookie. The endpoint requires both a valid session and a fresh single-use nonce, so an intercepted token cannot be replayed to attach someone else's key. Linking a pubkey that the signed-in user already owns is a no-op; linking one owned by another account returns `409`.

Because the signed event is bound to the endpoint URL, the client has to sign against `baseURL + basePath` — the same URL the server validates against. If you mount Better Auth somewhere other than the default `/api/auth`, pass `basePath` to `createAuthClient` so the two agree.

## Requirements

Better Auth `>= 1.7.0`. The nonce flow relies on `internalAdapter.consumeVerificationValue`, which was introduced in 1.7.0.

## Configuration Options

| Option                  | Description                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `disableSignUp`         | Reserved for future request-gated signup flows. Currently a no-op.                              |
| `disableImplicitSignUp` | Reject logins from unseen pubkeys instead of auto-creating a Better Auth user.                  |
| `modelName`             | Override the `nostrPubkey` model name registered in the schema.                                 |
| `fields`                | Customize field names for `name`, `publicKey`, `userId`, and `createdAt`.                       |
| `nonceTtlMs`            | Nonce time-to-live in milliseconds. Defaults to 5 minutes.                                      |
| `getNonce`              | Custom nonce generator. Must return `Promise<string>`.                                          |
| `generateEmail`         | Customize the email used when implicitly creating a user. Receives the npub and the hex pubkey. |

The plugin exports its schema so the underlying adapter sets up indexes and the foreign key to `user` automatically.

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
