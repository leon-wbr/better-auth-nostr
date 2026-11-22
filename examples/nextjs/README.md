# better-auth-nostr — Next.js example

The smallest Next.js App Router app with Nostr sign-in: a catch-all route handler for Better Auth, a client component that signs in with a NIP-07 extension or an nsec, and a server component that reads the session. Users live in memory, so they are gone when the server restarts; pass your database to `betterAuth` in `lib/auth.ts` for anything real.

The plugin comes from the repo root (`file:../../`), copied in rather than symlinked (`.npmrc`) so it shares this app's copy of Better Auth. After changing `src/`, run `npm run build` in the repo root and `npm install` here again.

```bash
npm install && npm run build   # in the repo root
cd examples/nextjs
npm install
npm run dev                    # http://localhost:3000
```

`BETTER_AUTH_URL` (default `http://localhost:3000`) is the URL signatures are checked against; `next.config.ts` hands it to the browser, so set it once for both. `next start` runs in production mode, where Better Auth also needs `BETTER_AUTH_SECRET`.

## Checking it

- **nsec:** click **Generate**, then **Sign in with nsec**. Both the server line and the client line show the new `npub1…`.
- **NIP-07:** with Alby, nos2x or another extension installed, click **Sign in with a browser extension** and approve the prompt.
- **Scripted:** with the server running, `npm run smoke` signs in with a fresh key over HTTP and reads the session back. CI runs it against `next start` on every PR.
