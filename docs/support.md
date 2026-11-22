---
title: Support and versioning
description: What this library runs on, how that is checked, and what a version number promises.
---

## Support matrix

"Checked by" names what checks a row today; "proven by" means a CI job in the `Matrix` workflow does, on every pull request. "Planned" names what will check the rest, tracked in [#31](https://github.com/leon-wbr/better-auth-nostr/issues/31). The table is generated: versions come from `package.json`, the lockfile and the `Matrix` workflow, and the rest from `scripts/docs/generate.ts`, so a pull request that changes what CI runs changes this table with it.

<!-- generated:support-matrix -->

| Area | Supported | Checked by | Planned |
| --- | --- | --- | --- |
| Better Auth | `^1.7.0` (peer dependency). 1.7.0 is the floor: the nonce flow needs `consumeVerificationValue`. | Proven by the [`test`](https://github.com/leon-wbr/better-auth-nostr/blob/main/.github/workflows/matrix.yml) job at 1.7.0 and latest, and by `check` at 1.7.12 from the lockfile. |  |
| Node | 22 and 24 (`engines`: `>=22`). Node 20 is end-of-life and has no global `WebSocket`, which relay lookups and remote signers need. | Proven by the [`test`](https://github.com/leon-wbr/better-auth-nostr/blob/main/.github/workflows/matrix.yml) job on Node 22 and 24. |  |
| Bun, Deno 2, Cloudflare Workers (`nodejs_compat`) | Server and client. | Proven by the [`smoke`](https://github.com/leon-wbr/better-auth-nostr/blob/main/.github/workflows/matrix.yml) jobs (bun, deno and workers), each a full sign-in against the built package. |  |
| Databases | Better Auth's memory adapter, SQLite through Kysely, and Postgres. Other adapters are expected to work. | Proven by the adapter suite in the [`test`](https://github.com/leon-wbr/better-auth-nostr/blob/main/.github/workflows/matrix.yml) job: the memory adapter, `node:sqlite` and a Postgres 17 service, including one nonce used twice at once and two users linking one key at once. |  |
| Browsers | Evergreen Chrome, Firefox and Safari. | Nothing automated. | The [manual signer checklist](signer-checklist.md), run on each release candidate from 1.0.0-rc.1, [#31](https://github.com/leon-wbr/better-auth-nostr/issues/31) |
| nostr-tools | `^2.20.0` (dependency). 2.20 is the first with the `AbortSignal` the `nostrconnect://` flow needs. | The test suite, at 2.26.1 from the lockfile. |  |
| NIPs | 01 and 24 (kind `0` profiles), 05, 07, 19, 46 (`bunker://` and `nostrconnect://`), 98. NIP-65 and NIP-55 are not supported yet ([#41](https://github.com/leon-wbr/better-auth-nostr/issues/41)). | Unit and integration tests. |  |
| Signers | NIP-07 extensions such as Alby and nos2x; NIP-46 signers such as nsec.app and Amber; any object matching `NostrSigner`. | Nothing automated. Reports of a signer that works or doesn't are welcome as issues. | The [manual signer checklist](signer-checklist.md), with the version each signer was last verified on, from 1.0.0-rc.1, [#31](https://github.com/leon-wbr/better-auth-nostr/issues/31) |

<!-- /generated:support-matrix -->

## Versioning policy

better-auth-nostr follows [Semantic Versioning](https://semver.org/). Releases are cut by release-please from [Conventional Commit](https://www.conventionalcommits.org/) titles, and every release has a [changelog entry](https://github.com/leon-wbr/better-auth-nostr/blob/main/CHANGELOG.md).

### Before 1.0

While the version is 0.x, a breaking change bumps the minor version, not the major: 0.7 to 0.8. Its pull request title has a `!` (`feat!: …`) and the pull request carries the `breaking` label; a check fails if only one of the two is there. Release notes list breaking changes first. Names that the 1.0 cleanup ([#34](https://github.com/leon-wbr/better-auth-nostr/issues/34)) deprecates will log a warning for at least one minor release before 1.0 removes them.

### From 1.0

The version is strict SemVer over the public API, which is:

- the endpoint paths and methods, their request bodies and response shapes,
- the client actions, their arguments and their `{ data, error }` shapes,
- the option names, their meaning and their defaults,
- the schema: the model and its fields,
- the error codes and their HTTP statuses,
- the exports of `better-auth-nostr` and `better-auth-nostr/client`, including types.

Not public, and free to change in any release: error message text, log output, internal modules, the `dev-source` export condition, the layout of `dist/`, and timing.

A **major** release is needed for:

- removing or renaming any part of the public API,
- changing a default or an HTTP status,
- a schema change that needs a migration of existing data, such as a new required column, a rename or a drop,
- narrowing an input that used to be accepted.

A **minor** release adds:

- new options, endpoints, actions, exports or error codes,
- a new nullable column (the changelog says to run the migration),
- deprecations,
- a higher Better Auth floor within Better Auth 1.x, with a changelog note,
- dropping a Node version that has reached end-of-life.

A **patch** release fixes behaviour so it matches the documentation.

### Deprecations

A deprecated option, action or export:

- is marked `@deprecated` in its JSDoc, so editors strike it through,
- logs one warning per process through Better Auth's logger,
- names its replacement in the changelog and in the upgrade notes,
- keeps working for at least one minor release and at least 3 months, and is removed only in a major.

### Security fixes

A fix for a vulnerability may break behaviour in a minor or patch release when there is no safe compatible fix. The changelog entry and the security advisory say so.

### Supported versions

Only the latest major gets fixes. After a new major ships, the previous one gets security fixes for 6 months.
