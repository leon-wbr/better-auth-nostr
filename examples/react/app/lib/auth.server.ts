import fs from "node:fs";
import path from "node:path";
import { betterAuth } from "better-auth";
import { nostr } from "better-auth-nostr";
import Database from "better-sqlite3";

// Create the database instance
const db = new Database(":memory:");

function runMigrations(db: Database.Database, migrationsPath: string) {
  const migrationsDir = path.resolve(process.cwd(), migrationsPath);
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of migrationFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    db.exec(sql);
  }
}

// Run migrations from ./migrations/*.sql
runMigrations(db, "migrations");

// Create the BetterAuth instance
export const auth = betterAuth({
  database: db,
  plugins: [nostr()],
});

export default auth;
