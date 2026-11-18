# Manual signer checklist

CI proves the server side on every runtime and database, but no CI job can approve a request in a browser extension or on a phone. Before each release candidate, a person runs this checklist against [`examples/react`](../examples/react) and records the result in the release PR.

## Setup

1. `npm run build` in the repo root, then `npm install` and `npm run dev` in `examples/react` (see its README).
2. For each signer, start from a fresh browser profile or clear the site's cookies, so every row begins signed out.
3. The example has buttons for NIP-07, `bunker://` and `nostrconnect://`. For the signer-object row, pass an NDK or applesauce signer as `signer` to the same actions from a scratch page or the browser console.
4. Use a throwaway key for every signer. Never test with a key that holds a real identity.

## Steps per signer

- [ ] **Sign in**: sign in with the signer, approve the prompt, and see the session's user.
- [ ] **Add key**: while signed in with another key, add this signer's key, approve, and see it linked.
- [ ] **Sign event**: sign a kind 1 note with `nostr.signEvent` and see a verified event.
- [ ] **Reject**: decline the prompt once and see a clear error, not a hang.

## Matrix

Copy this table into the release PR and fill in each cell with ✅, ❌ (with a note) or `n/a`.

| Signer                      | Transport         | Sign in | Add key | Sign event | Reject |
| --------------------------- | ----------------- | ------- | ------- | ---------- | ------ |
| Alby                        | NIP-07            |         |         |            |        |
| nos2x                       | NIP-07            |         |         |            |        |
| nsec.app                    | `bunker://`       |         |         |            |        |
| nsec.app                    | `nostrconnect://` |         |         |            |        |
| Amber                       | `nostrconnect://` |         |         |            |        |
| NDK or applesauce signer    | signer object     |         |         |            |        |

Record the release candidate, browser and signer versions above the table. A ❌ blocks the release until it is fixed or the row is dropped from the support matrix.
