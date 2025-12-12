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
- and re-use the same schema as a basis for additional pubkey management endpoints later.

It is designed to be as simple as possible, incorporating decentralized login flows into traditional apps.

## Example

```ts
import { defineAuthConfig } from "better-auth";
import { nostr } from "better-auth-nostr";

export default defineAuthConfig({
  plugins: [
    nostr(),
  ],
});
```

On the client, `authClient.signIn.nostr({ nsec?: string })` will automatically create and sign the event using:

- a passed in nsec string, or if the argument hasn't been provided,
- checks if a browser extension provides `window.nostr.signEvent`.

The action sends the resulting token in the `Authorization` header to `/nostr/login`, and the endpoint

1. unpacks the event via `nostr-tools/nip98`,
2. verifies the signature/relay URL pair,
3. finds or creates a `nostrPubkey` record tied to a Better Auth user or creates a new user,
4. issues a session and sets the cookie.

This flow keeps the Nostr login path centralized and fully compatible with the rest of Better Auth.

## Configuration Options

| Option                  | Description                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `disableSignUp`         | Placeholder for future request-based signup gating.                                 |
| `disableImplicitSignUp` | Do not auto-create a Better Auth user for a new pubkey (requires pre-registration). |
| `modelName`             | Override the `nostrPubkey` model name registered in the schema.                     |
| `fields`                | Customize the field names used for `name`, `publicKey`, `userId`, and `createdAt`.  |

The plugin exports its schema so the underlying adapter creates indexes and references to `user`.

## Development

```bash
npm install
npm run build   # compile sources into dist via tsdown
npm run dev     # tsdown --watch for local testing
npm run typecheck
npm run test
npm run coverage
```
Developers can inspect `examples/react` for a Vite + Better Auth sandbox (it includes its own auth server + migrations) or refer to `src/client.ts`/`src/routes.ts` to understand the actions and endpoint wiring.

## Why It Matters

Most Nostr logins today live in bespoke, ad-hoc integrations. Breaking that effort into a reusable Better Auth plugin lets web teams:

- simply implement decentralized authentication into traditional auth flows with Better Auth,
- easily use Better Auth for Nostr apps and save valuable development time.

## Project Status

- Stage: early feature work with focus on login + schema.
- Contributions that expand (e.g., pubkey revocation, multi-key management) or polish docs are welcome.

## Get Involved

- Test the plugin inside your Better Auth app and report bugs at [github.com/leon-wbr/better-auth-nostr/issues](https://github.com/leon-wbr/better-auth-nostr/issues).
- Open a pull request to add new client actions, extend the schema, or improve docs.
- Share ideas for future Nostr flows (e.g., relays discovery, profile sync) using the issue tracker.

## License

MIT
