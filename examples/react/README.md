# better-auth-nostr — React Router example

A minimal React Router v7 app wired to `better-auth-nostr` through a real SQLite database. It exists to exercise the plugin by hand: sign in with an nsec, a NIP-07 extension, or a NIP-46 remote signer, link additional pubkeys to the account, and watch what the server does with them.

The plugin is linked with `file:../../`, so npm symlinks the repo root into `node_modules`. Run `npm run build` at the repo root after changing anything under `src/` — the example imports `dist`, not `src`.

## Setup

```bash
npm install          # in the repo root
npm run build        # in the repo root
cd examples/react
npm install
npm run dev          # http://localhost:5173
```

The database is a file (`local.db`, gitignored) created on first boot. Migrations in `migrations/*.sql` are applied once and recorded in a `_migrations` table, so restarts are cheap and your test users survive them. To start over, stop the server, `rm local.db`, and start it again — deleting the file while the server is running leaves it holding a dead handle and every request 500s.

## Configuration flags

Everything is driven by shell environment variables, so each scenario is a one-line change rather than a code edit. `vite.config.ts` forwards the URL settings to the browser bundle, which keeps the client and the server signing against the same URL.

| Variable | Default | What it does |
| --- | --- | --- |
| `BETTER_AUTH_URL` | `http://localhost:5173` | The `baseURL` the server validates NIP-98 events against, and the one the client signs with. |
| `AUTH_BASE_PATH` | `/api/auth` | Where Better Auth is mounted. `/auth` is pre-registered as a second route, so `AUTH_BASE_PATH=/auth` works without touching `app/routes.ts`. |
| `AUTH_DB_FILE` | `local.db` | SQLite file path. Point it somewhere else for a throwaway run. |
| `NOSTR_NONCE_TTL_MS` | 5 minutes | Nonce lifetime. Set it to `1` to make every nonce arrive expired. |
| `AUTH_RATE_LIMIT` | `false` | Better Auth disables rate limiting in development; set `true` to exercise it. |

## What to test

The UI generates throwaway keys for you — the **Generate** button next to any private key field mints a fresh nsec — so you never need to paste a real one.

For the paths that are tedious to drive by hand — nonce replay, a token signed for another URL, a spoofed `Host` header, add-pubkey without a session — `npm run smoke` runs them all against a server you already started with `npm run dev` and prints a pass/fail line for each. It reads the same `BETTER_AUTH_URL` and `AUTH_BASE_PATH` variables as the app.

**Sign-in and implicit signup.** Generate an nsec, sign in, and confirm a user appears with an `npub1…@nostr.local` email. Sign out, sign back in with the same key, and confirm you land on the same user rather than a second one.

**Remote signers (NIP-46).** Two flows, both under the same method toggle, and both available for sign-in and for linking a key.

*Bunker.* Open [nsec.app](https://nsec.app), create or unlock a key, and copy the `bunker://` connection string it offers. Paste it into the **Bunker** field and log in — the approval prompt appears in the nsec.app tab. A NIP-05 identifier whose provider advertises NIP-46 works in the same field.

*Nostr Connect.* Pick **Nostr Connect** and hit login: the app mints a `nostrconnect://` URI and prints it. Paste it into Amber (or scan it, in a real app that renders a QR code) and approve. The example waits up to two minutes.

Both paths require a working relay, so they are the one part of this example that does not run offline. If the signer sits on the approval prompt for more than a minute you will get a "the signer took too long" error rather than a `401` — that is the NIP-98 60-second window, not a bug.

**Linking a second pubkey.** While signed in, generate a second nsec under *Link another pubkey*, give it a label, and link it. It should appear in the linked list. Sign out, then sign in with that second key — you should land on the *same* account, with both keys still listed. Linking a key the account already owns is a no-op; linking one owned by a different account returns `409`.

**The multi-tab nonce trap.** Open two tabs, start a sign-in in each with the *same* key, and submit the first one. Nonces are keyed per pubkey and consuming one deletes every row for that key, so the second tab's nonce was already orphaned by the first tab's request — expect both to fail with "Invalid or expired nonce". A plain refresh-then-retry reproduces it too. Worth deciding whether that behaviour is acceptable before release.

**Expired nonces.** Run with `NOSTR_NONCE_TTL_MS=1` and sign in. The request should fail with "Invalid or expired nonce" rather than succeeding.

**A non-default mount path.** Run with `AUTH_BASE_PATH=/auth`. Sign-in should keep working, because both sides derive the signing URL from the same variable. Change only one side to see it break.

**Host-header spoofing.** With `baseURL` configured, the NIP-98 event is validated against the configured URL rather than the incoming `Host`. `npm run smoke` covers this, or by hand:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:5173/api/auth/nostr/login \
  -H 'content-type: application/json' -H 'origin: http://localhost:5173' \
  -H 'host: evil.example' -H 'x-forwarded-host: evil.example' \
  -H "authorization: <a token signed for http://evil.example/api/auth/nostr/login>" \
  -d '{"nonce":"<the nonce>"}'
```

Expect `401`. Note that this protection only exists because the example sets `baseURL` — with it unset, Better Auth derives the base URL from the request and the check follows the attacker's header.

**NIP-07 extensions.** Install Alby or nos2x and use the NIP-07 toggle for both sign-in and linking. This is the one path the automated suite cannot reach.

**Cascade delete.** Link a couple of keys, then delete the user directly and confirm the rows go with it:

```bash
sqlite3 local.db 'pragma foreign_keys = on; delete from "user" where email like "npub1%";'
sqlite3 local.db 'select count(*) from "nostrPubkey";'
```

`better-sqlite3` enables foreign keys per connection by default, so the app enforces the cascade; the `pragma` above is only needed because the `sqlite3` CLI does not.

**Rate limiting.** Run with `AUTH_RATE_LIMIT=true` and hammer `/api/auth/nostr/nonce` — the endpoint is unauthenticated and writes a verification row per call, so confirm the global limiter actually covers it.

**Email collisions.** Enable another provider in `app/lib/auth.server.ts` (`emailAndPassword: { enabled: true }`), register `npub1…@nostr.local` through it, then sign in with the matching key and see how the implicit-signup path reports the collision.

## Talking to the API directly

Session-authenticated endpoints are behind Better Auth's CSRF check, so a raw `curl` or `fetch` must send an `Origin` header matching `baseURL`. Without one, `/nostr/add-pubkey` returns `403 MISSING_OR_NULL_ORIGIN` — a browser sets it automatically, a script does not.
