# better-auth-nostr

## Versioning

- SemVer, currently 0.x: a breaking change bumps the minor (release-please's `bump-minor-pre-major`), never the major. A breaking PR has a `!` in its title (`feat!: …`) and the `breaking` label; the PR-title check fails if only one of the two is there.
- PRs are squash-merged and the PR title is the commit, so titles follow Conventional Commits (checked by `.github/workflows/pr-title.yml`). `feat` bumps the minor, `fix`/`perf` the patch; `docs`, `chore`, `ci`, `test`, `refactor` don't release on their own.
- Nobody bumps versions or pushes tags by hand. release-please (`.github/workflows/release.yml`, config in `release-please-config.json`, current version in `.release-please-manifest.json`) keeps one `chore(release): X.Y.Z` PR open with the version bump in `package.json` and the `CHANGELOG.md` entry. Merging that PR is the release: the workflow tags `vX.Y.Z` on main, creates the GitHub release from the changelog, and the publish job waits for approval in the `npm` environment, re-runs typecheck, tests and build, then publishes with npm trusted publishing (OIDC, provenance, no token).
- The release PR is opened with `GITHUB_TOKEN`, so no checks run on it; it is merged with the admin bypass of the `main` ruleset.
- `workflow_dispatch` on release.yml publishes nothing: it dry-runs the trusted-publisher check.
- `v*` tags are immutable: never move, delete or reuse one, and never publish a version npm already has.
- The workflow files and `release-please-config.json` are synced from Leon's platform repo; change them there, so the libraries stay alike.
