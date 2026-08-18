# BermLaunch — frozen functional scope

**Status: FROZEN at v1. Founder authority.**

Scope is not owned by an implementation. `spec/LAW-OWNERSHIP.md` assigns the
*laws* — the enrollment wire contract, the roster law, the contracts — to the
BermLaunch lane. **This document assigns something different: what the product is
required to do, and what it is required not to do.** That is the founder's, it
constrains both repositories, and it changes only by an explicit revision here.

## Why this exists

Every artefact we have describes readiness (`CANARY-READINESS.md`), defects (the
pack reviews), or release engineering (GPT's 45-module map). **None of them state
scope.** Without a frozen scope, every finding is arguable and every review can
grow, because there is nothing to measure "in scope" against.

Two consequences, both intended:

1. **A finding about something in §16 is not a blocker.** It is closed by
   reference, not by debate.
2. **A capability not listed here is not missing.** It is *absent by decision*,
   and adding it requires a revision to this file rather than an implementation.

Component IDs are stable. Cite them.

---

## Frozen anchors

| | |
|---|---|
| Constitution | `campaign-constitution.v2.canonical.json`, 1,862 bytes, SHA-256 `0xbaef1dbfcc212379f9e66addf474c5cba1f48547783c64db97be66bb44e4995a` |
| Protocol version | `supporter_enrollment_r2_campaign_authority_lifecycle_r1` |
| Economics | `BERM_STANDARD` — community **6000 bps**, creator **4000 bps**, `mutable_after_launch: NO` |
| Cohorts | `PRELAUNCH` 50 · `GRADUATION` 100 · `FOMO` 300 — cumulative ranges 0–2000, 2000–4000, 4000–6000 bps |
| Chain | Robinhood. Solana is **not in v1 scope** — §16 |
| Deployment binding | `DISTRIBUTOR_SELF_ANCHOR` v1 |

---

# Part A — the creator's product

## BL-01 · Campaign constitution

**Does.** Fixes, before anything launches: cohort sizes and their cumulative bps
ranges, the economic preset, the observer policy and its hash, the chain and
domain, the enrollment verifier path, the roster and receipt schemas.

**Authority.** Founder, at authoring time. **Immutable thereafter** — the
Distributor commits its hash on deployment.

**Must fail.** Zero constitution hash at deployment · a constitution whose
declared `observer_policy_hash` disagrees with its contents · a local registry
attempting to override the on-chain commitment · a wrong-campaign constitution.

**Not in scope.** Editing a constitution after deployment. There is no such
operation and there will not be one.

## BL-02 · Token launch

**Does.** Creates the Bags token and binds the Distributor **in the same
transaction**, so any failed invariant reverts the entire launch.

**Authority.** The Atomic Launch Controller. **Controller-only, by ruling** —
permissionless binding would let an attacker pre-bind the Distributor to their own
otherwise-valid token and permanently brick it with `AlreadyBound`.

**Not in scope.** Launching without Bags. Multi-chain launch. Re-launching a
campaign.

## BL-03 · Distributor binding — `bindLaunch(token, feeShare)`

**Does.** Verifies and records the upstream state: the fee share names **this
Distributor as sole claimer at 10000 bps**, the token exists with a curve and
pool, WETH/hook/pool/curve all match, no authority collision, beacon and
implementation non-zero. Then snapshots the Bags authority and sets `launchBound`.

**Authority.** `launchBinder` only. **One-shot** — no unbind, no rebind, verified:
zero such paths exist.

**Must fail.** `Unauthorized` · `AlreadyBound` · `ZeroAddress` ·
`InvalidLaunchBinding` for any of: unrelated fee-share owner, wrong or multiple
claimers, wrong bps, wrong WETH/hook/pool/curve, adapter rejecting the pool.

**Not in scope.** Changing the bound token later. Binding to a token not created
by the Controller.

## BL-04 · Creator residual — `claimResidual()`

**Does.** Lets the creator draw their 4000 bps share.

**Not in scope.** Drawing against the community's 6000 bps, under any condition,
including an unfilled cohort. Cohort shortfall is **not** creator upside — §16.

---

# Part B — the supporter's product

## BL-05 · Enrollment

**Does.** A supporter signs one event binding: campaign · execution mode · npub ·
EVM destination · proof of control of that destination. Two doors — an existing
signer short-circuits; everyone else generates a key and takes the portable
encrypted file (`ENROLLMENT-SPEC.md` Revision 3).

**Authority.** The supporter. Nobody else, ever.

**Must fail.** Missing or unknown mode · missing address · missing or malformed
proof · a proof recovering to a different address · a proof made for another mode
or campaign · duplicate critical tags · **any address entering a roster without
proof of control.**

**Not in scope.** Enrolling on someone's behalf. Importing an address list.
Admin-assigned membership. *(This is the `legacy_roster_wallet_v0` class and it is
permanently out of scope, not merely fixed.)*

## BL-06 · Observation and ordering

**Does.** Establishes which enrollment is canonical when a supporter rebinds,
using signed observation receipts from an observer named in the constitution, with
a per-cohort finalization cutoff.

**Must fail.** A caller-supplied observation accepted without receipt
verification · an empty or absent observer policy treated as permissive · a
receipt signed outside the policy · a receipt whose id is accepted rather than
recomputed · an observation after the cutoff · **ordering by any self-reported
timestamp.**

**Disclosed cost.** The observer is a trusted party. It belongs in
`SOVEREIGNTY.md` at the same rank as the Bags rows.

**Not in scope.** Rebinding after finalization. The destination is inside the leaf.

## BL-07 · Cohort snapshot and roster

**Does.** Membership from published snapshots — batch 1 is the first snapshot,
batch 2 is the second minus the first. Compiles verified enrollments into a
canonical roster with cumulative weight ranges that sum to exactly the whole.

**Must fail.** A member with no verified enrollment reaching a production roster ·
a roster compiled from normalized caller objects rather than raw evidence · dust
or a rounding remainder.

**Not in scope.** Backdating membership. Manual roster edits. Guaranteed cohort
fill — an under-filled cohort is a smaller cohort, §16.

## BL-08 · Finalization and seal

**Does.** `finalizeCohortRoot(cohortId, root, evidenceManifestHash)` publishes one
root per cohort with non-zero evidence hashes. `sealRoots()` **permanently retires
the finalizer.**

**Authority.** `rootFinalizer` — a **temporary, disclosed** authority that exists
because GRADUATION and FOMO members cannot exist before they do. It cannot move
money, change economics, or alter a root already set.

**Must fail.** `RootAlreadySet` · `RootsAlreadySealed` · `InvalidCohort` · zero
evidence hash · a root whose evidence manifest does not bind the constitution hash.

**Not in scope.** Replacing a finalized root. Unsealing.

## BL-09 · Fee intake — `harvest()`, `syncExternalDeposit()`

**Does.** Pulls fees from the Bags fee share and accounts for direct transfers, so
value that arrives outside the expected path is still credited rather than stranded.

**Authority.** Permissionless — anyone may trigger. There is no privileged caller.

**Not in scope.** Anyone withdrawing on a supporter's behalf. Any sweep. Any
expiry. Any admin path to value that has reached the contract.

## BL-10 · Graduation — `activateGraduation()`

**Does.** Verifies graduation against on-chain state and opens the buyback gate.

**Must fail.** `NotGraduated` when the verified state does not support it.

## BL-11 · Buyback claim — `claimBuyback(...)`

**Does.** A supporter proves membership with a Merkle proof and converts their
accumulated entitlement into the launched token via a fixed route, with slippage
and deadline protection.

**Authority.** The supporter, with their own EVM key. **No account, no approval,
and no requirement that our website is reachable.**

**Must fail.** `InvalidProof` · `RootNotSet` · `RootsNotSealed` ·
`IdentityCollision` · `NothingToClaim` · `BelowMinimumClaim` · `DeadlineExpired` ·
`SlippageExceeded` · `ReentrantCall` · a failed swap must roll back atomically.

**Not in scope.** A claim window. A deadline on entitlement. Any route other than
the committed one.

---

# Part C — the public surface

## BL-12 · Trust & Verify

**Does.** Publishes the campaign's disclosure: constitution hash, roots, evidence
manifests, cutoffs, economics, the Bags upstream authority snapshot, and per-member
evidence status.

**Authority boundary.** **Publisher and disclosure only.** It does not emit an
independent recomputation verdict — only BL-13 may.

**Must fail.** Any affirmative status rendered from missing, partial, mock or
asserted evidence. Absence renders as `UNVERIFIED`, visibly and loudly.

## BL-13 · Campaign explorer

**Does.** Independently rebuilds the roster and root from published evidence and
reports four orthogonal verdicts: root recomputation · destination-proof coverage ·
per-member binding status · finalizable-under-current-law.

**Must fail.** A reproduced root implying proven destination control ·
`INSUFFICIENT` rendered as a pass · importing the production verifier as its engine
rather than cross-testing against frozen vectors.

**Not in scope.** Any write path. Any key. Being a source of truth.

## BL-14 · The supporter's post

**Does.** A signed card showing cohort, slot, share and a verify link. Publishing
to Nostr is a signature; opening the X composer is an intent, and the two are never
conflated.

**Not in scope.** Claiming X delivery. Posting on the user's behalf.

---

# §16 · Explicitly out of scope for v1

**A finding about anything below is not a blocker. Close it by citing this
section.**

```
Solana implementation                    Robinhood only in v1
multi-chain campaigns                    one chain per campaign
editing a constitution after deploy      no such operation exists
replacing or unsealing a root            no such operation exists
changing the bound token                 one-shot by design
admin-assigned or imported membership    every address needs a control proof
creator drawing community bps            shortfall is not creator upside
a claim window, sweep, or expiry         entitlement is permanent
KOL / moderator / time-expiring leaves   roadmap, ruled at E-11
creator-discretionary sub-splits         roadmap
ratings, reviews, subjective attestation roadmap
guaranteed cohort fill                   an unfilled cohort is a smaller cohort
reach, distribution, or promotion        X decides who sees what
recovering a lost key                    stated plainly in recovery/
passkey tier at launch                   deferred, ENROLLMENT-SPEC §1.3
third-party API key issuance             broker commercial layer, post-launch
```

---

# §17 · The four invariants

If a change breaks one of these it is out of scope regardless of merit.

1. **No address enters a payout list without proof of control.**
2. **Nothing renders as verified that was not verified.** Absence is `UNVERIFIED`.
3. **Entitlement does not expire and cannot be swept.**
4. **Claiming never requires our website, our account, or our permission.**

---

# §18 · Revising this document

Scope changes by editing this file and incrementing the version, with the reason
recorded. It does not change by an implementation adding a capability, a review
finding an omission, or a conversation reaching a conclusion.

**A capability that appears in code but not here is out of scope and must be
removed or added here first.** That rule is the entire point.
