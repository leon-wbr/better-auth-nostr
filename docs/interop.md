---
title: Interop
description: Using Nostr sign-in next to other Better Auth plugins, and with signers from NDK, applesauce, window.nostr.js and Amber.
---

Nostr sign-in creates an ordinary Better Auth user and session, so most plugins work with it unchanged. This page lists the ones that are tested together, and shows how to bring signers from other Nostr libraries. For runnable apps, see the [examples](https://github.com/leon-wbr/better-auth-nostr/tree/main/examples): React Router, Next.js, and Hono on Cloudflare Workers.

## Better Auth plugins

Each of these is covered by `tests/compat.test.ts`, which signs in through the real client with both plugins installed.

- **admin.** A banned user's key is refused with `BANNED_USER` (403), like any other sign-in method. Once `banExpires` has passed, the next sign-in lifts the ban.
- **multiSession.** Each key signs in to its own session in the same browser. `multiSession.listDeviceSessions` lists them and `multiSession.setActive` switches between them.
- **organization.** A Nostr user can create an organization and switch to it; the active organization is kept on the session as usual.
- **customSession.** The callback receives the Nostr user like any other. To put the user's linked pubkeys on the session:

  ```ts
  customSession(async ({ user, session }, ctx) => {
    const pubkeys = await ctx.context.adapter.findMany<NostrPubkey>({
      model: "nostrPubkey",
      where: [{ field: "userId", value: user.id }],
    });
    return { user, session, pubkeys: pubkeys.map((p) => p.publicKey) };
  });
  ```

- **anonymous.** A guest can sign in with Nostr, but the plugin's `onLinkAccount` does not fire yet: it only watches sign-in paths under `/sign-in/`, and Nostr sign-in is at `/nostr/login`. [#34](https://github.com/leon-wbr/better-auth-nostr/issues/34) moves it to `/sign-in/nostr`. Until then, the guest keeps its own user, and moving its data over is up to you.

## Signers from other libraries

`signIn.nostr`, `nostr.addPubkey` and `nostr.signEvent` accept any object with `getPublicKey()` and `signEvent(template)`, passed as `signer` (see [Signers](guide.md#signers)).

### applesauce

Every signer in `applesauce-signers` already has that shape, so it can be passed as is:

```ts
import { ExtensionSigner, PrivateKeySigner } from "applesauce-signers";

await authClient.signIn.nostr({ signer: new ExtensionSigner() });
await authClient.signIn.nostr({ signer: PrivateKeySigner.fromKey(nsec) });
```

The same goes for its `NostrConnectSigner`, once you have connected it with a relay pool as its docs describe.

### NDK

An `NDKSigner` returns only the signature, so wrap it to return the signed event:

```ts
import type { NDKSigner } from "@nostr-dev-kit/ndk";
import type { NostrSigner } from "better-auth-nostr/client";
import { getEventHash } from "nostr-tools";

const fromNdk = (signer: NDKSigner): NostrSigner => ({
  getPublicKey: async () => (await signer.user()).pubkey,
  signEvent: async (template) => {
    const event = { ...template, pubkey: (await signer.user()).pubkey };
    const id = getEventHash(event);
    return { ...event, id, sig: await signer.sign({ ...event, id }) };
  },
});

await authClient.signIn.nostr({ signer: fromNdk(ndk.signer) });
```

This works for `NDKPrivateKeySigner`, `NDKNip07Signer` and `NDKNip46Signer`.

### window.nostr.js

[window.nostr.js](https://github.com/fiatjaf/window.nostr.js) gives visitors without an extension a `window.nostr` backed by a NIP-46 remote signer. Load it on the page and call `signIn.nostr()` with no signer, as for an extension:

```html
<script src="https://cdn.jsdelivr.net/npm/window.nostr.js/dist/window.nostr.min.js"></script>
```

The client looks up `window.nostr` on each call, so the script can finish loading after your app has started. Pin a version in the URL in production.

### Amber via nostrconnect://

Amber, the Android signer, connects through NIP-46 with a `nostrconnect://` URI. Show the URI as a QR code, or as a link on the same phone, and wait for the user to approve:

```ts
import { createNostrConnectSession } from "better-auth-nostr/client";

const session = createNostrConnectSession({
  metadata: { name: "My App", url: location.origin },
  relays: ["wss://relay.nsec.app"],
});
showQrCode(session.uri); // or <a href={session.uri}> on Android

const signer = await session.connect(120_000);
try {
  await authClient.signIn.nostr({ signer });
} finally {
  await signer.close();
}
```

Amber needs to be able to reach the relay you pass. Approving more than 60 seconds after the request fails with `NOSTR_SIGNER_TOO_SLOW`, as described under [remote signers](guide.md#remote-signers-nip-46). Amber's Android intents (NIP-55) are not supported.
