# What is sovereign, and what is not

Berm is an **app on Bags**. Bags is the trusted layer. That sentence goes first,
in the README, on the landing page and in the launch post — not in a footnote,
not after somebody asks, and not phrased so it reads like a formality.

A project whose selling point is that promises become enforceable does not get to
be vague about which of its own promises are enforceable. So this file names every
layer, says who can break it, and refuses to round any of it up.

## The layers

| Layer | What can go wrong | Who can do it | Sovereign |
|---|---|---|---|
| The token | mint, LP pull, authority games | whoever holds mint and LP authority at launch | **Depends on the launch.** Not something we provide |
| The fee split at Bags | claimers and BPS rewritten | Bags' program admin (`update_fee_config`), **and** the dev while the `manager` role is unwaived (`manager_update_fee_config`) | **No** |
| Fees leaving Bags | claimed to somewhere else, with no signature from the claimer | Bags' program admin (`force_claim_user`, `force_sol_claim_user`, `force_claim_user_to_vault` — `ForceClaimType` has an explicit `Admin` variant) | **No** |
| The dev actually funding a distribution | they simply don't | the dev | **No.** This is the dev↔user trust boundary, and it is the only one v1 asks anyone to accept |
| A distribution, once funded | nothing | nobody — no admin, no owner, no upgrade, no sweep | **Yes** |
| The root matching the published subscriber set | a different root gets published | the publisher — but anyone can recompute it from public events and say so | **Verifiable**, which is not the same as enforced |
| The identity behind a claim | key exclusivity | see [custody tiers](../docs/content/custody.md) — tier 1 depends on one DNS name | **Tier-dependent**, stated per user |

Nothing above is a discovery about Bags behaving badly. Every one of those powers
is in their published IDL, deliberately, and most launchpads have more. The point
is only that we are not entitled to describe our layer as trustless while standing
on it.

## The sentence

Two lines. They are what "berm-verified fee sharing" actually means, and no
marketing copy may exceed them:

> **Once the tokens are in the distributor, the split is fixed by the root and
> nobody can redirect a single unit of it — not the dev, not Berm, not Bags.**
>
> **Whether the dev funds it, and whether Bags keeps paying the fee share that
> lets them, are not ours to guarantee.**

If someone reads that and still wants in, they have consented to the real thing.
If it costs us users, it costs us the users who were going to be angry later.

## Why the trust boundary is dev↔user, and why that is enough

The distributor does not need to make Bags trustworthy. It needs to make **one
specific promise** — *this community gets this share* — impossible to break after
it is made.

Today, a dev who assigns 25% of fees to a handle can renege in three ways: never
pay out, pay a different list, or pay a shorter list than they announced. All
three are invisible until someone does the arithmetic, and by then the money is
gone.

A funded distributor kills all three. What it does not do, and must not claim to
do, is force the dev to fund it in the first place. **The dev can still refuse to
start.** They just cannot lie about what happens once they do.

That is a smaller promise than "trustless launchpad" and it is a real one. It is
also the promise Bags cannot make for us, which is the argument for building it —
and, if it works, the argument to bring to them.

## The minimum shippable contract

Everything in `DISTRIBUTOR-SPEC.md` that is HOLD comes from features v1 does not
need. Cutting them removes five of six CRITICAL findings outright, because the
findings were about machinery, not about the promise.

**Claim-only. Nothing else.**

- The root is set **at deployment** and is immutable. No re-init, no update.
- Anyone may fund the contract, at any time, with the quote asset.
- `claim(index, account, amount, proof)` is **permissionless** and pays the
  address committed inside the leaf — not an address supplied as an argument.
- One bit per index, set on claim.
- **No admin. No owner. No upgrade path. No sweep. No deadline. No pause.**
- Want a second epoch? Deploy a second contract. Epochs are deployments.

What that removes, by finding:

| | Why it no longer applies |
|---|---|
| **BDR-001** signing architecture | Nothing is claimed on anyone's behalf. The dev harvests from Bags by hand and funds the contract. No CPI, no cross-program signing |
| **BDR-002 / BDR-014** config redirection | Out of scope, and therefore disclosed rather than defended against. The contract's guarantee starts at the moment it is funded |
| **BDR-003** continuing revenue | There is no lifecycle. One root, one funding, one contract |
| **BDR-004** sweep confiscating claims | There is no sweep. Unclaimed means unclaimed, permanently |
| **BDR-005** init squatting | Nothing is initialised permissionlessly. Deploying is the initialisation |

**BDR-006, BDR-007 and BDR-008 survive the cut** — token account constraints, the
root not committing its own sum, and arithmetic. Those are properties of any
Merkle distributor and still need to be right.

What is deliberately *not* in v1: harvesting, buyback, swap-on-claim, epochs,
governance, anything upgradeable. Each of those imports somebody else's attack
surface into a contract whose entire value is that it has none.

**In particular, the claim pays the quote asset and stops.** A subscriber who
wants the token swaps it themselves, in whatever venue they like. Bundling a DEX
call into the claim means a router interface, slippage policy, route data and MEV
all become part of a contract nobody can fix. The buyback is a good idea; it is
not a v1 idea, and it is not worth the word "trustless".

## What this makes demonstrable

The bounty gets sharper, not weaker. Everything a challenger needs is public:

- the subscriber events, on relays
- the root, recomputable from them by anyone, with `buildCampaign()`
- the contract balance and the claimed bitmap, on chain
- the npub↔handle proof, archived before any dispute

So the challenge is exact: **the money is here, the list is here, take a share you
are not on.** No trust in us is required to check the outcome, which is the only
kind of bounty worth running.

---

*This file is a disclosure, not a design document. If the design changes and this
file does not, the design is wrong.*
