import { getMigrations } from "better-auth/db/migration";
import { describe, expect, it } from "vitest";
import type { NostrOptions } from "../src/types";
import { createTestAuth, makeKeypair, prepareLogin } from "./helpers";

// node:sqlite is unflagged from Node 22.13; older runtimes skip these tests.
const sqlite = await import("node:sqlite").catch(() => null);

/**
 * Better Auth on a real SQLite database, so unique indexes and transactions
 * behave as in production. The memory adapter enforces neither.
 */
const createSqliteAuth = async (options?: NostrOptions) => {
  if (!sqlite) throw new Error("node:sqlite is not available");
  const database = new sqlite.DatabaseSync(":memory:");
  const auth = createTestAuth(options, { database });
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

const raceFirstLogins = async (options?: NostrOptions) => {
  const { auth, count } = await createSqliteAuth(options);
  const keypair = makeKeypair();
  const first = await prepareLogin(auth, keypair);
  const second = await prepareLogin(auth, keypair);
  const responses = await Promise.all([first(), second()]);
  return { count, first, responses };
};

const userIdOf = async (res: Response) =>
  ((await res.json()) as { user: { id: string } }).user.id;

describe.skipIf(!sqlite)("implicit sign-up on SQLite", () => {
  it("signs a new pubkey up once and creates the user with its pubkey row", async () => {
    const { auth, count } = await createSqliteAuth();

    const res = await (await prepareLogin(auth, makeKeypair()))();

    expect(res.status).toBe(200);
    expect(count("user")).toBe(1);
    expect(count("nostrPubkey")).toBe(1);
  });

  it.each([
    ["resolves two concurrent first logins for one pubkey to one user", {}],
    [
      // Unique emails per call, so only the pubkey's unique index can collide.
      "leaves no orphaned user when the pubkey insert loses the race",
      { generateEmail: (npub) => `${npub}+${crypto.randomUUID()}@example.com` },
    ],
  ] satisfies [string, NostrOptions][])("%s", async (_, options) => {
    const {
      count,
      responses: [a, b],
    } = await raceFirstLogins(options);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await userIdOf(a)).toBe(await userIdOf(b));
    expect(count("user")).toBe(1);
    expect(count("nostrPubkey")).toBe(1);
  });

  it("still rejects a replayed nonce after a concurrent sign-up", async () => {
    const { first } = await raceFirstLogins();

    const replay = await first();

    expect(replay.status).toBe(401);
    expect(await replay.json()).toMatchObject({ code: "NOSTR_INVALID_NONCE" });
  });
});
