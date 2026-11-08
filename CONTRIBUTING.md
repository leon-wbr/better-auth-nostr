# Contributing to better-auth-nostr

Thanks for looking. Every kind of help counts here, and most of it needs no code at all. If you are unsure whether something is worth raising, raise it: a short issue is always welcome.

## Ways to help

- **Tell us you use it.** An issue or a note saying "we run this in production with X" helps more than you might think: it shows which setups matter and gives others confidence.
- **Report a bug.** Open an [issue](https://github.com/leon-wbr/better-auth-nostr/issues) with what you did, what you expected and what happened. The versions of `better-auth-nostr`, `better-auth` and `nostr-tools`, your runtime (Node, Bun, Deno, a browser, Workers) and your database adapter make it much easier to reproduce.
- **Try it with your signer.** Logins go through browser extensions (NIP-07) and remote signers (NIP-46) such as Amber, nsec.app and nsecbunker, and each one behaves a little differently. Telling us which signers work, which don't and how they fail is some of the most useful testing there is.
- **Improve the docs.** A confusing sentence in the README, a missing example or a setup step that tripped you up are all worth a pull request or an issue. Small fixes are as welcome as big ones.
- **Share an example.** A minimal app using the plugin with your framework or adapter helps the next person. `examples/react` shows the shape.
- **Suggest a feature.** Open an issue describing the problem you want solved before the solution you have in mind; there may be a simpler way, or a NIP that already covers it.
- **Answer questions.** If you know the answer to someone's issue, jump in.
- **Review pull requests.** A second pair of eyes on a change, especially anything touching signing, nonces or sessions, is valuable even if you only leave a comment.
- **Write code.** Bug fixes, tests and features are all welcome. For anything larger than a small fix, open an issue first so we can agree on the approach before you spend the time.

## Reporting a security issue

Please don't open a public issue for a vulnerability. Use GitHub's [private vulnerability reporting](https://github.com/leon-wbr/better-auth-nostr/security/advisories/new) instead, and include how to reproduce it. You will get an answer, and credit in the advisory if you want it.

## Working on the code

You need Node 20 or newer and npm 11 (the version in `package.json`'s `packageManager`).

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

## Pull requests

- Keep a pull request to one change. Several small ones are easier to review than one large one.
- Add or update a test for a behaviour change or a bug fix. A failing test that shows the bug is a good first commit.
- Update the README when you change the public API or an option.
- Commit messages and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org/): `fix:`, `feat:`, `docs:`, `test:`, `chore:` and so on. Pull requests are squash-merged, so the title becomes the commit on `main`.
- Draft pull requests are fine for early feedback; CI skips them until they are ready for review.

If you get stuck on any of this, open the pull request anyway and say where you are stuck. We would rather help you finish than have you give up.

## Code of conduct

Be kind and assume good faith. Harassment or personal attacks in issues, pull requests or anywhere else in the project are not accepted, and the maintainers may remove such content or block the people behind it.

## Licence

By contributing, you agree that your contribution is licensed under the project's [MIT licence](LICENSE).
