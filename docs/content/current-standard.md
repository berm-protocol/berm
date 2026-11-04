---
d: docs/current-standard
title: Current standard
summary: The current pinned X method, authority lineage, identity law and authorization boundary.
nav: 11
x_article: none
---

# Current standard

Machine-readable form: [CURRENT_STANDARD.json](https://github.com/berm-protocol/berm/blob/main/CURRENT_STANDARD.json). Both are
a **documentation projection** of founder-pinned artifacts. They create no new
method, hash or version, and they do not authorize deployment, genesis, live X
activity, publication or release.

## Two roles — do not flatten them

### Protocol predecessor / authority lineage — R13-A REISSUE R4

| | |
|---|---|
| Artifact | `OPUS_BERM_PROTOCOL_R13_A_REISSUE_R4_DETERMINISTIC_PUBLIC_LANGUAGE_CANDIDATE_R5_20260828.zip` |
| SHA-256 | `d47176e2e0d6809b768404c25f069103ac4c4a1bda6f70d9528544e9251784ff` |
| Bytes | 384638 |
| Standing | `FOUNDER_PINNED_R13_A_REISSUE_R4_PROTOCOL_AUTHORITY` |

The filename still says `CANDIDATE_R5`. The external founder pin controls
standing and changed no bytes. R4 carried the X method
`berm.external_account_binding.x/1`; that method is **historical** and is no
longer the current X method.

### Current method-successor implementation checkpoint — R8

| | |
|---|---|
| Current X method | `berm.external_account_binding.x/2` |
| Method hash | `sha256:a95319d8664b16ca355b3d82bc8c4d5bb6007c8aed65116a74447f79b0e5e193` |
| Vector set hash | `sha256:0ced853da13b3378b4e138883398ecd7831e27b00c2f03ee759af9668a45e6c5` |
| Vector count | 97 (the frozen 89-vector corpus regenerated, plus eight R8 successor cases) |
| Immutable R8 anchor | `CODEX_BERM_METHOD_SUCCESSOR_HANDLE_BOUND_PROOF_LINE_R8.zip`, SHA-256 `50c8d54d41fb5395c166c02704b129f14082a69acddef34ba7b5a9a19d233a25` |
| Founder pin | `R8_DUAL_REPOSITORY_CORRECTED_IMPLEMENTATION_FOUNDER_PIN_R1_20260905.zip`, SHA-256 `fef6c8fa131fc00caa048f2a1fde255b09070bfe3c3d70dfb0fef39138dbf8de` |
| Standing | `FOUNDER_ACCEPTED_AND_PINNED__R8_DUAL_REPOSITORY_CORRECTED_IMPLEMENTATION_CHECKPOINT` |

**R8 is not "Berm Protocol v8".** It is the label of the implementation lane
that produced the current method successor. The pin is an implementation
checkpoint only: it does not authorize deployment, genesis or live X.

## Intake and transport

| | Identity | Hash |
|---|---|---|
| Acquisition (intake) | `berm.acquisition.x-direct-status/1` | `sha256:46fbed235696decc92e298e55e3a4ee1ebd5e61d169cd3462265cb3ff5c98f1d` |
| Transport | `berm.transport.x-syndication-via-same-origin-proxy/2` | bridge SHA-256 `7e208b3b192f1d2d3caa503a6d3b54fac1c8c533dba9ce1d1c11464a9dce11bf` |

Validators independently acquire the publicly served X publication.
Verification does not depend on user OAuth, private cookies, developer
credentials, or BermLaunch holding privileged X credentials.

## Producer side

| | Identity | Hash |
|---|---|---|
| Producer law | `berm.composer_producer_law/2` | `sha256:ed9e25056cbdec7d14fa568a731513eef5255c5febed061573afee4db1143aaa` |
| BermLaunch composer profile | `bermlaunch.composer.support-v1/2` | `sha256:0db5286615d9c822a6d721a697cf5f5a43162b51175010b1efe44c4936188b19` |

The recorded support composer status is
`ACTIVATION_PENDING_ONE_REAL_X_COMPOSER_SMOKE`. The November 4 installed-source
check retains that exact status; the successful cohort-card renderer deployment
is not evidence of a real X composer smoke. Application community cards and
support text profiles are separate from this generic identity method. The
September 26 `CURRENT_STANDARD.json` remains the historical documentation
projection, not a current deployment-status API.

## Identity law

- Portable root: `npub`.
- Positive X binding: exactly six fields — `npub`, `accountId`, `handle`,
  `postId`, `textHash`, `methodHash`.
- Observation window: `0 <= observedAt - postCreatedAt < 300000 ms`
  (lower bound inclusive, upper bound exclusive). There is no mandatory
  second observation and no one-hour finality requirement.
- `(namespace, accountId) -> at most one npub` — permanently.
- `npub -> zero, one, or many external accounts`.
- BermLaunch separately enforces `(campaignId, npub) -> at most one campaign position`.

## Not current

| Identity | Standing |
|---|---|
| `berm.external_account_binding.x/1` | historical R4 method; superseded as current by `/2` |
| `berm.acquisition.x-public-syndication/1` (`sha256:f0e98475…d72e70c`) | founder-directed correction candidate; **not pinned**, not current |
| privileged X API `statuses/show` with a Bearer token | **quarantined, rejected design**; never a base, never a successor |

## Authorization boundary

```text
deployment        NOT AUTHORIZED
genesis           NOT AUTHORIZED
live X            NOT AUTHORIZED
publication       NOT AUTHORIZED
release / tag     NOT AUTHORIZED
```

These are the authority boundaries of that historical protocol-documentation
checkpoint. They do not reverse later separately approved BermLaunch deployments.
This documentation alignment candidate grants none of those live effects.

