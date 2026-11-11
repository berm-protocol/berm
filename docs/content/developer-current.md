---
d: docs/developer-current
title: Current binding developer quickstart
summary: Run the current method and verify complete signed evidence from a standalone checkout.
nav: 12
x_article: none
---

# Current binding developer quickstart

Clone the Berm repository and use Node 22.6 or newer. The standalone current
method package needs no npm packages, wallet, service or network connection:

```sh
node sdk/external-binding-v2/verify.mjs
node --test sdk/external-binding-v2/test.mjs
node sdk/external-binding-v2/example.mjs
```

The first command verifies the byte-exact upstream source mirrors, original
method/acquisition documents and all 97 method vectors. The tests verify a
complete disposable signed subject claim, role authorization, observation,
application policy and receipt, including altered or missing evidence refusals.
The example's file export can be independently read and verified. The same
canonical implementation is used; there is no permissive developer parser.

Read the repository's `sdk/external-binding-v2/README.md` for imports and exact
source provenance. The policy and application key must be selected independently
of submitted evidence. Valid signatures do not make an arbitrary policy trusted.

## What this does not certify

The example uses synthetic captures and public disposable keys. It performs no
live X request, publishes no event and creates no public identity standing. It
does not certify a durable production receiver or independent validator
operators. Two servers operated by one person are not two independent operators.

The exact current standard is described in [Current standard](current-standard.md).
Historical NIP-39 and archive records retain their original meaning; they are not
silently converted into current method evidence. Application-specific campaign
rights and financial contracts remain outside this identity-method quickstart.

## Full repository verification

The existing full gate is `node scripts/verify-all.mjs`. It uses committed npm
lockfiles and requires Chromium and PHP. Missing tools are a setup issue, not a
passing test. The verification entrypoint includes this quickstart, while its
browser, SDK, legacy recovery and PHP checks remain intact.

## BRM 0.1 file conformance

The existing recovery profile is `berm.recovery_module/0.1`. Read
[Recovery](docs/recovery) for identity restoration, same-root EVM derivation,
confirmation semantics and limits. Schema validation alone is not decryption,
npub checksum verification or root/public-metadata equality.

Use the repository's `recovery/brm-0.1/PROFILE.md`, `schema.json`,
`shape-example.json`, `shape-vectors.json` and `IMPLEMENTATION.json`:

```sh
npm ci --prefix recovery/brm-0.1 --no-audit --no-fund
node --test recovery/brm-0.1/test.mjs
node docs/build.mjs
node scripts/check-brm-docs.mjs
```

These BRM fixtures are synthetic and not decryptable backups. The custom
`brm-js-date` format must assert the accepted JavaScript Date.parse predicate;
silently ignoring it is not conformance. The existing complete repository gate
includes these checks. No Xonly/BermLaunch runtime, user flow, key or service is
modified. `BRM_RECOVERY_CONFIRMED` does not prove a saved-file reopen.
