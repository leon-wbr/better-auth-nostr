<h2 align="center">🪪 Better Auth Nostr</h2>

<p align="center">
  <strong>A Better Auth plugin for Nostr-based login and pubkey management.</strong>
</p>

<p align="center">
  A thin, standards-aware bridge that lets <a href="https://better-auth.com/">Better Auth</a> authenticate with Nostr (<a href="https://github.com/nostr-protocol/nips/blob/master/98.md">NIP-98</a>) and keeps pubkeys synced with your users.
</p>

<p align="center">
<a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
<a href="https://www.npmjs.com/package/better-auth-nostr"><img src="https://img.shields.io/npm/v/better-auth-nostr.svg" alt="npm version"></a>
</p>

## Why

Most Nostr logins live in bespoke, one-off integrations. As a Better Auth plugin, Nostr sign-in sits next to your existing auth flows with a single import, and Nostr-first apps get Better Auth's sessions, cookies and schema without rebuilding them. The server verifies a [NIP-98](https://github.com/nostr-protocol/nips/blob/master/98.md) signed event and never sees a password or private key; each user can link several keys.

## Install

```bash
npm install better-auth better-auth-nostr
```

Supports Better Auth `^1.7`, tested at 1.7.0 and the latest release on Node 22 and 24, Bun, Deno and Cloudflare Workers, against SQLite and Postgres. The [support matrix](https://leon-wbr.github.io/better-auth-nostr/support/) has the details.

## Quick start

```ts
import { betterAuth } from "better-auth";
import { nostr } from "better-auth-nostr";

export const auth = betterAuth({
  baseURL: "https://app.example.com",
  plugins: [nostr()],
});
```

Run `npx auth@latest migrate` to add the `nostrPubkey` table, then on the client:

```ts
import { createAuthClient } from "better-auth/client";
import { nostrClient } from "better-auth-nostr/client";

export const authClient = createAuthClient({ plugins: [nostrClient()] });

// Signs with the NIP-07 extension; pass { nsec } or { signer } for others.
const { data, error } = await authClient.signIn.nostr();
```

## Docs

- [Getting started](https://leon-wbr.github.io/better-auth-nostr/): from install to a first sign-in and a second linked key, with the schema and every option.
- [Guide](https://leon-wbr.github.io/better-auth-nostr/guide/): signers (NIP-07, nsec, NIP-46 remote signers), signing other events, profiles and relays, managing linked keys, and how sign-in works.
- [Interop](https://leon-wbr.github.io/better-auth-nostr/interop/): other Better Auth plugins (admin, multiSession, organization, customSession, anonymous) and signers from NDK, applesauce, window.nostr.js and Amber.
- [Reference](https://leon-wbr.github.io/better-auth-nostr/reference/): endpoints, client actions, and error codes.
- [API](https://leon-wbr.github.io/better-auth-nostr/api/): every export and option, generated from the JSDoc.
- [Key loss and recovery](https://leon-wbr.github.io/better-auth-nostr/key-loss/): backup keys, recovery paths and key rotation, since Nostr has no protocol-level recovery yet.
- [Support and versioning](https://leon-wbr.github.io/better-auth-nostr/support/): the support matrix and what a version number promises.

The site follows `main`; the sources are in [docs/](docs/index.mdx).

## Development

```bash
npm install
npm run build       # compile sources into dist via tsdown
npm run dev         # tsdown --watch for local testing
npm run typecheck
npm test
npm run test:watch
npm run coverage    # tests with the coverage thresholds from vitest.config.ts
npm run check       # lint + typecheck + coverage
npm run ci:local    # check + build: what CI runs
```

GitHub Actions runs `npm run ci:local` on pull requests and on pushes to main, along with the PR-title check and a gitleaks secret scan.

See `src/routes.ts` and `src/client.ts` for the endpoint and action wiring, and `tests/` for end-to-end examples that boot Better Auth against the in-memory adapter. Runnable apps are in [examples/](examples/): [React Router](examples/react/) is a sandbox with SQLite and every signer, and [Next.js](examples/nextjs/) and [Hono on Cloudflare Workers](examples/hono-workers/) are minimal starting points that CI signs in to on every PR.

### Releasing

Nobody bumps versions or tags releases by hand. PRs are squash-merged, so each PR title, a [Conventional Commit](https://www.conventionalcommits.org/), becomes the commit. [release-please](https://github.com/googleapis/release-please) reads those commits on `main` and keeps one release PR open, `chore(release): X.Y.Z`, with the version bump and the `CHANGELOG.md` entry. While the version is 0.x, a `feat!:` (breaking) PR bumps the minor version, not the major. A breaking PR also needs the `breaking` label, and the PR-title check fails if the title and the label disagree.

Merging the release PR is the release. `.github/workflows/release.yml` tags `vX.Y.Z` on main and creates the GitHub release. The publish job then waits for approval in the `npm` environment. Once approved, it typechecks, tests and builds, then publishes to npm through trusted publishing (OIDC). There is no token in the repository, and every tarball carries a provenance attestation.

Running the release workflow manually (Actions → Release → Run workflow) publishes nothing. It performs the real OIDC token exchange through `npm publish --dry-run` and fails if npm doesn't hand back a token, which confirms that the trusted publisher entry still works.

## Get Involved

- Try the plugin in your Better Auth app and report bugs at [github.com/leon-wbr/better-auth-nostr/issues](https://github.com/leon-wbr/better-auth-nostr/issues).
- Open a pull request to add client actions, extend the schema, or improve docs.
- Share ideas for future Nostr flows on the issue tracker.
- Read [CONTRIBUTING.md](CONTRIBUTING.md) for every way to help, from testing your signer to reviewing pull requests, and how to run the checks locally.

## License

MIT — see [LICENSE](LICENSE).
