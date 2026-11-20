# Contributing to better-auth-nostr

Thanks for looking. Every kind of help counts here, and most of it needs no code at all. If you are unsure whether something is worth raising, raise it: a short issue is always welcome.

## Ways to help

- **Tell us you use it.** An issue or a note saying "we run this in production with X" helps more than you might think: it shows which setups matter and gives others confidence.
- **Report a bug.** Open an [issue](https://github.com/leon-wbr/better-auth-nostr/issues) with what you did, what you expected and what happened. The versions of `better-auth-nostr`, `better-auth` and `nostr-tools`, your runtime (Node, Bun, Deno, a browser, Workers) and your database adapter make it much easier to reproduce.
- **Try it with your signer.** Logins go through browser extensions (NIP-07) and remote signers (NIP-46) such as Amber, nsec.app and nsecbunker, and each one behaves a little differently. Telling us which signers work, which don't and how they fail is some of the most useful testing there is.
- **Improve the docs.** A confusing sentence in the README or the [docs](https://leon-wbr.github.io/better-auth-nostr/) (sources in `docs/`), a missing example or a setup step that tripped you up are all worth a pull request or an issue. Small fixes are as welcome as big ones.
- **Share an example.** A minimal app using the plugin with your framework or adapter helps the next person. `examples/react` shows the shape.
- **Suggest a feature.** Open an issue describing the problem you want solved before the solution you have in mind; there may be a simpler way, or a NIP that already covers it.
- **Answer questions.** If you know the answer to someone's issue, jump in.
- **Review pull requests.** A second pair of eyes on a change, especially anything touching signing, nonces or sessions, is valuable even if you only leave a comment.
- **Write code.** Bug fixes, tests and features are all welcome. For anything larger than a small fix, open an issue first so we can agree on the approach before you spend the time.

## Reporting a security issue

Please don't open a public issue for a vulnerability. Use GitHub's [private vulnerability reporting](https://github.com/leon-wbr/better-auth-nostr/security/advisories/new) instead, and include how to reproduce it. You will get an answer, and credit in the advisory if you want it.

## Working on the code

You need Node 22 or newer and npm 11 (the version in `package.json`'s `packageManager`).

```bash
git clone https://github.com/leon-wbr/better-auth-nostr.git
cd better-auth-nostr
npm install
npm test            # vitest
npm run typecheck
npm run lint        # biome; npm run lint:fix applies the safe fixes
npm run build       # tsdown into dist/
```

`src/index.ts` is the server plugin, `src/routes.ts` its endpoints, `src/client.ts` the client plugin, `src/signer.ts` the NIP-07, NIP-46 and private-key signers and `src/profile.ts` the kind `0` profile lookup. `tests/` boots Better Auth against the in-memory adapter, so the integration tests run without a database.

Before opening a pull request, run the same gate the maintainers use:

```bash
npm run ci:local    # lint + typecheck + tests with coverage thresholds + build
```

GitHub Actions runs the same `npm run ci:local` on every pull request that isn't a draft. `npm run check` is the same without the build. The coverage thresholds live in `vitest.config.ts`, so a change that drops coverage below them fails the gate.

`tests/adapters.test.ts` runs the database-dependent guarantees (single-use nonces, unique pubkeys) against the memory adapter, SQLite (`node:sqlite`) and, when `POSTGRES_URL` is set, Postgres. To include Postgres locally:

```bash
docker run --rm -d --name ban-pg -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:17
POSTGRES_URL=postgres://postgres:postgres@localhost:5432/postgres npm test
```

The `Matrix` workflow runs tests, coverage and build on Node 22 and 24 with Better Auth 1.7.0 and the latest release, the adapter suite against a Postgres service, and `smoke/sign-in.ts`, a full sign-in against the built package, on Bun, Deno and Cloudflare Workers (`nodejs_compat`). After `npm run build`, run the smoke test with `bun smoke/cli.ts`, `deno run --allow-env --allow-read smoke/cli.ts` or `npx wrangler dev --config smoke/wrangler.json`. Signers can't be driven from CI: [docs/signer-checklist.md](docs/signer-checklist.md) is run by hand for each release candidate.

`npm run mutate` runs Stryker over `src/routes.ts` and `src/signer.ts`, where a flipped comparison is a security bug that line coverage can't see. It takes a few minutes, so it runs on demand, not in CI; the HTML report lands in `reports/stryker/`. When you change the NIP-98 checks or the signers, run it and don't let the score drop. `stryker.config.ts` is typed with `PartialStrykerOptions` and loaded through Node’s native type stripping (Node 22.18+). The script passes its filename explicitly because Stryker 10 does not auto-discover TypeScript configs. It points `tsconfigFile` at a file that doesn't exist on purpose: Stryker's tsconfig preprocessor calls a TypeScript API that TypeScript 7 no longer has.

## Pull requests

- Keep a pull request to one change. Several small ones are easier to review than one large one.
- Add or update a test for a behaviour change or a bug fix. A failing test that shows the bug is a good first commit.
- Document an export or option in its JSDoc (defaults as `@defaultValue`), then run `npm run docs:generate` and commit the result. It writes `docs/api/` with TypeDoc, and with `scripts/docs/generate.ts` the error-code tables in `docs/reference.md`, the schema and options tables in `docs/index.mdx` and the support matrix in `docs/support.md`; CI fails when they are out of date. A new error code needs its status, cause and fix in `scripts/docs/error-codes.ts`, or typecheck fails. Endpoints and client actions are written by hand in `docs/reference.md`, and `tests/docs.test.ts` fails when one is missing. The site is [Starlight](https://starlight.astro.build/), configured in `scripts/docs/astro.config.ts`: `npm run docs:dev` previews it, `npm run docs:build` builds it to `scripts/docs/dist/`, and the `Pages` workflow deploys it from `main`.
- Commit messages and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org/): `fix:`, `feat:`, `docs:`, `test:`, `chore:` and so on. Pull requests are squash-merged, so the title becomes the commit on `main`.
- Draft pull requests are fine for early feedback; CI skips them until they are ready for review.

If you get stuck on any of this, open the pull request anyway and say where you are stuck. We would rather help you finish than have you give up.

## Code of conduct

Be kind and assume good faith. Harassment or personal attacks in issues, pull requests or anywhere else in the project are not accepted, and the maintainers may remove such content or block the people behind it.

## Licence

By contributing, you agree that your contribution is licensed under the project's [MIT licence](LICENSE).
