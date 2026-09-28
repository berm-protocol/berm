# Technical reference

## Exact current identities

See [CURRENT_STANDARD.json](../CURRENT_STANDARD.json) for the machine-readable form.

```text
protocol authority lineage   R13-A REISSUE R4
  artifact                   OPUS_BERM_PROTOCOL_R13_A_REISSUE_R4_DETERMINISTIC_PUBLIC_LANGUAGE_CANDIDATE_R5_20260828.zip
  sha256                     d47176e2e0d6809b768404c25f069103ac4c4a1bda6f70d9528544e9251784ff  (384638 bytes)

current X method             berm.external_account_binding.x/2
  methodHash                 sha256:a95319d8664b16ca355b3d82bc8c4d5bb6007c8aed65116a74447f79b0e5e193
  vectorSetHash              sha256:0ced853da13b3378b4e138883398ecd7831e27b00c2f03ee759af9668a45e6c5
  vectors                    97
  implementation lane        R8
  immutable R8 anchor        50c8d54d41fb5395c166c02704b129f14082a69acddef34ba7b5a9a19d233a25
  R8 founder pin             fef6c8fa131fc00caa048f2a1fde255b09070bfe3c3d70dfb0fef39138dbf8de

acquisition                  berm.acquisition.x-direct-status/1
  hash                       sha256:46fbed235696decc92e298e55e3a4ee1ebd5e61d169cd3462265cb3ff5c98f1d
transport                    berm.transport.x-syndication-via-same-origin-proxy/2
  bridge sha256              7e208b3b192f1d2d3caa503a6d3b54fac1c8c533dba9ce1d1c11464a9dce11bf
producer law                 berm.composer_producer_law/2
  hash                       sha256:ed9e25056cbdec7d14fa568a731513eef5255c5febed061573afee4db1143aaa
```

## Where the bytes live in this repository

| Path | Contents |
|---|---|
| `shared/berm-protocol-r13a/authority/EXACT_HASH_REGISTRY.json` | runtime hash registry (method id, method/acquisition/vector/wire anchors) |
| `shared/berm-protocol-r13a/authority/method/spec/METHODSPEC_CANONICAL.md` | the hashed `/2` method document (SHA-256 = methodHash) |
| `shared/berm-protocol-r13a/authority/method/spec/ACQUISITION_PROFILE.md` | the hashed acquisition profile |
| `shared/berm-protocol-r13a/authority/wire/EVIDENCE_FOLD.md` | how a stranger folds the public artifacts |
| `shared/berm-protocol-r13a/schemas/*.schema.json` | the five wire schemas + common definitions |
| `shared/berm-protocol-r13a/authority/PINNED_AUTHORITY_RECEIPT.json` | the R13-A REISSUE R4 pin receipt (historical `/1` anchors) |
| `fixtures/identity/r13a/vectors/XB-*.json` | the 97 normative vectors |
| `packages/sdk/src/bermProtocolR13a.js` | runtime constants for the current method |

Some internal files still carry the word `CANDIDATE` in their own packaging
text. Those bytes are pinned and are not rewritten; the external founder pins
recorded in [CURRENT_STANDARD.md](CURRENT_STANDARD.md) control standing.

The immutable R8 anchor, the R8 founder pin and the transport bridge are
external artifacts. Their hashes are recorded here; their bytes are not part of
this repository.

## Verify locally

```text
node e2e/berm_protocol_r13a_authority_pins.mjs   # registry, spec files, 97-vector set hash
node e2e/berm_protocol_docs_drift.mjs            # docs ⇄ CURRENT_STANDARD.json ⇄ runtime registry parity
node e2e/berm_protocol_docs_route.mjs            # website /docs/ → /docs/protocol/ route and link
```

Recompute the method hash by hand:

```text
sha256sum shared/berm-protocol-r13a/authority/method/spec/METHODSPEC_CANONICAL.md
# a95319d8664b16ca355b3d82bc8c4d5bb6007c8aed65116a74447f79b0e5e193
```

The vector set hash is SHA-256 over the UTF-8 text formed by joining, with `\n`,
one line `XB-NNN.json:sha256:<hex>` per vector file in sorted order.

## Transport law

Current protocol law requires **no** Bearer token, **no** OAuth, **no** user
private cookies, and **no** privileged X API. A historical genesis-prep candidate
that introduced an X API v1.1 `statuses/show` provider with a Bearer-token
requirement (HEAD `381274173b4375fe603ce1983e4e071815173997`) is **quarantined**:
not a successor, not a base, never to be deployed.

A known documentation gap is recorded, not hidden: the pinned acquisition
profile freezes the locator and redirect law but does not restate the public
syndication endpoint in its own normative text. A correction candidate,
`berm.acquisition.x-public-syndication/1`
(`sha256:f0e98475445bc90e656e054f4a0b9f4ca2d16a0708855b929fe1cc4c8d72e70c`),
exists and is **not pinned**. These documents describe no endpoint details beyond
what pinned bytes state.

## Canonical repository URL

The canonical public GitHub URL for these documents is not asserted here.
It is configured at publication time.
