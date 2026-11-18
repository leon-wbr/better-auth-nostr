import type { BetterAuthOptions } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { afterAll, describe, expect, it } from "vitest";
import type { NostrOptions } from "../src/types";
import {
  createTestAuth,
  makeKeypair,
  performLogin,
  prepareLogin,
} from "./helpers";

// node:sqlite is unflagged from Node 22.13; older runtimes skip it.
const sqlite = await import("node:sqlite").catch(() => null);
// CI's Postgres service sets POSTGRES_URL; without it the Postgres run skips.
const POSTGRES_URL = process.env.POSTGRES_URL;
const pg = POSTGRES_URL ? (await import("pg")).default : null;

type Backend = {
  name: string;
  available: boolean;
  /** Unique indexes and transactions; the memory adapter has neither. */
  enforcesUniqueness: boolean;
  database?: () => Promise<BetterAuthOptions["database"]>;
};

const pools: { end: () => Promise<void> }[] = [];
afterAll(() => Promise.all(pools.map((pool) => pool.end())));

const backends: Backend[] = [
  { name: "memory", available: true, enforcesUniqueness: false },
  {
    name: "SQLite",
    available: !!sqlite,
    enforcesUniqueness: true,
    database: async () => new sqlite!.DatabaseSync(":memory:"),
  },
  {
    name: "Postgres",
    available: !!pg,
    enforcesUniqueness: true,
    // A schema per test, so each one starts from empty tables.
    database: async () => {
      const schema = `t_${crypto.randomUUID().replaceAll("-", "")}`;
      const admin = new pg!.Pool({ connectionString: POSTGRES_URL });
      pools.push(admin);
      await admin.query(`CREATE SCHEMA ${schema}`);
      const pool = new pg!.Pool({
        connectionString: POSTGRES_URL,
        options: `-c search_path=${schema}`,
      });
      pools.push(pool);
      return pool;
    },
  },
];

const setup = async (backend: Backend, options?: NostrOptions) => {
  const database = await backend.database?.();
  const auth = createTestAuth(options, database ? { database } : {});
  if (database) {
    // Let init (and its schema check against the empty database) finish first.
    await auth.$context;
    const { runMigrations } = await getMigrations(auth.options);
    await runMigrations();
  }
  const { adapter } = await auth.$context;
  const count = (model: string) => adapter.count({ model });
  return { auth, count };
};

const userIdOf = async (res: Response) =>
  ((await res.json()) as { user: { id: string } }).user.id;

describe.each(backends)("$name adapter", (backend) => {
  const test = it.skipIf(!backend.available);
  const itUnique = it.skipIf(!backend.available || !backend.enforcesUniqueness);

  test("signs a new pubkey up once and creates the user with its pubkey row", async () => {
    const { auth, count } = await setup(backend);

    const res = await performLogin(auth, makeKeypair());

    expect(res.status).toBe(200);
    expect(await count("user")).toBe(1);
    expect(await count("nostrPubkey")).toBe(1);
  });

  test("consumes one nonce once when it is used twice at the same time", async () => {
    const { auth } = await setup(backend);
    const login = await prepareLogin(auth, makeKeypair());

    const statuses = (await Promise.all([login(), login()])).map(
      (res) => res.status,
    );

    expect(statuses.sort()).toEqual([200, 401]);
  });

  itUnique.each([
    ["resolves two concurrent first logins for one pubkey to one user", {}],
    [
      // Unique emails per call, so only the pubkey's unique index can collide.
      "leaves no orphaned user when the pubkey insert loses the race",
      {
        generateEmail: (npub) => `${npub}+${crypto.randomUUID()}@example.com`,
      },
    ],
  ] satisfies [string, NostrOptions][])("%s", async (_, options) => {
    const { auth, count } = await setup(backend, options);
    const keypair = makeKeypair();
    const first = await prepareLogin(auth, keypair);
    const second = await prepareLogin(auth, keypair);

    const [a, b] = await Promise.all([first(), second()]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await userIdOf(a)).toBe(await userIdOf(b));
    expect(await count("user")).toBe(1);
    expect(await count("nostrPubkey")).toBe(1);

    const replay = await first();
    expect(replay.status).toBe(401);
    expect(await replay.json()).toMatchObject({
      code: "NOSTR_INVALID_NONCE",
    });
  });
});
