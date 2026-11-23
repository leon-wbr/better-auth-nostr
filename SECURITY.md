# Security policy

better-auth-nostr signs users in and links Nostr keys to their accounts, so a bug in it can hand one person's account to another. Reports are welcome, and are handled privately until a fix is out.

## Reporting a vulnerability

Please don't open a public issue, discussion or pull request for a vulnerability. Report it through GitHub's [private vulnerability reporting](https://github.com/leon-wbr/better-auth-nostr/security/advisories/new) (the "Report a vulnerability" button under the repository's Security tab). Only the maintainer sees it.

A useful report has:

- the version of better-auth-nostr, Better Auth and the runtime,
- the plugin options and the part of the flow involved (nonce, sign-in, linking, profile fill, a client signer),
- steps or a test that reproduce it, and what an attacker gains.

If you aren't sure whether something is a vulnerability, report it privately anyway. The [threat model](docs/threat-model.md) lists what the plugin defends against, what it leaves to Better Auth and to your app, and the risks already known.

## Supported versions

| Version | Security fixes |
| --- | --- |
| Latest 0.x minor | Yes, until 1.0.0 ships |
| Older 0.x minors | No: upgrade to the latest minor |

From 1.0 the latest major gets fixes, and the previous major gets security fixes for 6 months after a new one ships, as described in [Support and versioning](docs/support.md#supported-versions). A fix may break behaviour in a minor or patch release when there is no safe compatible fix; the changelog and the advisory say so.

## What to expect

This is a project with one maintainer, so these are targets, not guarantees:

- an acknowledgement within 7 days,
- an assessment, and a severity agreed with you, within 14 days,
- for high and critical issues, a fixed release within 30 days of the assessment; lower severities go into the next regular release.

Fixes are released as a patch or minor release with a regression test, and a GitHub security advisory (with a CVE where one applies) is published when the release is out. You are credited in the advisory unless you ask not to be. Please keep the issue private until then, or for 90 days after your report if no fix has shipped by that time.

Vulnerabilities in Better Auth itself go to [Better Auth](https://github.com/better-auth/better-auth/security), and those in nostr-tools to [nostr-tools](https://github.com/nbd-wtf/nostr-tools). If you aren't sure which project a problem belongs to, report it here and it will be passed on.
