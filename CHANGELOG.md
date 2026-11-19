# Changelog

## [0.8.0](https://github.com/leon-wbr/better-auth-nostr/compare/v0.7.0...v0.8.0) (2026-11-19)


### ⚠ BREAKING CHANGES

* require Node 22 and prove sign-in on Bun, Deno and Workers in CI ([#67](https://github.com/leon-wbr/better-auth-nostr/issues/67))
* rate-limit the nostr endpoints and require baseURL in production ([#63](https://github.com/leon-wbr/better-auth-nostr/issues/63))

### Features

* list, rename and remove linked pubkeys, mirrored as nostr accounts ([#68](https://github.com/leon-wbr/better-auth-nostr/issues/68)) ([4e0c9c7](https://github.com/leon-wbr/better-auth-nostr/commit/4e0c9c7d4cc5d3602a9a5ea79bb0ca3dbb71a2b7)), closes [#32](https://github.com/leon-wbr/better-auth-nostr/issues/32)
* rate-limit the nostr endpoints and require baseURL in production ([#63](https://github.com/leon-wbr/better-auth-nostr/issues/63)) ([781077f](https://github.com/leon-wbr/better-auth-nostr/commit/781077fea004be5c282e460a99aab88bbb0ceb9f))
* require Node 22 and prove sign-in on Bun, Deno and Workers in CI ([#67](https://github.com/leon-wbr/better-auth-nostr/issues/67)) ([b7dc483](https://github.com/leon-wbr/better-auth-nostr/commit/b7dc483b5525f123a3b9e628bfc363ebb21d5b58)), closes [#31](https://github.com/leon-wbr/better-auth-nostr/issues/31)


### Bug Fixes

* answer 409 or 200, not 500, when the same pubkey is added twice at once ([#71](https://github.com/leon-wbr/better-auth-nostr/issues/71)) ([c3e231f](https://github.com/leon-wbr/better-auth-nostr/commit/c3e231f9bcf947a9d7bfbb69e50826ee69089f52))

## [0.7.0](https://github.com/leon-wbr/better-auth-nostr/compare/v0.6.0...v0.7.0) (2026-11-16)


### ⚠ BREAKING CHANGES

* a stable code for every Nostr error, in $ERROR_CODES ([#52](https://github.com/leon-wbr/better-auth-nostr/issues/52))

### Features

* a stable code for every Nostr error, in $ERROR_CODES ([#52](https://github.com/leon-wbr/better-auth-nostr/issues/52)) ([6fbefa9](https://github.com/leon-wbr/better-auth-nostr/commit/6fbefa9597ad5a7224e44f8e9987e787e6051efe))


### Bug Fixes

* answer 500 for storage exceptions; a denied session stays 401 ([#50](https://github.com/leon-wbr/better-auth-nostr/issues/50)) ([d2f9442](https://github.com/leon-wbr/better-auth-nostr/commit/d2f94421a4f0c88e1e76920a596b370e97df93bc))
* **client:** re-verify the signer's event on sign-in too ([#53](https://github.com/leon-wbr/better-auth-nostr/issues/53)) ([f4a3fa0](https://github.com/leon-wbr/better-auth-nostr/commit/f4a3fa0882ff6e85067361126a046069bad22f2f))
* **example:** top-align the page, two columns from 1024px, readable light mode ([#62](https://github.com/leon-wbr/better-auth-nostr/issues/62)) ([2e51aa3](https://github.com/leon-wbr/better-auth-nostr/commit/2e51aa3ddd77d67a78aa01e069459a015f8e068b))
* make implicit sign-up atomic ([#46](https://github.com/leon-wbr/better-auth-nostr/issues/46)) ([5409a96](https://github.com/leon-wbr/better-auth-nostr/commit/5409a960a3225c0e2ba27305a2cc20cf1747f072))
