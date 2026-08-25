import fs from "node:fs";
import path from "node:path";
import { betterAuth } from "better-auth";
import { nostr } from "better-auth-nostr";
import Database from "better-sqlite3";

export const BASE_URL = process.env.BETTER_AUTH_URL ?? "http://localhost:5173";
export const BASE_PATH = process.env.AUTH_BASE_PATH ?? "/api/auth";

const DB_FILE = process.env.AUTH_DB_FILE ?? "local.db";

export const db = new Database(path.resolve(process.cwd(), DB_FILE));

function runMigrations(db: Database.Database, migrationsPath: string) {
  const migrationsDir = path.resolve(process.cwd(), migrationsPath);

  db.exec(
    `create table if not exists "_migrations" ("name" text not null primary key, "appliedAt" text not null)`,
  );

  const applied = new Set(
    db
      .prepare(`select "name" from "_migrations"`)
      .all()
      .map((row) => (row as { name: string }).name),
  );

  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of migrationFiles) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare(
        `insert into "_migrations" ("name", "appliedAt") values (?, ?)`,
      ).run(file, new Date().toISOString());
    })();
  }
}

runMigrations(db, "migrations");

const nonceTtlMs = process.env.NOSTR_NONCE_TTL_MS
  ? Number(process.env.NOSTR_NONCE_TTL_MS)
  : undefined;

export const auth = betterAuth({
  database: db,
  // Without this the base URL is derived from the incoming request, which
  // means the NIP-98 event is validated against a spoofable Host header.
  baseURL: BASE_URL,
  basePath: BASE_PATH,
  rateLimit: { enabled: process.env.AUTH_RATE_LIMIT === "true" },
  plugins: [nostr({ nonceTtlMs })],
});

export default auth;
