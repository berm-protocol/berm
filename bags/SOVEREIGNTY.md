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
| The Bags fee-share **contract itself**, on Robinhood/EVM | every `BagsFeeShare` is a beacon proxy; a new implementation can ignore `getClaimers()` and send fees anywhere | Bags, via `BagsBeacon.upgradeTo()` — for **every token at once**, no per-token consent, and renouncing the fee share's own `owner()` does not touch it | **No — and this is stronger than the Solana admin powers above, not weaker** |
| Naming a raw Solana address as fee earner | the public route case-folds base58 into a different, unowned key and returns `success: true` | nobody has to do anything — it is the default behaviour of `provider=solana` | **Blocked.** Probed live 2026-08-04; see `README.md` |
| The dev actually funding a distribution | they simply don't | the dev | **No.** This is the dev↔user trust boundary, and it is the only one v1 asks anyone to accept |
| A distribution, once funded | nothing | nobody — no admin, no owner, no upgrade, no sweep | **Yes** |
| The root matching the published subscriber set | a different root gets published | the publisher — but anyone can recompute it from public events and say so | **Verifiable**, which is not the same as enforced |
| The weight ranges tiling `[0, W)` | overlapping ranges over-commit the vault; gaps strand revenue | the publisher — a Merkle proof shows membership, never that the set is well-formed | **Verifiable**, not enforced |
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

## What the deal actually is

The promise is not "trustless". It is narrower and it is real:

> **The deal between the developer and the community is immutable.**
>
> Not the deal between the community and the launchpad. Not the deal between
> anyone and the chain. **That one.**

Four things stop being possible the moment the contract is deployed, and they are
the four ways this is normally broken:

| The usual move | Why it cannot happen |
|---|---|
| *"Subscribe and we'll airdrop you something"* — then nothing | The share is committed in the root at deployment. There is no promise to keep, only a payment to execute |
| *"We've decided to change the allocation"* | No setter. No admin. No owner. The root is `immutable` and there is no function that writes it |
| *"The campaign is cancelled"* | No pause, no sweep, no withdraw, no deadline. There is no instruction that ends it |
| *"Your claim is under review"* | Claims are permissionless and pay the address inside the leaf. A stranger can execute your claim, and can only send it to you |

**Not even we can change it.** There is no key we hold, no upgrade path we kept,
and no argument anyone can make to us that would matter — the contract does not
have a function that would let us act on it.

What remains outside the deal is the launchpad's control of its own fee routing,
disclosed in the table above, and that is a limit of the ground we are standing
on rather than a reservation we made.

## It ports to any EVM chain, and Solana does not come free

The whole construction is chain-agnostic Solidity plus a secp256k1 derivation:

```
        one distributor contract  ─────────────┐
        one pocket derivation (npub → address) │  identical on every EVM chain
                                               │
   ┌───────────────┬───────────────┬───────────┴──────┐
   │               │               │                  │
 Robinhood       BNB             Base              whatever is next
   │               │               │                  │
 per-chain ingress: how THAT launchpad is told to pay the contract
```

The distributor needs no CPI, no adapter and no cross-program call — it only needs
to **be named as a fee recipient**. So per chain the only new work is that naming
step, and it is configuration rather than cryptography. Robinhood already
demonstrates it: `BagsFactory.create()` takes claimer addresses directly, so the
contract can be the sole claimer from the first block.

**Solana is the exception, and it is not a small one.** Nostr keys are secp256k1;
Solana keys are ed25519. The pocket cannot be derived from an npub there, and a
Solana campaign needs its own answer for where money lands. Nothing about the EVM
elegance carries across, and the claim must not be written as though it does.

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

## ⚠ QUARANTINED — the minimum shippable contract

> **Superseded for BermLaunch.** `GPT_BERM_HANDOFF_R2_REVIEW_20260807_R1` (D-09)
> preserves the existing lifecycle: cumulative WETH pockets, verified graduation,
> and a supporter-authorized full-pocket fixed-route buyback. The design below —
> claim-only, manually funded, one root fixed at deployment, quote-asset payout —
> is a **predecessor architecture**, not a correction to it.
>
> It is kept because the reasoning inside it is still sound and was arrived at
> honestly, and because deleting a superseded design hides why the current one
> looks the way it does. Do not build from it.
>
> **`claimQuote()` in particular is NOT approved for V1** (D-10). The liveness
> observation behind it was accepted as valid; the mechanism was not, and the
> reasons are good ones — see the note at the end of this file.

### The predecessor design, retained for reference

Everything in `DISTRIBUTOR-SPEC.md` that is HOLD comes from features v1 does not
need. Cutting them removes five of six CRITICAL findings outright, because the
findings were about machinery, not about the promise.

**Claim-only. Nothing else.**

- The root is set **at deployment** and is immutable. No re-init, no update.
- Anyone may fund the contract, at any time, with the quote asset.
- A leaf commits a **weight range**, not an amount: `[range_start, range_end)`
  inside a committed `total_weight`. Entitlement against revenue `R` is
  `floor(R·range_end/W) − floor(R·range_start/W)`.
- `claim(index, …, proof)` is **permissionless** and pays the address committed
  inside the leaf — not an address supplied as an argument. It pays the
  difference between what the leaf is now entitled to and what it has already
  received, so it may be called repeatedly as revenue accrues.
- **No admin. No owner. No upgrade path. No sweep. No deadline. No pause.**

**Why ranges rather than amounts.** Contiguous ranges telescope: the payouts sum
to exactly `R` for any revenue and any weights, so there is no rounding dust and
no dust recipient to argue about. Naive per-share flooring loses a unit per
claimant and needs somewhere to put it. Verified over 400 randomised
partitions — zero mismatches. It also means the contract survives **continuing**
revenue rather than one pot, which is what a fee share actually is, without a
second deployment per epoch.

**What ranges do not fix, and it must be said out loud:** a proof shows one leaf
is in the tree. It cannot show that the leaves **tile** `[0, W)`. Overlapping
ranges over-commit — two leaves spanning 60% and 70% owe 130% of revenue, so
early claimers are paid and late ones bounce off an empty vault — and gapped
ranges strand the gap permanently. The tiling is **recomputable by anyone** from
the published subscriber set and **not enforced on chain**. That is the same class
as the root itself: verifiable, not enforced, and it belongs in the table above
rather than in a footnote.

What that removes, by finding:

| | Why it no longer applies |
|---|---|
| **BDR-001** signing architecture | Nothing is claimed on anyone's behalf. The dev harvests from Bags by hand and funds the contract. No CPI, no cross-program signing |
| **BDR-002 / BDR-014** config redirection | Out of scope, and therefore disclosed rather than defended against. The contract's guarantee starts at the moment it is funded |
| **BDR-003** continuing revenue | Cumulative ranges handle it. One root, many top-ups, one contract |
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


---

## On `claimQuote()`, and why the ruling is right

I argued that if the only exit is a swap, a paused or illiquid pool leaves a
supporter unable to claim anything — and that this collides with the
website-independent acceptance test, which ends *"receive launched tokens"* and
therefore quietly assumes a working market.

The observation was accepted (D-10). The mechanism was not, and on reflection the
refusal is better reasoned than the proposal. An emergency quote withdrawal needs
an activation condition that is **deterministic and non-gameable**, and every
obvious candidate fails:

| Condition | Why it fails |
|---|---|
| "the pool is paused" | who attests it? An oracle is a new authority |
| "no route for N days" | a claimant with capital can manufacture a failing route |
| a timeout | converts buyback economics into optional quote withdrawal for everyone |
| an admin switch | is an admin, which is the thing this contract exists not to have |

Getting `claimQuote()` built badly would have been worse than not having it — it
would have introduced exactly the authority the whole design refuses.

**What I actually wanted was the disclosure, and that was conceded.** The promise
is now stated at the size it holds:

- entitlement does not expire
- website availability is not required
- the user can construct the claim independently
- **conversion still depends on the committed market route being operational**
- if the route is unavailable, the WETH entitlement remains preserved in the
  Distributor

That fourth line is the one that was missing. It is now the difference between a
claim that survives contact with a dead pool and one that does not.

Tracked as an open market-failure resilience lane, undecided rather than closed.
