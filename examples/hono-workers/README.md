# better-auth-nostr — Hono on Cloudflare Workers

A Hono app on Workers that mounts Better Auth at `/api/auth`, and a static page, served from Workers assets, that signs in with a NIP-07 extension or an nsec. The page's script is bundled with esbuild. Users live in the isolate's memory, so they are gone when it is recycled; use D1 or Hyperdrive for anything real.

The plugin comes from the repo root (`file:../../`), copied in rather than symlinked (`.npmrc`) so it shares this app's copy of Better Auth. After changing `src/`, run `npm run build` in the repo root and `npm install` here again.

```bash
npm install && npm run build   # in the repo root
cd examples/hono-workers
npm install
npm run dev                    # http://localhost:8787
```

`BETTER_AUTH_URL` in `wrangler.json` is the URL signatures are checked against; change it to your deployed URL. For a deployment, also set a secret with `npx wrangler secret put BETTER_AUTH_SECRET`.

## Checking it

- **nsec:** click **Generate**, then **Sign in with nsec**. The page shows the new `npub1…`.
- **NIP-07:** with Alby, nos2x or another extension installed, click **Sign in with a browser extension** and approve the prompt.
- **Scripted:** with `npm run dev` running, `npm run smoke` signs in with a fresh key over HTTP and reads the session back. CI runs it on every PR.
