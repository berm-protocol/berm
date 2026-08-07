<!-- STATUS: HISTORICAL_REVIEW / SUPERSEDED_ROBINHOOD_OWNERSHIP_INFERENCE / LATER_FORK_EVIDENCE_CONTROLS -->

> # ⚠ HISTORICAL — EVIDENCE ONLY, NOT CURRENT AUTHORITY
>
> `HISTORICAL_REVIEW / SUPERSEDED_ROBINHOOD_OWNERSHIP_INFERENCE / LATER_FORK_EVIDENCE_CONTROLS`
>
> **The specific inference that is dead:** this review reasoned that the Berm
> launch controller could call `renounceOwnership()` on `BagsFeeShare` and thereby
> make `setClaimers` permanently unreachable. It cannot.
>
> A fork test against the live chain at **block 28814524** showed
> `BagsFeeShare.owner()` after `BagsFactory.create()` is the **factory owner**, so
> the call reverts with `OwnableUnauthorizedAccount`. Later fork evidence controls.
>
> Discard the assumption; keep the receipt. Everything else here is retained
> unedited as the reviewed artefact.

# Review — `BERM_DUAL_CHAIN_SIMPLIFIED_MECHANICS_BUILD_SPEC_20260804_R1`

Reviewed 2026-08-04 against the live Bags API (probed with a real key, GETs only),
the Solana Fee Share V2 IDL, and the Robinhood ABIs at `bagsfm/bags-idl`.

**Verdict: the economics are sound and verified. The Solana path is blocked on a
precondition it never states, and two design rules combine to strand up to 40% of
lifetime revenue permanently.**

---

## What is right, and verified rather than assumed

**The cumulative range math is exact, including the nesting.** Cohort pools
partition `R`, and slots partition each pool — two levels of flooring, and both
conserve. Checked over 3,000 revenue values across all 450 slots: **zero
mismatches, zero dust, at either level.** There is no rounding wallet and none is
needed. This is the strongest part of the document.

**One program ID owning both authority PDAs** (§4) is the correct fix for BDR-001,
and the reasoning is right: a PDA is signable only by the program that derived it,
so splitting harvest and custody across two programs was never implementable.

**Manager waiver as an on-chain activation gate** (§S2.4) matches what the Fee
Share V2 IDL supports — `manager` is a field on `FeeShareConfig` and
`manager_waive_fee_config` sets it to `Pubkey::default()`. Checkable in an account
constraint, not a hopeful off-chain snapshot.

**Raw 32-byte npub rather than a UTF-8 `npub` string** (§3.1) is right and fixes a
real ambiguity in our own leaf encoding.

**Proof depth bound** (§S9.5): `ceil(log2(300)) = 9`. Correct.

**§E2's honesty about what it does not know** — *"Do not silently downgrade to an
unprotected two-transaction launch while claiming equivalent guarantees"* — is
exactly the right instinct, and rarer than it should be.

**And the Robinhood claimer path genuinely works.** Verified in the ABI:

```
BagsFactory.create(string name, string symbol, string metadataURI,
                   address partner, address[] claimers, uint16[] bps)
BagsFeeShare.getClaimers() -> address[], uint16[]
BagsFeeShare.owner() / renounceOwnership()
BagsFeeShare.setClaimers(address[], uint16[])
```

Claimers are **raw EVM addresses passed straight into the launch call.** No handle,
no string resolution, no normalisation. A contract can be the sole 10,000-BPS
claimer, and `renounceOwnership()` kills `setClaimers` permanently, leaving
`owner() == address(0)` as one readable fact. The blocker that stops the Solana
path does not exist here.

---

## B-01 (CRITICAL, Solana) — the Harvester PDA cannot be *made* the claimer

§S2 requires that `HarvesterAuthority` **is** the Bags claimer. Nothing in the
document says how it *becomes* one.

Probed live, 2026-08-04: the only public route for pointing a Bags fee share at a
raw Solana address is `provider=solana` on the fee-share-wallet endpoint, and it
**lowercases the address**. Base58 is case-sensitive:

```
in    7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
out   7xkxtg2cw87d97txjsdpbd5jbkhetqa83tzrujosgasu    200 success:true
```

The result still decodes to 32 valid bytes, so nothing errors — it is simply a
different key nobody holds. Grinding around it is hopeless: only 34 of 58 base58
characters survive `toLowerCase()`, so a lowercase-safe 44-character address turns
up about once in 10^10.

**Credit where due: this spec fails closed.** §S2's on-chain check reads the actual
`FeeShareConfig` and compares against the derived PDA. A case-mangled claimer makes
that comparison fail, `bags_binding_active` never gets set, and §S2's own rule —
*the launchpad must refuse to launch until this passes* — stops the launch. Money
is not at risk. **The whole Solana path is simply unbuildable until Bags provides a
case-preserving route to name a raw address as a fee earner.**

That is a question for Bags, not a line of Rust. It should be answered before item
1 of the §8 build order.

---

## B-02 (CRITICAL, both chains) — unfilled cohorts strand their share forever

Three rules that are each defensible, and together are a trap:

| | |
|---|---|
| §1.2 | all three cohort pools accrue **from the first recognized fee unit**, even before their roots exist |
| §S3.4 / §3.4 | finalization requires **exactly** 100 (GRADUATION) or 300 (FOMO) entries |
| §1.5 | no deadline, no expiry, **no sweep, no admin withdrawal, no rescue** |

If 87 people qualify for GRADUATION, the root can never be finalized. Its 20% keeps
accruing and can never be claimed by anyone — not the subscribers, not the
residual recipient, not the dev. It is not recoverable, by design and on purpose.

FOMO needs **300 distinct npubs**. For a first campaign that is not an edge case,
it is the likely outcome. **Up to 40% of lifetime revenue is at stake, permanently.**

The `sync_external_deposit` / conservation identity makes it worse rather than
better: the stranded amount stays counted in `total_received` forever, so the vault
balance permanently exceeds what anyone can withdraw, and every reconciliation
report will show a growing unexplained surplus.

Three ways out, all cheap now and impossible later:

1. Let `finalize_cohort_root` declare an **actual** count `n ≤ cap`, and scale the
   cohort's BPS by `n/cap` with the shortfall flowing to the residual range.
2. Do not accrue to a cohort before its root exists — start its range at
   finalization, with earlier fees splitting across live cohorts and residual.
3. Keep exact counts but make an unfinalized cohort's share **redirect to residual**
   after a stated, on-chain, one-way condition.

Option 1 preserves the "reserved from the beginning" promise and the exact
conservation identity. Whatever is chosen, it must be in the initial deployment —
there is no admin to add it afterwards, which is the point.

---

## B-03 (HIGH, both chains) — the forced buyback can make a pocket unclaimable

§1.3 routes **every** claim through a swap, §1.3 and §19 forbid partial claims, and
nothing anywhere lets a subscriber take the fee asset itself.

So a claim can only succeed if a swap succeeds. If the pinned pool is illiquid,
paused, migrated, or simply cannot fill at the claimant's `min_tokens_out`, the
subscriber cannot claim **anything**. Setting `min_tokens_out` to 1 to force it
through is not a fix — that is a standing invitation to be sandwiched for the whole
pocket.

The contract ends up holding money it will only return in a form the market may
refuse to produce. For a design whose entire claim is *nobody can withhold your
share*, that is the wrong failure mode to build in deliberately.

The swap mechanics themselves are well specified — pinned pool, internally
constructed calldata, no user route bytes, balance-delta check, exact and cleared
allowances. That is how to do it **if** it is done. But it roughly doubles the
audited surface on both chains, and it is the part of the design that depends on
somebody else's liquidity being alive.

**A `claim_quote()` that pays the fee asset to the proven wallet and touches no DEX
is ~20 lines and removes the liveness risk entirely.** The buyback then becomes a
convenience path rather than the only door.

---

## B-04 (HIGH, Robinhood) — the beacon is a bigger hole than BDR-014, and §16.5 understates it

§16.5 asserts *"Bags beacon/proxy changes are detectable and grant no Berm
withdrawal power."* True, and beside the point.

```
BagsBeacon.upgradeTo(address)      // owner-gated
BagsFactory.feeShareBeacon()
BagsFactory.bondingCurveBeacon()
```

Every `BagsFeeShare` is a beacon proxy. Bags can replace the implementation **for
every token at once**, at any time, with no per-token consent. An upgraded
`claim()` can send fees anywhere, ignore `getClaimers()`, or do nothing at all.
Renouncing `owner()` on the fee share closes `setClaimers`; it does not touch the
beacon.

So on Robinhood, Bags' control over the fee stream is **stronger** than on Solana,
where the equivalent powers (`update_fee_config`, `force_claim_*`) are at least
enumerable instructions with fixed effects. That reverses the natural assumption
that the EVM path is the safer one.

This belongs in `SOVEREIGNTY.md`'s table, at the same rank as the Solana admin row.
"Detectable" is not a mitigation — by the time it is detected, it has happened.

---

## B-05 (MEDIUM, both) — the harvest invariant deletes its own protection

§S5.7 and §9 require the Harvester ATA to be **zero after every successful
harvest**, and harvest is permissionless, so in practice a crank keeps it at zero.

But Fee Share V2 raises `CannotRemoveClaimerWithFees` (6016) and
`CannotChangeClaimerIndexWithFees` (6017) — a claimer holding an unclaimed balance
**cannot be removed or reindexed**. Robinhood has the same guard,
`BagsFeeShare_ClaimerHasUnpaid`.

An always-empty claimer is always removable. The spec treats "zero after harvest"
as a purity invariant without noticing it maximises the window for exactly the
attack §S2 exists to prevent. Deliberately leaving a dust balance is an ugly
mitigation for a real hole, and at minimum the interaction should be stated
somewhere rather than discovered.

---

## Scope, stated plainly

Two chains, two languages, two DEX integrations, ~20 instructions and functions,
LiteSVM/Mollusk plus Foundry plus fuzzing plus fork tests plus reproducible builds
plus external review on both. That is a serious multi-month audited program, and
the audit is a real invoice.

The claim-only distributor in `SOVEREIGNTY.md` is one contract with no external
calls, no CPI and no market dependency, and it demonstrates the same claim: **the
split is fixed and nobody can move it.** This document is the right destination.
It is not the right first deployment, and shipping it first means the bounty — the
thing that actually earns attention — waits on an audit.

One business question the spec cannot answer: a perfect distributor on a chain with
no liquidity is worth nothing. Robinhood Chain's depth and user base decide whether
Part B is the unblocked path or the unblocked path to nowhere.

---

## Ordered next steps

1. **Ask Bags** for a case-preserving route to name a raw Solana address as a fee
   earner. Everything in Part A waits on the answer. Send the case-folding finding
   with it — it is a live fund-loss bug in their API, not just our blocker.
2. **Fix B-02 on paper** before any code. It is a two-line economic change now and
   an unfixable deployment later.
3. **Add `claim_quote()`** to both designs. Keep the buyback; stop making it the
   only exit.
4. **Move the beacon finding into `SOVEREIGNTY.md`**, and stop describing the EVM
   path as the safer one until it is.
5. Only then start the §8 / §14 build orders — and consider Part B first, since it
   is the half that is not blocked.
