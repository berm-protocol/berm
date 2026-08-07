# What is sovereign, and what is not

**Canonical. R4.** Written for the current BermLaunch Robinhood lifecycle. The
predecessor — claim-only, manual funding, one root at deployment — is at
[`historical/SOVEREIGNTY_R1_SUPERSEDED.md`](historical/SOVEREIGNTY_R1_SUPERSEDED.md),
evidence only.

BermLaunch is an **app on Bags**. Bags is disclosed upstream infrastructure. That
sentence goes first — in the README, on the landing page, in the launch post — not
in a footnote and not phrased so it reads like a formality.

A project whose selling point is that promises become enforceable does not get to
be vague about which of its own promises are enforceable.

## The lifecycle this document is about

```
Bags fee stream          ← Bags retains claimer and upgrade authority. Disclosed.
   ↓
immutable Berm Distributor
   ↓
cumulative virtual WETH pocket per supporter
   ↓  verified graduation
supporter-authorized full-pocket fixed-route buyback   ← the supporter's EVM key
   ↓                                                      controls the timing
launched token → the committed EVM destination
```

## The layers

| Layer | What can go wrong | Who can do it | Sovereign |
|---|---|---|---|
| The Bags fee stream | claimers or BPS rewritten | Bags' program admin; and the dev while the `manager` role is unwaived | **No** |
| The Bags fee-share contract itself | every `BagsFeeShare` is a beacon proxy; a new implementation can ignore `getClaimers()` | Bags, via `BagsBeacon.upgradeTo()` — **for every token at once**, no per-token consent | **No.** Stronger than any Solana admin power |
| `BagsFeeShare` ownership after `create()` | it is the **factory owner**, not the launcher | proven on a fork at block 28814524; `renounceOwnership()` reverts for us | **No.** Not fixable from our side |
| Value that has reached the Distributor | nothing | nobody — no admin, no owner, no upgrade, no sweep | **Yes** |
| Supporter accounting inside the Distributor | nothing | nobody. Frozen economic law, immutable presets | **Yes** |
| Who is in a cohort | a root committing a different set | the `rootFinalizer`, once per cohort, until sealed — see below | **Disclosed temporary authority** |
| The destination in a finalised leaf | nothing | nobody. It is inside the root | **Yes** |
| When a buyback happens | nothing | **the supporter**, via their EVM key | **Yes — theirs** |
| Whether conversion succeeds | the committed market route is unavailable | the market | **No.** Entitlement is preserved, not converted |
| `bermlaunch.com` / `signer.xonly.ai` | going away | anyone | **Irrelevant to access** — see below |

Nothing above is a discovery about Bags behaving badly. Every one of those powers
is in their published IDL and ABI, deliberately, and most launchpads have more.
The point is that we are not entitled to describe our layer as trustless while
standing on theirs.

## What the deal actually is

The promise is not "trustless". It is narrower and it is real:

> **The deal between the developer and the community is immutable.**
>
> Not the deal with the launchpad. Not the deal with the chain. **That one.**

Four things stop being possible, and they are the four ways this is normally
broken:

| The usual move | Why it cannot happen |
|---|---|
| *"Subscribe and we'll airdrop you something"* — then nothing | The entitlement accrues inside an immutable Distributor. There is no promise to keep, only accounting to execute |
| *"We've decided to change the allocation"* | Economic presets are immutable and the cohort ranges are fixed at construction. No setter, no admin, no owner |
| *"The campaign is cancelled"* | No pause, no sweep, no withdraw. There is no instruction that ends it |
| *"Your claim is under review"* | The supporter's own EVM key authorises the buyback. Nobody stands between them and it |

**Neither the creator nor BermLaunch can redirect or withdraw supporter
entitlement.** Not as a policy we are promising to keep — there is no function
that would let us act on any argument anyone ever makes to us.

## `rootFinalizer` — a temporary, disclosed publication authority

Say this plainly rather than leaving it to be discovered.

Cohort membership for GRADUATION and MOMENTUM cannot exist before those
supporters do, so a root is published later by a fixed `rootFinalizer` address —
once per cohort, never replaceable, and permanently retired by `sealRoots()`.

Until sealing, that address decides who is in those cohorts. It cannot move
money, cannot change economics, and cannot alter a root already set. But it is a
real authority and it is ours, so it is named here rather than implied.

**Enrollment evidence is what shrinks it.** The chain is:

```
signed enrollment events → deterministic snapshot/cutoff → cohort selection law
  → canonical roster → wallet binding → manifest → Merkle root → finalization → seal
```

Every step is reproducible from public signed events, so a stranger can recompute
the roster and check the published root against it. The finalizer still performs
the on-chain act; it should have as close to zero semantic discretion as the
design can manage, and Trust & Verify should show the derivation.

## Websites are convenience, not custody

`bermlaunch.com` and `signer.xonly.ai` are infrastructure for discovery, signing
convenience and indexing. **Neither is a custodian and neither is a source of
truth.** With both offline, a supporter holding their portable proof bundle and
their EVM key can reconstruct their entitlement and authorise the buyback through
a public RPC and an independent client.

That is an acceptance test, not a claim. If it does not pass, this section is
false.

`signer.xonly.ai` is replaceable neutral infrastructure — it may broker, index,
cache and mirror, but it must never be the only holder of a secret, an enrollment
record, a proof, a roster or a manifest. It is still a domain, and a domain is
still a dependency while you are using one. Say so.

## Website independence is not market independence

The distinction people will get wrong, so state it before they do:

- entitlement **does not expire**
- website availability **is not required**
- the supporter can construct the claim **independently**
- **conversion still depends on the committed market route being operational**
- if that route is unavailable, the WETH entitlement **remains preserved** in the
  Distributor

### On `claimQuote()`, and why it is not V1

An escape that pays the quote asset directly was proposed after observing that a
paused or illiquid pool leaves a supporter unable to convert. The observation was
accepted. The mechanism was refused, and the refusal is better reasoned than the
proposal: an emergency withdrawal needs an activation condition that is
**deterministic and non-gameable**, and every obvious candidate fails.

| Condition | Why it fails |
|---|---|
| "the pool is paused" | who attests it? An oracle is a new authority |
| "no route for N days" | a claimant with capital can manufacture a failing route |
| a timeout | converts buyback economics into optional withdrawal for everyone |
| an admin switch | is an admin — the thing this contract exists not to have |

Building it badly would have introduced exactly the authority the design refuses.
What was adopted instead is the **disclosure** above, which is the part that was
actually missing. Tracked as an open market-failure resilience lane: undecided,
not closed.

## The trust boundary, and why it is enough

The Distributor does not need to make Bags trustworthy. It needs to make **one
promise** — *this cohort gets this share, and only they decide when to take it* —
impossible to break after it is made.

Today a dev who assigns a share to a community can renege three ways: never pay,
pay a different list, or pay a shorter list than announced. All three are
invisible until someone does the arithmetic, and by then the money is gone. The
Distributor kills all three.

What it does not do is make Bags' upstream authority disappear, and it must never
be described as though it does.
