# better-auth-nostr

## Versioning

- SemVer, currently 0.x: a breaking change to the public API bumps the minor and the PR gets the `breaking` label.
- A release is a `chore: release X.Y.Z` commit that bumps `package.json` and `package-lock.json`, then a `vX.Y.Z` tag on it. Releases happen only via `v*` tags; `.github/workflows/release.yml` checks the tag matches `package.json`, runs typecheck, tests and build, then publishes to npm.
- Publishing uses npm trusted publishing (OIDC) from GitHub Actions, so there is no local `npm publish` and no token. `workflow_dispatch` runs only a dry-run check of the trusted-publisher setup.
- GitHub release notes are generated (`--generate-notes`) from the squash-merged PR titles, which follow Conventional Commits. There is no CHANGELOG file.
- Never tag a version npm already has, and never move or reuse a pushed tag.
