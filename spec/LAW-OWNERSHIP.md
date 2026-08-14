# Law ownership map

**The rule this document exists to enforce:**

> **One law, one owning repository, one frozen vector set.**
> Every other implementation is a *cross-check* that must produce byte-identical
> output against those vectors, or it is a fork pretending to be a verifier.

GPT's ship-readiness map separates three proof planes — protocol law,
deployed-instance truth, product readiness — and that separation is right. What no
document currently states is **which repository owns which law.** Two lineages
have been implementing overlapping laws in parallel, and the cost of leaving that
unstated has already been paid once. See §3.

---

## 1. Why this matters more here than in most projects

The campaign explorer's entire value is *independent* recomputation. That value is
destroyed in both directions:

- if the explorer **imports** the production implementation, it reproduces
  production bugs and reports `REPRODUCED` — a checksum of the deployment, not a
  check of the law;
- if the explorer **reimplements** the law without a shared frozen vector set, it
  can disagree with production and neither side can say which one is wrong.

The only stable arrangement is **shared vectors, independent code**. That requires
naming the owner, because vectors are only authoritative if someone owns them.

---

## 2. Ownership table

`berm` = `berm-protocol/berm` (this repository) · `bermlaunch` = the BermLaunch
implementation lane.

| Law | Owner | Frozen vectors | Import direction | State |
|---|---|---|---|---|
| **Identity derivation** — npub → EVM, BIP-340 parity normalisation | **berm** | `bags/vectors/pocket-address.json`, `crypto/vectors/test-vectors.json`, pinned by `scripts/check-vectors-frozen.mjs` | bermlaunch imports | **Settled.** 300/300, both parity branches, externally anchored |
| **Nostr event signing / verification** — BIP-340, event id | **berm** | `crypto/vectors/`, plus 15 official vectors in `wordpress/` | bermlaunch imports | **Settled** |
| **Signer transport** — NIP-07, NIP-46, capability detection | **berm** | `sdk/test/sdk.test.ts` (34/34) | bermlaunch imports | **Settled, and currently duplicated by omission** — GPT's SIG-05 reads `OPEN`; both backends are built and tested here |
| **Handle claim, continuity, dispute** | **berm** | `bags/src/continuity.ts`, `dispute.ts`, `explorer/` | bermlaunch links, does not reimplement | **Settled** |
| **Supply-chain and build guards** | **berm** | `scripts/check-supply-chain.mjs`, `check-package-graph.mjs`, `check-ci.mjs` | bermlaunch adopts | **Settled** |
| **Portable-verifier pattern** — self-contained, no external origins | **berm** | `explorer/build.mjs`, `graph/build.mjs` throw on violation | bermlaunch adopts | **Settled** |
| **Enrollment wire contract** — control-proof preimage | **bermlaunch** | ⚠ **none frozen** | berm must re-derive | **DIVERGENT — see §3** |
| **Observation receipts, ordering, cutoff** | **bermlaunch** | ⚠ none frozen | berm has no implementation | Owner clear, vectors missing |
| **Roster / Merkle / economic law** | **bermlaunch** | ⚠ none frozen | berm's `merkle.ts` is Solana-era, superseded | Owner clear, vectors missing |
| **Campaign Constitution V2** | **bermlaunch** | `campaign-constitution.v2.canonical.json`, 1,862 bytes, `0xbaef1dbf…995a` | berm reads only | **Settled** |
| **Distributor / Controller contracts** | **bermlaunch** | ⚠ none frozen | berm reads only | Owner clear, vectors missing |
| **Bags integration surface** — claimer cap, case-mangling | **berm** | `bags/src/bags.ts`, `bags/test/spec.test.ts` | bermlaunch imports | **Settled** |

---

## 3. The divergence that is already real

**Two incompatible enrollment control-proof preimages exist, both active, both
calling themselves v2/R2.**

`berm/bags/src/enrollment.ts` — five fixed fields, newline-joined:

```
berm.enroll.v2\n<campaign>\n<mode>\n<npubHex>\n<evmAddress>
```

`bermlaunch/packages/sdk/src/enrollmentProtocol.js` — header plus canonical JSON
of the whole payload:

```
BermLaunch Supporter Enrollment R2\nEVM destination proof over exact canonical enrollment bytes.\n<canonicalJson(payload)>
```

Executed against identical inputs, the two messages are **not equal**. Therefore:

> **A signature valid under one is invalid under the other.**

This is not a style difference. It is two wire contracts with the same name, and
an enrollment signed against the wrong one is simply rejected — with an error that
will read as a user problem rather than a governance problem.

### Ruling

**`bermlaunch` owns the enrollment wire contract.** It binds every payload field
rather than five, it carries `broker` / `backup_required` / `backup_commitment`,
it is the path wired to observation receipts and the roster compiler, and it is
the one under active adjudication (BR-14).

**`berm/bags/src/enrollment.ts` is therefore, today, a second incompatible
implementation of a law it does not own.** Two honest resolutions, no third:

1. **Quarantine it** — mark superseded, exclude from the published surface, the
   way `crypto/src/quarantine` already handles v1.
2. **Promote it to the independent cross-check** the explorer needs — which
   requires re-deriving it to the canonical preimage and proving byte-identical
   output over frozen vectors.

(2) is worth more, because it is the only way to get a real independent verifier.
But it is only worth anything **after** the vectors exist. Until then it is a
liability that looks like an asset.

---

## 4. The gap underneath all of this

Six laws are settled with frozen, hash-pinned vectors. **Four of the five laws
`bermlaunch` owns have no frozen vectors at all** — enrollment preimage,
observation receipts, roster/Merkle, contracts.

That is the actual reason the divergence in §3 went unnoticed: there was nothing
to compare against. `scripts/check-vectors-frozen.mjs` already does this job for
the laws `berm` owns, and it is the machinery GPT's **AUTH-04** marks as
`scaffold: ABSENT`. It is not absent — it is built, enforced on every push, and
waiting to be pointed at four more laws.

**Freezing those four vector sets is the single highest-leverage engineering task
on the board**, because it is the precondition for: AUTH-04, the explorer's
independence (E-08), any second implementation being safe, and detecting the next
§3 before it reaches a user.

---

## 5. Standing rules

1. A law has exactly one owner. Changing the owner is a founder decision, recorded
   here.
2. A law is not owned until its vectors are **frozen and hash-pinned**. An owner
   without vectors is a claim, not a control.
3. A second implementation is legitimate **only** as a cross-check proving
   byte-identical output over the owner's vectors. Any other second implementation
   is a fork.
4. Cross-repo disagreement is resolved by the vectors, never by seniority, recency
   or which reviewer is louder.
5. When the two disagree and the vectors are silent, **both are wrong** — the
   missing vector is the defect.
