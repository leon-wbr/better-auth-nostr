# Backfilling account rows for linked keys

Every linked Nostr key is also an `account` row (`providerId: "nostr"`, `accountId`: the hex pubkey), so Better Auth's `listUserAccounts`, `unlinkAccount` and admin tooling see it. The plugin writes that row at sign-up and in `addPubkey`. Keys linked before that have none, and until they do, `removePubkey` and `unlinkAccount` see fewer sign-in methods than the user has, and refuse to remove a key that is not really the last one.

Run one of the two backfills below once, after migrating the schema (which also adds the optional `nostrPubkey.lastUsedAt` column). Both skip keys that already have an account row, so running them again is harmless.

## With `auth.$context`

This goes through your configured adapter, so it works for every database and respects a custom `modelName` or `fields`:

```ts
import { auth } from "./auth";

const ctx = await auth.$context;
const pageSize = 500;
let created = 0;

for (let offset = 0; ; offset += pageSize) {
  const keys = await ctx.adapter.findMany<{ publicKey: string; userId: string }>({
    model: "nostrPubkey",
    limit: pageSize,
    offset,
    sortBy: { field: "createdAt", direction: "asc" },
  });
  for (const key of keys) {
    const accounts = await ctx.internalAdapter.findAccounts(key.userId);
    const linked = accounts.some(
      (account) => account.providerId === "nostr" && account.accountId === key.publicKey,
    );
    if (linked) continue;
    await ctx.internalAdapter.createAccount({
      providerId: "nostr",
      accountId: key.publicKey,
      userId: key.userId,
    });
    created++;
  }
  if (keys.length < pageSize) break;
}

console.log(`created ${created} account rows`);
```

Run it with your app's environment loaded, for example `node --env-file=.env backfill.ts` on Node 22.18 or later.

## In SQL

For the default table and column names. Adjust them if you renamed the model or its fields, or set `advanced.database.generateId` to something other than random strings.

PostgreSQL:

```sql
INSERT INTO "account" ("id", "accountId", "providerId", "userId", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, k."publicKey", 'nostr', k."userId", now(), now()
FROM "nostrPubkey" k
WHERE NOT EXISTS (
  SELECT 1 FROM "account" a
  WHERE a."providerId" = 'nostr' AND a."accountId" = k."publicKey"
);
```

SQLite:

```sql
INSERT INTO "account" ("id", "accountId", "providerId", "userId", "createdAt", "updatedAt")
SELECT lower(hex(randomblob(16))), k."publicKey", 'nostr', k."userId",
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM "nostrPubkey" k
WHERE NOT EXISTS (
  SELECT 1 FROM "account" a
  WHERE a."providerId" = 'nostr' AND a."accountId" = k."publicKey"
);
```

MySQL uses the same statement with backticks for the identifiers and `uuid()` and `now()` for the values.
