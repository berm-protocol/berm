<!-- STATUS: HISTORICAL_SPEC / SOLANA / HOLD / NOT_IMPLEMENTABLE_AS_WRITTEN -->

> # ⚠ HISTORICAL — EVIDENCE ONLY, NOT CURRENT AUTHORITY
>
> `HISTORICAL_SPEC / SOLANA / HOLD / NOT_IMPLEMENTABLE_AS_WRITTEN`
>
> A Solana distributor design that returned HOLD from adversarial review with five open CRITICAL findings. No Solana work is in scope. Retained for the findings, not the design.
>
> Must not participate in current authority resolution.

# Berm Distributor — specification for review

> ## ⚠ R1 REVIEW: HOLD — DO NOT IMPLEMENT FROM THIS DOCUMENT
>
> An adversarial review (`BERM_DISTRIBUTOR_SPEC_REVIEW_20260803_R1`, subject
> SHA-256 `89861239…bafb44fe`) returned **5 CRITICAL, 3 HIGH, 4 MEDIUM, 1 LOW**.
> The design below does **not** yet deliver its own headline guarantee. Sections
> 2–8 are retained unedited as the reviewed artifact; **§0 below supersedes them.**
>
> The review did its job: these defects cost a document to fix and would have
> cost an unpatchable program holding other people's money.

## 0. R1 findings — what is wrong with everything below

### The one that breaks the architecture

**BDR-001 (CRITICAL). The Harvester cannot sign for the Distributor's PDA.**
PDA signing is program-ID-bound — only the program whose ID derived a PDA may
`invoke_signed` for it. §2 puts `VaultAuthority` under the immutable Distributor
and then has the upgradeable Harvester sign for it. **That is not implementable.**

Moving the PDA to the Harvester makes the upgradeable program custodial. A
Distributor that signs Harvester-supplied instructions is a signing oracle. So the
elegant split in §2 is simply wrong, and the honest replacement is worse to live
with: **the immutable Distributor performs the exact Bags CPI itself**, and a
changed Bags interface means deploying a new immutable version for new campaigns.
The coupling I tried to quarantine lives in the immutable half after all.

### The one nobody had thought about

**BDR-002 (CRITICAL). The dev can redirect the fees afterwards.**
Bags V2 exposes `manager_update_fee_config` (changes claimers and BPS) and
`manager_waive_fee_config` (sets manager to `Pubkey::default`). A dev who names
the PDA as claimer and **keeps the manager role** can replace or dilute it later.

The entire guarantee — *the dev cannot redirect revenue* — was never established.
§1's off-chain "check the config names our PDA" is a snapshot of a mutable fact.
**Manager waiver has to be a launch gate**, and the campaign must bind
`fee_share_config`, `claimer_index`, `expected_bps` and the waived state.

### The rest of the CRITICALs

| | |
|---|---|
| **BDR-003** | The lifecycle is one-shot — fixed `total`, one-time bitmap — while the input is *continuing* fee revenue. Fees arriving after the last claim have no entitlement and are stranded. Pick sealed epochs **or** cumulative weights; the hybrid is undefined. |
| **BDR-004** | `sweep()` confiscates valid unclaimed leaves. §2 says "no sweep" and §4 defines one — a flat self-contradiction — and after the deadline the first caller can permanently exclude a legitimate claimant. A sweep may move only `max(balance − outstanding_liability, 0)`. |
| **BDR-005** | `PDA["campaign", campaign_id]` plus permissionless init means a stranger front-runs a known id with a garbage root and occupies the address forever. Content-address the seed, or authenticate initialization once with no continuing authority. |

### HIGH

- **BDR-006** — reading the token account's *owner* is not enough: the token program, mint, initialized state and ATA-vs-arbitrary question are all unpinned. Token-2022 substitution is live.
- **BDR-007** — the root commits leaves but **not their sum**, so `total` is an unproven independent input. A root whose leaves exceed `total` makes claims order-dependent. Merkle-sum tree, or stop calling the aggregate cryptographically proven.
- **BDR-008** — checked arithmetic, counter bounds, underfunded-vault behaviour, bitmap layout and error precedence are all prose, not contract.

### Fixed in the reference implementation

These were found in shipped TypeScript, not just in this document.

| | Was | Now |
|---|---|---|
| **BDR-013b** | Equal `claimedAt` let *relay arrival order* pick the payout address — **two honest parties could publish different roots from identical data.** The core reproducibility claim, broken. | Ties break on the address: a total order over the data itself. |
| **BDR-009** | The "independent" comparator used `localeCompare('en')` while production used code-unit order. Every differential fixture was ASCII, so the test proved agreement exactly where agreement was never in doubt. | Bytewise in both, plus mixed-case, diacritic, non-Latin and shared-prefix fixtures — and an assertion that those fixtures still separate the two comparators. |
| **BDR-011** | `reconcile()` diffed npub membership only. Change an address and the root moves while both named sets stay empty: a mismatch announced and nothing pointed at. | Diffs canonical records; reports `changed` per field; when nothing it compares differs, says so and names what to check instead. |
| **BDR-010** | `verifyProof` folded proofs of any length. | Capped at `MAX_PROOF_DEPTH = 14`. Bounding, not a forgery fix — stated as such. |
| **BDR-013a/c** | Tree built twice; a snapshot that *lost* members was accepted silently. | Built once; non-superset snapshots refused. |

### Post-R1: what the IDL settles, and one thing it makes worse

The review only had this document. Re-reading the Bags Fee Share V2 IDL against
its findings resolves two of them, hardens a third, and surfaces a limit that no
amount of care on our side removes.

**Q7 is answered: yes, a PDA can be a claimer.** Claimers are plain pubkeys held
in `FeeShareConfig.claimers`, supplied as accounts at `create_fee_config` and
**never signers at registration**. `claim_user`'s own doc for `user` reads *"the
claiming user; must match `claimers[idx]`"* — matching an array entry, not
producing a keypair. Nothing about being off-curve disqualifies an address from
receiving.

**That does not rescue §2, and BDR-001 stands.** `claim_user` marks `user` as
`SIGNER`, and a PDA produces that signature only through `invoke_signed` by the
program that derived it. Naming a PDA as claimer and *claiming as* that PDA are
different problems. The published finding — `payer` and `user` are separate
signers, so the caller need not be the claimer — is correct and unchanged; the
error was putting the CPI in the Harvester while the seeds lived in the
Distributor. An architecture mistake, not a wrong fact about Bags.

**BDR-002's fix is enforceable on-chain, which is better than R1 assumed.**
`manager` is a field on `FeeShareConfig` and `manager_waive_fee_config` sets it to
`Pubkey::default()`. So the waiver is not an off-chain snapshot to be re-checked
hopefully — the Distributor can require `fee_share_config.manager ==
Pubkey::default()` as an **account constraint at campaign init** and refuse to
exist otherwise.

**A second, accidental protection:** errors `CannotRemoveClaimerWithFees` (6016)
and `CannotChangeClaimerIndexWithFees` (6017) mean a claimer holding an unclaimed
balance cannot be removed or reindexed. Note the direction of that: harvesting
promptly *reduces* this protection. Worth knowing before writing a crank that
drains on sight.

**BDR-014 (CRITICAL, found here, not in R1). Bags' program admin outranks
everything above.** `update_fee_config` takes `admin SIGNER` against the singleton
`program_config` — not the manager — and carries `bps`, `from_idx`, `to_idx`.
`force_claim_user`, `force_sol_claim_user` and `force_claim_user_to_vault` move a
claimer's fees with no signature from the claimer, and `ForceClaimType` has an
explicit `Admin` variant. **Manager waiver does not reach any of this.**

So the headline guarantee has to be restated at the size it actually holds:

> The **developer** cannot withhold, redirect or delay the split.
> **Bags can.**

That is a floor under every design built on their fee layer, ours included, and it
cannot be engineered away from our side. It is disclosed, at the same rank as the
tier-1 signer disclosure, or the whole exercise is dishonest — a launchpad whose
selling point is that promises are enforceable must not conceal who can still
break one.

### What R2 must decide before any Rust

1. Revenue lifecycle — sealed epochs or cumulative weights. No hybrid.
2. One implementable signing architecture, with a program-ID/PDA table and a CPI call graph.
3. Manager waiver as a launch gate, with the Bags config bound into the campaign.
4. Entitlement permanence — no sweep of liabilities, or an explicit change to a time-limited promise.
5. Content-addressed or authenticated initialization.
6. Frozen byte protocol: fixed-size canonical identities, one comparator, encoding version, published vectors.
7. Frozen account and arithmetic constraints.
8. Release proof: Rust differential tests against committed vectors, program-test adversarial matrix, measured compute.
9. The disclosure text for BDR-014 — what Bags' admin retains — written before launch, not after somebody asks.

**Two of my own reproductions passed for the wrong reasons** while I was fixing
this — an over-long proof was already rejected by hash rather than by length, and
a comparator assertion held because production was right and the *test* was wrong.
That is the same defect the review is about, met twice while responding to it.

---

**Status: unbuilt, and now known-defective. Retained below as the reviewed artifact.**

A Solana program that receives Bags fee-share revenue and pays it to a committed
list of subscribers, such that **the developer who launched the token cannot
withhold, redirect or delay a single lamport of it.**

That last clause is the entire reason the program exists. If a dev can withhold,
a launchpad built on this is a nicer way to make unenforceable promises, and the
promise is the part that has no value.

---

## 1. Threat model

The party we are defending against is **the launching developer**, not an
outside attacker. That is unusual and it should stay in the front of the
reviewer's mind: every design question is *"can the dev cheat here?"* before it
is *"can a stranger cheat here?"*

| Actor | Assumed to | Must not be able to |
|---|---|---|
| **Launching dev** | be economically rational and possibly dishonest | withhold, redirect, delay, re-order, or exclude anyone after the root is set |
| **Subscriber** | want their share and nothing else | claim twice, claim another's share, block another's claim |
| **Stranger** | be free to call anything permissionless | move funds anywhere, or make a legitimate claim fail |
| **Bags** | be honest but *changeable* | — (see §7: their program interface is a dependency) |
| **Us** | have no privileged access after deployment | anything at all |

**Explicitly out of scope.** We do not defend against a dev who never funds the
vault. Fee revenue accrues to whatever address the Bags fee-share config names,
and if the dev names their own wallet, this program was never in the path. What
the program guarantees is: *once the fee claimer is this program's PDA, the money
is out of the dev's hands permanently.* Verifying that a given campaign actually
did that is an off-chain check against Bags' published config, and the launchpad
should refuse to advertise a campaign that has not.

---

## 2. Two programs, split by what holds money

**Distributor — immutable.** Owns the vault, verifies proofs, pays. No upgrade
authority, no admin, no pause, no sweep. Small enough to read in one sitting.

**Harvester — upgradeable.** Moves fees from Bags into the distributor's vault.
Holds nothing. Cannot choose a destination: the vault address is derived, not
passed.

Upgradeable normally means custody in a costume. It does not here, because the
harvester has no authority over the vault and no code path that ends anywhere
except the vault. The reason it is separate is §7: it is the part coupled to
somebody else's program interface, and freezing that coupling into immutable code
would mean a Bags V3 permanently strands every campaign.

**A reviewer should attack this split first.** If there is any path by which a
harvester upgrade reaches vault funds, the whole design fails.

---

## 3. Accounts

```
Campaign            PDA ["campaign", campaign_id]
  authority_bump    u8
  campaign_id       [u8; 32]     hash of the campaign string, fixed at init
  root              [u8; 32]     Merkle root, WRITE ONCE
  quote_mint        Pubkey       the token fees arrive in
  total             u64          sum of all entitlements, fixed at init
  claimed_count     u32
  claimed_amount    u64
  leaf_count        u32          fixed at init; bounds the bitmap
  deadline          i64          unix seconds; after this, sweep is callable
  sweep_to          Pubkey       fixed at init, immutable
  bitmap            [u8; N]      one bit per leaf, N = ceil(leaf_count / 8)

VaultAuthority      PDA ["vault", campaign]        no data; signs for the vault
Vault               ATA of VaultAuthority for quote_mint
```

Everything except `claimed_count`, `claimed_amount` and `bitmap` is **write-once
at init**. There is no instruction that mutates `root`, `total`, `deadline`,
`sweep_to` or `quote_mint`, and a reviewer should confirm that by exhaustion
rather than by reading this sentence.

---

## 4. Instructions

### `initialize(campaign_id, root, total, leaf_count, deadline, sweep_to)`

Anyone may call it. Creating a campaign confers no power — it only fixes
parameters — so gating it would add an authority for no benefit.

Fails if the Campaign PDA already exists. **This is the only defence against a
dev re-initialising with a friendlier root, and it must be an `init` constraint
rather than a manual check.**

- `leaf_count` in `1..=10_000`, bounding bitmap size and rent
- `deadline` at least `now + 90 days`
- `total > 0`

The vault is **not** funded here and may be funded by anyone at any time.

### `harvest()` — permissionless

CPIs `claim_user` on Bags Fee Share V2
(`FEE2tBhCKAt7shrod19QttSVREUYPiyMzoku1mL1gqVK`), signing for VaultAuthority via
`invoke_signed`. Fees land in the vault.

Per the published IDL, `claim_user` takes `payer` and `user` as **separate**
signers. The caller is `payer`; `user` is our PDA. That separation is what makes
this permissionless — any subscriber can pay the transaction fee and harvest for
everybody, and the dev is not in the path.

Lives in the **harvester**, not the distributor.

### `claim(index, npub, amount, proof)` — permissionless

1. `require(index < leaf_count)`
2. `require(bit(index) == 0)` — else `AlreadyClaimed`
3. recompute `leaf = sha256(0x00 ‖ u32(index) ‖ u32(len npub) ‖ npub ‖ u32(len addr) ‖ addr ‖ u64(amount))`
   where `addr` is **the destination token account's owner**, read from the
   account, never from an argument
4. fold `proof` with `node = sha256(0x01 ‖ min ‖ max)` and `require(node == root)`
5. set `bit(index)`, increment counters
6. transfer `amount` from vault to destination, signed by VaultAuthority

**Permissionless on purpose.** Anyone may push a claim to its rightful
destination, because the destination is inside the leaf. A dev cannot refuse to
process a claim and a subscriber does not need SOL to receive their share.

Steps 1–2 precede any hashing so a replay costs the attacker compute, not us.

### `sweep()` — permissionless, only after `deadline`

Moves whatever remains to `sweep_to`, which was fixed at init.

Funds locked forever would be maximally trustless and would also mean money lost
to a typo'd address is destroyed rather than recovered. `sweep_to` fixed at init
and published up front is nearly as strong and much less wasteful. **A reviewer
should push back if they disagree** — this is the design's softest point and it
is deliberate rather than overlooked.

---

## 5. Invariants

1. `claimed_amount ≤ total` at all times
2. no leaf pays twice — `bit(index)` transitions 0→1 exactly once, never back
3. `root`, `total`, `leaf_count`, `deadline`, `sweep_to`, `quote_mint` never change after init
4. no instruction transfers from the vault except `claim` and `sweep`
5. `sweep` is unreachable before `deadline`
6. no signer other than VaultAuthority (a PDA) can authorise a vault transfer
7. the leaf encoding is byte-identical to `src/merkle.ts` — **cross-verified against the TypeScript, not merely believed**

---

## 6. Attacks, and where they die

| Attack | Defence |
|---|---|
| dev withholds fees | fee claimer is a PDA; dev has no key; `harvest` is permissionless |
| dev re-inits with a shorter list | `initialize` fails if the Campaign PDA exists |
| dev claims on a subscriber's behalf to a different address | destination owner is inside the leaf and read from the account |
| claimant claims twice | bitmap bit, checked before hashing |
| claimant sets a stranger's bit to lock them out | **index is inside the leaf** — a proof only validates for its own index |
| forged leaf from an internal node | `0x00`/`0x01` domain separation |
| two leaf sets, one root | odd nodes promoted, never duplicated (CVE-2012-2459) |
| field-boundary shifting | every field length-prefixed |
| amount inflated | amount is inside the leaf |
| stranger drains the vault | no instruction pays anywhere but a proven leaf's destination or `sweep_to` |
| griefing by front-running a claim | claims are idempotent-by-bitmap and the destination is fixed; a front-runner can only pay the fee on someone's behalf |

---

## 7. Accepted risks, stated rather than buried

**Bags' program interface is a dependency.** `harvest` CPIs a program we do not
control. A Fee Share V3 with different accounts breaks harvesting. This is why
the harvester is upgradeable and the distributor is not — the dependency lives
entirely in the replaceable half, and vault funds are reachable only through the
immutable half.

**A bug in the distributor cannot be patched.** Same cost `chain/README.md`
already states for the EVM anchor, and much sharper here because this one holds
other people's money. The mitigation is size: if the distributor cannot be read
end to end in one sitting, it is too big and should be cut down rather than
audited harder.

**The root is only as good as the process that produced it.** On-chain
enforcement makes distribution *unstoppable*, not *correct*. If the published
list omitted someone, this program faithfully enforces the omission. Detection
stays where it was — `reconcile()` against relays, which needs nobody's
cooperation.

**Rent.** Bitmap for 10 000 leaves is 1 250 bytes. Paid once by whoever
initialises. Not refundable, because a closable campaign account is a re-init.

**Unverified by anyone.** Nothing here has been built, tested or audited. Every
claim in this document is a design intention. **The point of publishing it before
writing code is that intentions are cheaper to correct than programs, and this
one cannot be corrected after deployment.**

---

## 8. Questions for the reviewer

1. Is the harvester/distributor split airtight, or is there a path from a
   harvester upgrade to vault funds?
2. Should `sweep_to` exist at all? Argue for permanent lock if you think so.
3. Is `initialize` being permissionless a mistake? What does an attacker gain by
   front-running it with a garbage root — and does refusing a campaign whose
   initialiser is not the launchpad reintroduce an authority worth avoiding?
4. Is reading the destination owner from the account rather than an argument
   sufficient, or does the token-account model allow a substitution we have missed?
5. Does anything break at `leaf_count` boundaries — 1, 8, 9, 4096, 10 000?
6. Compute budget: is a proof of depth 14 plus a CPI within limits?
7. What have we not thought of at all?

---

*Reference implementation of the tree, the leaf encoding and the campaign
arithmetic: `src/merkle.ts`, `src/campaign.ts`. 142 assertions, including an
independent reimplementation of the hashing from the prose, compared across eight
tree sizes. The Rust must match those bytes exactly, and a differential test
against them is a release requirement rather than a nice-to-have.*
