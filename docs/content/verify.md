---
d: docs/verify
title: Verify it yourself
summary: Every claim on this site, and the command that checks it. Including this page.
t: [berm, verification]
nav: 10
x_article: none
---

# Verify it yourself

"Public and transparent from day one" is a claim like any other. Here is how to
check it.

## Check this page

This documentation is published as signed Nostr events. Every page carries its
event id and `naddr` in the footer, and resolves in **any** Nostr client:

```
30023:<project-pubkey>:docs/verify
```

If a page only renders on xonly.ai, we built a website and called it a
protocol. Resolve it somewhere else. That is the test.

The site serves from a disk cache rather than fetching relays per request — a
docs site that is slow because of relay round-trips is an argument against the
architecture, made by us, in public. The footer shows which relays the page came
from and when it was last reconciled, so a stale cache is visible rather than
invisible.

## Check the crypto

```bash
git clone https://github.com/berm-protocol/berm && cd berm/crypto
npm install
npm test          # 119 tests
```

Nothing downstream is safe to build until that is green, because everything
inherits its guarantees.

**Rebuild the test vectors from scratch.** Every input is itself the SHA-256 of
a fixed string, so anyone can regenerate the file and get identical bytes:

```bash
npm run vectors:generate && git diff --exit-code vectors/
```

A non-empty diff means a derivation changed — which means every existing user's
identity changed. That is a migration, never a fix for a red test.

## Check the old design really was broken

```bash
npm test -- negative
```

`attackerRecoversV1Key('12345678')` takes a public integer and returns the
private key its victim would derive. The PIN-search test brute-forces a
six-digit PIN in about nine seconds on one core.

These do not argue that v1 was broken. They compute it.

## Check the SDK

```bash
cd sdk && npm install
npm test               # 34 tests
npm run example:verify # real browser, two local relays, end to end
```

The tests worth reading are the negative ones: the dev signer refusing a public
origin, a forged event from a hostile relay being dropped, one relay accepting
not being reported as published.

The forgery test first confirms the relay really does serve the forgery, then
asserts the SDK dropped it — otherwise it would pass because nothing happened,
which is the most common way a security test lies.

## Check the bundles you are loading

```bash
npm run bundle
sha256sum -c dist/berm-sdk.global.min.js.sha256
```

Compare against the hash published with the release. Use the SRI attribute in
your `<script>` tag. The unminified build ships deliberately, so that a person
about to grant a script a signing surface can read it.

## Check the PHP node

```bash
cd wordpress/xonly-node && php tests/run.php
```

All 15 official BIP-340 vectors, verified in pure PHP with no GMP and no
BCMath — so any shared host can run the check, not only privileged
infrastructure.

## Check a published event end to end

```bash
node scripts/publish-and-read.mjs
```

Signs an event, publishes to two public relays, reads it back, and re-verifies
the signature on the returned copy.

One footgun to know if you write your own: `nostr-tools` memoises `verifyEvent`
via a `Symbol` on the object. **Object spread copies that symbol**, so a
tampered clone can report itself valid. Clone through JSON when you are testing
tamper detection, or you will write a test that proves nothing.

## What we cannot prove to you

Some things are enforced by the browser rather than by our code — chiefly that a
passkey cannot be used from a second origin. That is the WebAuthn RP-ID
guarantee, it cannot be unit-tested in Node, and we call our coverage of it
partial rather than implying otherwise. The manual checklist is in
`crypto/scripts/e2e-checklist.md` and runs per platform before each release.

You are welcome to run it yourself and tell us if it fails.
