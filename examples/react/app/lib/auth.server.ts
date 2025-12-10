import { betterAuth } from "better-auth";
import Database from "better-sqlite3";
import { nostr } from "better-auth-nostr";
import fs from "fs";
import path from "path";

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
