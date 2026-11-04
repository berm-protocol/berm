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

The standalone developer home is `sdk/external-binding-v2/`, documented in its
[README](../sdk/external-binding-v2/README.md). It consumes exact accepted source
mirrors, not a second parser or a newly edited normative specification.

| Path | Contents |
|---|---|
| `spec/external-binding-v2/SOURCE_MANIFEST.json` | Complete byte hashes, upstream paths and source identities for all mirrored artifacts |
| `spec/external-binding-v2/authority/method/spec/METHODSPEC_CANONICAL.md` | Exact current `/2` method document |
| `spec/external-binding-v2/authority/method/spec/ACQUISITION_PROFILE.md` | Exact frozen acquisition document, recovered from the authenticated BermLaunch source |
| `spec/external-binding-v2/authority/wire/EVIDENCE_FOLD.md` | Exact evidence-fold law |
| `spec/external-binding-v2/schemas/` | Original wire schemas |
| `spec/external-binding-v2/vectors/` | All 97 exact normative vectors |
| `sdk/external-binding-v2/runtime/` | Byte-identical accepted BermLaunch verification closure; no production server or signer |
| `sdk/external-binding-v2/example.mjs` | Disposable signed offline example with actual evidence fold and file export/readback |

Historical files that say `CANDIDATE` retain those exact bytes. The separate
founder acceptance recorded in [CURRENT_STANDARD.md](CURRENT_STANDARD.md) does
not rewrite their historical provenance. The R8 label is an implementation
checkpoint, not a newly numbered protocol. Normative files and runtime mirrors
are protected from Git line-ending conversion and checked byte-for-byte.

The immutable R8 anchor, R8 founder-pin ZIP and transport bridge ZIP are external
historical artifacts. Their recorded hashes do not imply those ZIPs are included.

## Verify locally

Run from the repository root with Node 22.6 or newer. These three commands need
no npm packages, private work-order files, credentials or network access:

```text
node sdk/external-binding-v2/verify.mjs
node --test sdk/external-binding-v2/test.mjs
node sdk/external-binding-v2/example.mjs
```

The first checks every mirrored hash, the exact method/acquisition identities and
all 97 vectors. The second executes signed positive/tamper cases and temporary
file export/readback. The third prints the precise disposable-example standing.
To retain an export, supply a new destination to `example.mjs`; existing evidence
files are never overwritten. An export's policy must be independently selected
by its consumer, not trusted because it has a self-consistent signature.

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
exists and is **not pinned**. The existing transport implementation separately fixes anonymous HTTPS
`cdn.syndication.twimg.com/tweet-result`, the requested post ID, `lang=en`,
`token=x`, `Accept: application/json`, User-Agent `berm-validator/1`, zero
redirects and a 32,768-byte body ceiling. This describes implemented transport;
it does not amend the frozen acquisition text or promise X availability.

## Canonical repository URL

The repository is [berm-protocol/berm](https://github.com/berm-protocol/berm).
This candidate has not been published; a local build does not establish what
GitHub Pages or Xonly currently serves.
