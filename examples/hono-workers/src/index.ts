import { betterAuth } from "better-auth";
import { nostr } from "better-auth-nostr";
import { Hono } from "hono";

type Env = { BETTER_AUTH_URL: string; BETTER_AUTH_SECRET?: string };

let auth: ReturnType<typeof createAuth> | undefined;

const createAuth = (env: Env) =>
  betterAuth({
    // NIP-98 signatures are checked against this URL, never the Host header.
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    // No `database`, so users live in this isolate's memory and are gone when
    // it is recycled. Use D1 or Hyperdrive for real data.
    plugins: [nostr()],
  });

const app = new Hono<{ Bindings: Env }>();

app.on(["GET", "POST"], "/api/auth/*", (c) => {
  auth ??= createAuth(c.env);
  return auth.handler(c.req.raw);
});

export default app;
