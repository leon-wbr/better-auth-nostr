---
title: Key loss and recovery
description: Backup keys, rotation and what an admin can do, since Nostr has no protocol-level recovery yet.
---

A Nostr key can't be reset. There is no "forgot password" link, and no merged NIP yet lets a key name its successor or revoke itself. Recovery is therefore up to your app: what a user can do after losing a key depends on what you let them set up before.

This page covers what to offer, how a user rotates to a new key, what an admin can do, and how all of this interacts with the rule that a user can't remove their last way to sign in.

## Give users a second way in

Every key linked to an account signs in to it with the same rights. So the simplest safeguard is a second key or a second sign-in method, set up while the user still holds the first key.

### A backup key

`nostr.addPubkey` links another key to the signed-in user, for example one kept offline or in a different signer:

```ts
await authClient.nostr.addPubkey({ signer: backupSigner, name: "Backup" });
```

If the main key is lost, the user signs in with the backup and removes the lost key. Encourage users to keep the backup in a different place than the main key: a key in a second signer app on another device, or an `nsec` written down and stored offline. A backup in the same browser extension is lost with it.

### Email or a passkey

Better Auth's other sign-in methods work next to Nostr on the same user. Enable [email and password](https://www.better-auth.com/docs/authentication/email-password), a [magic link](https://www.better-auth.com/docs/plugins/magic-link) or a [passkey](https://www.better-auth.com/docs/plugins/passkey), and let a signed-in Nostr user add one. Each adds an `account` row, which the last-key rule counts as another way in.

Implicit sign-up gives Nostr users a placeholder email, `<npub>@nostr.local` by default. It can't receive mail, so before relying on email recovery, have the user set a real address and verify it, or use `generateEmail` to assign one you can reach.

## Rotating to a new key

Until a key-rotation NIP is merged, rotation is "link the new key, then remove the old one":

1. Sign in with the old key.
2. Link the new key with `nostr.addPubkey({ signer: newSigner })`.
3. Remove the old key with `nostr.removePubkey({ id })`, taking `id` from `nostr.listPubkeys()`.

Removing needs a fresh session (Better Auth's `session.freshAge`, a day by default), so a long-lived session has to sign in again first. Because the new key is linked before the old one goes, the user never has zero ways to sign in, and the last-key rule doesn't get in the way.

This rotates the key in your app only. Followers on Nostr still follow the old key; moving them is what the drafts below are about.

## Lost versus stolen

A **lost** key is one nobody holds any more. Sign in another way, remove it with `nostr.removePubkey`, and link a replacement.

A **stolen** key is worse: whoever holds it can sign in as the user, and every linked key has the same rights. With a fresh session they can remove the user's other keys too. Act quickly:

- Remove the stolen key from a session signed in another way.
- Revoke the user's sessions, for example with Better Auth's `revokeSessions`, so a session the thief already has ends.
- Check the remaining keys with `nostr.listPubkeys`, and remove any the user doesn't recognise. `lastUsedAt` shows when each key last signed in.

## What an admin can do

An admin can't sign with a user's key, so they can't link a new key for them: linking always needs a NIP-98 signature from the new key. What they can do from the server:

- **Remove a key.** Unlinking the key's `nostr` account removes the key as well, through the plugin's database hook. With `auth.$context`, find the user's accounts with `internalAdapter.findAccounts(userId)` and delete the one whose `accountId` is the lost key with `internalAdapter.deleteAccount(account.id)`. This skips the last-key rule, so make sure the user has another way in or that you intend to lock the account.
- **End sessions.** Better Auth's [admin plugin](https://www.better-auth.com/docs/plugins/admin) can revoke a user's sessions and ban the user, which helps when a key is stolen.
- **Restore access another way.** After verifying the user out of band, set a verified email they control and let them sign in by magic link or password reset, then link a new key from that session.

## The last-key rule

`nostr.removePubkey` refuses with `NOSTR_CANNOT_REMOVE_LAST_PUBKEY` when the key's own `account` row is the user's only one. Better Auth's `unlinkAccount` applies the same rule to Nostr accounts. Any other `account` row counts: another Nostr key, email and password, a social login. Set `account.accountLinking.allowUnlinkingAll` to turn the rule off, for both.

The rule protects against accidents, not attackers: a user can't strand themselves by removing their only key, but it does nothing against someone who holds a stolen key. It also only sees keys that have an `account` row. On an install that linked keys before the plugin wrote those rows, it [creates them](guide.md#managing-linked-keys) before removing a key, so the rule counts every key.

## Where the protocol is heading

Several open drafts propose protocol-level answers. None is merged, and this library implements none of them yet:

- [nips#637](https://github.com/nostr-protocol/nips/pull/637), NIP-37: general methods for dealing with lost keys.
- [nips#829](https://github.com/nostr-protocol/nips/pull/829), NIP-41: simple account migration from one key to the next.
- [nips#1056](https://github.com/nostr-protocol/nips/pull/1056): key revocation.
- [nips#2114](https://github.com/nostr-protocol/nips/pull/2114): key rotation.

If one of them is merged, the plugin can follow a key's announced successor or revocation. Until then, the app-level steps above are the whole story.
