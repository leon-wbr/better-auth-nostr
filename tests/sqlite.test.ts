import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { describe, expect, it } from "vitest";
import { nostr } from "../src/index";
import type { NostrOptions } from "../src/types";
import {
  type Keypair,
  makeKeypair,
  signLoginToken,
  TEST_ORIGIN,
} from "./helpers";

// node:sqlite is unflagged from Node 22.13; older runtimes skip these tests.
const sqlite = await import("node:sqlite").catch(() => null);

/**
 * Better Auth on a real SQLite database, so unique indexes and transactions
 * behave as in production. The memory adapter enforces neither.
 */
const createSqliteAuth = async (options?: NostrOptions) => {
  if (!sqlite) throw new Error("node:sqlite is not available");
  const database = new sqlite.DatabaseSync(":memory:");
  const auth = betterAuth({
    baseURL: TEST_ORIGIN,
    secret: "test-secret-do-not-use-in-production",
    database,
    emailAndPassword: { enabled: false },
    plugins: [nostr(options)],
    advanced: { disableCSRFCheck: true },
  });
  // Let init (and its schema check against the empty database) finish first.
  await auth.$context;
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
  const count = (table: string) =>
    (
      database.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as {
        n: number;
      }
    ).n;
  return { auth, count };
};

type SqliteAuth = Awaited<ReturnType<typeof createSqliteAuth>>["auth"];

const loginOnce = async (auth: SqliteAuth, keypair: Keypair) => {
  const { nonce } = await auth.api.getNostrNonce({
    body: { publicKey: keypair.publicKey },
  });
  return { nonce, token: await signLoginToken(keypair, nonce) };
};

const login = (
  auth: SqliteAuth,
  { nonce, token }: { nonce: string; token: string },
) =>
  auth.api.loginNostr({
    body: { nonce },
    headers: new Headers({ authorization: token }),
    asResponse: true,
  });

const userIdOf = async (res: Response) =>
  ((await res.json()) as { user: { id: string } }).user.id;

describe.skipIf(!sqlite)("implicit sign-up on SQLite", () => {
  it("signs a new pubkey up once and creates the user with its pubkey row", async () => {
    const { auth, count } = await createSqliteAuth();
    const keypair = makeKeypair();

    const res = await login(auth, await loginOnce(auth, keypair));

    expect(res.status).toBe(200);
    expect(count("user")).toBe(1);
    expect(count("nostrPubkey")).toBe(1);
  });

  it("resolves two concurrent first logins for one pubkey to one user", async () => {
    const { auth, count } = await createSqliteAuth();
    const keypair = makeKeypair();

    const first = await loginOnce(auth, keypair);
    const second = await loginOnce(auth, keypair);

    const [a, b] = await Promise.all([login(auth, first), login(auth, second)]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await userIdOf(a)).toBe(await userIdOf(b));
    expect(count("user")).toBe(1);
    expect(count("nostrPubkey")).toBe(1);
  });

  it("leaves no orphaned user when the pubkey insert loses the race", async () => {
    // Unique emails per call, so only the pubkey's unique index can collide.
    let calls = 0;
    const { auth, count } = await createSqliteAuth({
      generateEmail: (npub) => `${npub}+${++calls}@example.com`,
    });
    const keypair = makeKeypair();

    const first = await loginOnce(auth, keypair);
    const second = await loginOnce(auth, keypair);

    const [a, b] = await Promise.all([login(auth, first), login(auth, second)]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await userIdOf(a)).toBe(await userIdOf(b));
    expect(count("user")).toBe(1);
    expect(count("nostrPubkey")).toBe(1);
  });

  it("still rejects a replayed nonce after a concurrent sign-up", async () => {
    const { auth } = await createSqliteAuth();
    const keypair = makeKeypair();

    const first = await loginOnce(auth, keypair);
    const second = await loginOnce(auth, keypair);
    await Promise.all([login(auth, first), login(auth, second)]);

    expect((await login(auth, first)).status).toBe(401);
  });
});
