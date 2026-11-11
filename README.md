# Berm Protocol

> **Use the platforms. Keep the identity and relationships you build around them.**

Berm Protocol is an application-neutral public verification layer for portable
identity and verifiable relationships.

Today, the concrete public method binds an X account to a user-controlled Nostr
identity (`npub`) using a public proof, deterministic verification rules, signed
validator observations, and application acceptance policy.

The X account is a relationship attached to the identity. It is **not** the
identity root.

That distinction is the point.

## Verify the current method locally

See the [standalone developer quickstart](sdk/external-binding-v2/README.md).
It includes exact method/specification bytes, 97 reference vectors and a complete
signed offline example using the accepted verifier. No private BermLaunch
checkout, wallet, network or production credentials are required.

```sh
node sdk/external-binding-v2/verify.mjs
node --test sdk/external-binding-v2/test.mjs
node sdk/external-binding-v2/example.mjs
```

The example proves local verification and portable evidence, not public validator
operation. Installing a verifier does not create operator standing or authorize
publication. Xonly hosts the separately reviewed browser-signing integration.

## Recover your identity with BRM

The **Berm Recovery Module (BRM)** is an encrypted, user-owned `.brm` file.
With its password it restores the same Berm/Nostr identity and the same default
EVM destination from one secp256k1 root. Public X evidence and application state
remain separate. Read the [BRM 0.1 recovery profile](recovery/brm-0.1/PROFILE.md)
and [recovery guide](docs/content/recovery.md). This documents the existing file
contract; it does not change the current X `/2` method or add a new user step.

## Why “Berm”?

In fortification, a berm is the strip of ground at the edge of a wall: close
enough to the fortress to matter, but outside it enough to remain its own ground.

Online platforms are enormously useful fortresses. They provide distribution,
audience, conversation and discovery. But if the platform account itself is the
identity, the platform also becomes the custodian of the relationship between a
person and every application built on top of it.

Berm reverses that dependency.

Use the platform. Prove the relationship publicly. Keep the portable identity
outside the platform.

**[Read “Why Berm?” →](docs/WHY_BERM.md)**

## The model in one line

```text
portable npub
  → public proof
  → deterministic Berm method
  → signed observations and evidence
  → application policy
  → portable verified relationship
```

An application may disappear. A frontend may change. A social account may be
renamed or later become inaccessible. The signed evidence and the portable
identity do not have to become private database rows that only one company can
interpret.

## What Berm does today

For the current X method:

1. A person controls an `npub`.
2. The person publishes the required proof from an X account.
3. A validator independently reads the public X publication.
4. The public method derives one canonical six-field binding.
5. The subject signs the claim; validators sign observations.
6. An application applies an explicit acceptance policy.
7. The resulting evidence can be carried, mirrored and independently checked.

The permanent identity law is asymmetric:

```text
(namespace, immutable accountId) → at most one npub
npub                             → zero, one, or many external accounts
```

A mutable handle is display metadata. The immutable platform account identifier
is the uniqueness key.

## Current standard

| | |
|---|---|
| Protocol predecessor / authority lineage | **R13-A REISSUE R4** |
| Current pinned method-successor implementation checkpoint | **R8** |
| Current X method | **`berm.external_account_binding.x/2`** |
| Method hash | `sha256:a95319d8664b16ca355b3d82bc8c4d5bb6007c8aed65116a74447f79b0e5e193` |
| Normative vector count | **97** |
| Vector set hash | `sha256:0ced853da13b3378b4e138883398ecd7831e27b00c2f03ee759af9668a45e6c5` |
| Observation window | `0 <= observedAt - postCreatedAt < 300000 ms` |

**R8 is not “Berm Protocol v8.”** It is the implementation-lane label for the
current X-method successor.

Read the exact current identities, hashes and standing in
[CURRENT_STANDARD.md](docs/CURRENT_STANDARD.md) and
[CURRENT_STANDARD.json](CURRENT_STANDARD.json).

## Protocol, implementation, application

These roles are intentionally separate.

### Berm Protocol

Defines the public language: methods, evidence shapes, verification rules,
validator observations and application-policy boundaries.

### xonly.ai

A practical Berm implementation and user-facing identity/signing surface. It is
not the source of Berm identity authority.

### BermLaunch

The first economic application using Berm identity/evidence. BermLaunch applies
campaign-specific rules after identity evidence has been accepted. It does not
turn a campaign position, wallet, cohort or token fact into part of the portable
X-account binding.

This separation is what lets a community or relationship survive beyond one
frontend, one application, or eventually one platform.

## Read the protocol

| Page | What it explains |
|---|---|
| [Why Berm?](docs/WHY_BERM.md) | the idea, the boundary metaphor, and why portability matters |
| [Current Standard](docs/CURRENT_STANDARD.md) | exact current method, hashes, lineage and standing |
| [Identity Model](docs/IDENTITY_MODEL.md) | `npub` root, external accounts and cardinality |
| [X Verification](docs/X_VERIFICATION.md) | proof line, five-minute law and six-field result |
| [Validators & Federation](docs/VALIDATORS_AND_FEDERATION.md) | methods, validators, operators and honest independence |
| [Evidence & Receipts](docs/EVIDENCE_AND_RECEIPTS.md) | who signs what |
| [Application Policies](docs/APPLICATION_POLICIES.md) | how applications decide which evidence they accept |
| [Portability & Reconstruction](docs/PORTABILITY_AND_RECONSTRUCTION.md) | how a third party rebuilds a verdict |
| [Methods & Versioning](docs/METHODS_AND_VERSIONING.md) | method identity and supersession |
| [Technical Reference](docs/TECHNICAL_REFERENCE.md) | exact anchors and implementation references |

## What Berm is not

Berm is not:

- a hosted identity court;
- an OAuth dependency disguised as sovereignty;
- a claim that X, Reddit, Telegram, every wallet and every chain are already
  supported today;
- a claim that two validator machines controlled by one operator are two
  independent organizations;
- a replacement for application-specific rules.

Each new external platform or proof type needs its own published method and
deterministic verifier.

## Historical repository content

This repository preserves earlier Berm experiments and implementation work for
provenance.

**Do not assume an older directory or README-era implementation is the current
protocol standard merely because it remains in Git history or in the working
tree.**

The active public documentation is the Current Standard and the pages linked
above. Exact hashes and explicit standing decide what is current.

## BermLaunch and the Canary

BermLaunch is where this abstraction becomes visible to ordinary users.

A supporter can have one portable identity, prove an external account
relationship, join a campaign under public rules, and keep evidence of that
relationship without making the launchpad or the social platform the permanent
owner of the identity.

**Canary on a Berm** is the first BermLaunch campaign intended to exercise that
idea in a real economic application.

It is an application of Berm Protocol, not a new definition of Berm Protocol.
