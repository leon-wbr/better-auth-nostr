# Better Auth Nostr

A [Better Auth](https://better-auth.com/) plugin for signing in with Nostr. The server verifies a [NIP-98](https://github.com/nostr-protocol/nips/blob/master/98.md) signed HTTP event and issues an ordinary Better Auth session; no password or private key ever reaches it. Each user can link several Nostr keys.

This page takes you from nothing to a first Nostr sign-in. Then read on:

- [Guide](guide.md): signers (NIP-07, nsec, NIP-46), profiles and relays, and how sign-in works.
- [Reference](reference.md): endpoints, client actions, error codes and the schema, plus the generated [API pages](api/index.md) with every export and option.
- [Support and versioning](support.md): what is tested, and what a version number promises.
- [Changelog](https://github.com/leon-wbr/better-auth-nostr/blob/main/CHANGELOG.md) and [contributing](https://github.com/leon-wbr/better-auth-nostr/blob/main/CONTRIBUTING.md).

This site follows `main`. For the docs of the version you have installed, open `https://github.com/leon-wbr/better-auth-nostr/tree/vX.Y.Z/docs`; releases from before this site existed have only their README.

## 1. Install

```bash
npm install better-auth better-auth-nostr
```

The other peer dependencies (`@better-auth/core`, `@better-auth/utils`, `@better-fetch/fetch`, `nanostores`) are installed for you by npm 7 and later. With another package manager, add them yourself.

## 2. Add the server plugin

```ts
import { betterAuth } from "better-auth";
import { nostr } from "better-auth-nostr";

export const auth = betterAuth({
  baseURL: "https://app.example.com",
  plugins: [nostr()],
});
```

Set `baseURL`, or `BETTER_AUTH_URL`. The signed event is bound to the endpoint URL, and without a configured base URL Better Auth derives it from the request's `Host` header, which an attacker controls, so in production the plugin refuses to start without one. [How it works](guide.md#how-it-works) explains why.

## 3. Migrate the database

The plugin adds one model, `nostrPubkey` (see [Schema](reference.md#schema)). Create it with Better Auth's CLI:

```bash
npx auth@latest migrate    # Kysely adapter: applies the change
npx auth@latest generate   # Prisma or Drizzle: writes the schema for your own migration
```

Each linked key is also registered as an `account` row with `providerId: "nostr"`, so Better Auth's own account APIs see it. Keys linked by an older version get theirs on the user's next sign-in; see [the guide](guide.md#managing-linked-keys) before upgrading to 1.0.

## 4. Add the client plugin

```ts
import { createAuthClient } from "better-auth/client";
import { nostrClient } from "better-auth-nostr/client";

export const authClient = createAuthClient({
  baseURL: "https://app.example.com",
  plugins: [nostrClient()],
});
```

The client signs against `baseURL + basePath`, which has to match the URL the server checks. If Better Auth is mounted somewhere other than `/api/auth`, pass the same `basePath` here.

## 5. Sign in with an extension

With a NIP-07 extension such as Alby or nos2x installed, this is all a sign-in button needs:

```ts
const { data, error } = await authClient.signIn.nostr();
if (error) console.error(error.code, error.message);
```

The first sign-in with a new key creates a user, named after the npub and with a placeholder email `npub1…@nostr.local`. Set [`disableImplicitSignUp`](api/better-auth-nostr/client.md#property-disableimplicitsignup) to allow only keys that are already linked, or [`generateEmail`](api/better-auth-nostr/client.md#property-generateemail) to choose the email. The action never throws: a failure comes back as `error`, with a stable [`error.code`](reference.md#error-codes).

No extension? Pass `{ nsec }` or a NIP-46 remote signer instead; the [guide](guide.md#signers) shows each.

## 6. Link a second key

A signed-in user can link another key, for example a backup:

```ts
await authClient.nostr.addPubkey({ nsec: backupNsec, name: "Backup key" });
```

Either key then signs in to the same account. Linking a key that already belongs to someone else fails with `NOSTR_PUBKEY_LINKED_TO_OTHER_USER`. `nostr.listPubkeys`, `nostr.updatePubkey` and `nostr.removePubkey` let the user see, rename and remove their keys: see [Managing linked keys](guide.md#managing-linked-keys).

## Where next

- Plan for a lost key before a user loses one: [Key loss and recovery](key-loss.md).
- Fill the user's name and avatar from their Nostr profile: [Profiles and relays](guide.md#profiles-and-relays).
- Sign with a phone or a bunker: [Remote signers](guide.md#remote-signers-nip-46).
- Sign other events after login: [Signing other events](guide.md#signing-other-events).
