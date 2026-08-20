# BermLaunch — what it is, what it unlocks, and how anyone checks it

A token launchpad where a creator can hand a share of their own trading fees to
named people — **before the token exists, at graduation, or years later** — and
nobody, including the creator, can take it back.

This document describes the whole product. `BERMLAUNCH-SCOPE.md` says which parts
v1 builds; everything here marked **[roadmap]** is mechanism the contract already
supports but the v1 constitution does not configure.

---

# Part I — The idea

## 1. There is only one primitive, and it is called a pocket

**A pocket is a permanent, proportional claim on a fee stream, owned by a key.**

That is the entire invention. Everything else in this document is configuration:
*who* owns a pocket, *when* it was created, *how large* a slice it holds.

A pocket is not an address, and it is not a balance someone credits you. It is a
**range** inside a fee stream. When value arrives, every pocket's entitlement grows
by its own proportion, automatically, without anyone processing anything. When you
claim, the contract computes what your range is owed and pays it.

Nobody can move your pocket. There is no admin who can adjust it, no window in
which you have to be present, no form to fill in, and no way to be too late.

## 2. Why this is not an airdrop

An airdrop is a **one-time gift, decided afterwards, by the person giving it.** You
hope you qualify. Someone decides a snapshot. Someone runs a script. If they change
their mind, or the criteria, or the amount, you have no recourse, because nothing
was ever promised in a form that binds.

A pocket is a **continuous claim, decided beforehand, enforced by arithmetic.** The
share is fixed when the campaign is committed. It keeps paying for as long as the
token trades. The creator cannot revise it, and neither can we.

The difference is not generosity. It is *whether the promise exists as a fact or as
an intention.*

## 3. The three moments

The thing no other launchpad can say is **when** you can make that commitment.

**Before the token exists.** People who backed you when there was nothing to back.
The hardest supporters to reward, because at that point you have no token, no
liquidity, and no way to pay anyone. A pocket costs nothing to create and pays out
for years.

**At graduation.** The moment the bonding curve completes and a real pool exists.
Historically the moment everything gets chaotic and early people get diluted by
whoever is fastest.

**Any time after.** Someone joins the community in month eight and matters. There
is no reason their commitment should be less real than a day-one supporter's, and
in the current design it is not — the same machinery, the same immutability.

The v1 campaign encodes exactly these three as `PRELAUNCH`, `GRADUATION` and
`FOMO`, shown to users as **Founding**, **Graduation** and **Momentum Supporters**.

---

# Part II — The machine

## 4. How fees arrive

The token launches on Bags. Bags routes trading fees to a **fee share** contract,
and the fee share names exactly one claimer: **the Distributor**, at 10000 bps —
all of it.

That is checked, not assumed. `bindLaunch` refuses unless the fee share names this
exact Distributor as sole claimer at exactly 10000 bps, the token exists with a
curve and a pool, WETH, hook, pool and curve all match, the beacon and
implementation are non-zero, and there is no authority collision. Any one of those
wrong and **the whole launch reverts** — the token, the binding, everything, in one
transaction.

Once bound, `launchBound` is true forever. There is no unbind, no rebind, and no
path to point the fees somewhere else. Verified: zero such functions exist.

Fees are pulled in by `harvest()`, which **anyone** may call. Value that arrives by
some other route is picked up by `syncExternalDeposit()`, so nothing gets stranded
because it took an unexpected path.

## 5. How the split works, and why there is never any dust

Every pocket owns a **range** of basis points. The share is:

```solidity
rangeAllocation(total, start, end, denominator)
    = mulDiv(total, end,   denominator)
    - mulDiv(total, start, denominator)
```

Adjacent ranges telescope. `0→2000` plus `2000→4000` plus `4000→6000` sums to
exactly `0→6000` of the total — not approximately, exactly, for any amount. No
rounding remainder, no leftover wei that somebody has to decide the fate of, no
"treasury" that quietly accumulates the difference.

`rangeAllocation` is **public and pure**. Anyone can call it with their own numbers
and check their own share without asking us anything.

The v1 preset — `BERM_STANDARD`, `mutable_after_launch: NO`:

```
0    –  2000 bps   Founding Supporters      50 slots
2000 –  4000 bps   Graduation Supporters   100 slots
4000 –  6000 bps   Momentum Supporters     300 slots
6000 – 10000 bps   the creator's residual
```

**60% of all trading fees to 450 people, permanently. 40% to the creator.**

## 6. The operating fee — a pocket for whoever keeps the lights on

The contract has an immutable `operatingFeeRecipient` and an immutable
`operatingFeeBps`, **capped at 1000 bps — exactly 10%** — enforced at construction:

```solidity
if (operatingFeeBps_ > 1_000 || minimumClaimGross_ == 0) revert InvalidConfiguration();
```

Taken at claim time, transferred directly. This is the mechanism for **paying a
service out of the stream rather than out of pocket** — a DEX listing, a market
maker, an audit, an infrastructure bill. It is set once, disclosed, and cannot be
raised afterwards. There is also an immutable `partnerRecipient` for a co-launch
counterparty.

The cap is the point. A fee that can be raised later is not a fee, it is an option
on your revenue.

## 7. Graduation and the buyback

`activateGraduation()` verifies against on-chain state that the curve has completed
and a real pool exists. It fails with `NotGraduated` otherwise.

After that, a supporter calls `claimBuyback(...)`: proves membership with a Merkle
proof, and their accumulated WETH entitlement is converted into the launched token
through a **committed fixed route**, with slippage and deadline protection. A failed
swap rolls the whole thing back rather than leaving anyone half-paid.

The creator draws their residual with `claimResidual()` — **against their 4000 bps
and never against the community's 6000**, under any condition, including a cohort
that never filled.

## 8. What becomes immutable, and exactly when

| Moment | What freezes |
|---|---|
| Distributor deployment | economics, cohort ranges, operating fee and cap, recipients, campaign constitution hash |
| `bindLaunch` | the token, the fee share, the pool, the Bags authority snapshot |
| `finalizeCohortRoot` | that cohort's membership and every destination in it |
| `sealRoots()` | the finalizer authority itself, **permanently retired** |

After sealing there is no privileged actor left. Not us, not the creator, not a
multisig. The only remaining operations are the ones anybody can call.

---

# Part III — What it unlocks

Each of these is the same primitive with different configuration.

## 9. Community, before the token exists **[v1]**

*Who:* people who showed up early. *When:* before launch.

The pocket exists before there is anything to pay it with. When trading starts, it
starts paying, and it does not stop. **This is the case that has no alternative
today** — you cannot pay someone from a token that does not exist, so historically
you promise, and the promise is worth what the promiser's word is worth.

## 10. Community, at graduation **[v1]**

*Who:* people who carried it through the curve. *When:* the moment the pool opens.

Graduation is when early supporters historically get flattened. A pocket committed
at graduation is exactly as permanent as a day-one one.

## 11. Community, any time after **[v1]**

*Who:* people who arrive later and matter anyway. *When:* whenever.

Most communities have no way to reward a good arrival at month eight. This is the
answer, and it is the same machinery.

## 12. Paying a service from the stream **[v1 — the operating fee]**

*Who:* a DEX, a market maker, an auditor, an infrastructure provider.
*How:* `operatingFeeRecipient` at up to 1000 bps, immutable.

A service provider who is paid from the stream is aligned with the stream. And
because the fee is capped and immutable, they can verify the deal before agreeing
to it — and so can everyone else. Your ~10% DEX-pay pocket, mechanically.

## 13. A co-launch partner **[v1 — `partnerRecipient`]**

*Who:* another project, a launch partner, a syndicate.

An immutable recipient set at deployment. Two projects launching together can bind
the relationship into the contract rather than into a Telegram message.

## 14. A KOL, paid from the creator's own slice **[roadmap]**

*Who:* one named promoter. *From:* the creator's 4000 bps, never the community's.

Mechanically trivial — subdividing `6000→10000` telescopes exactly the same way
and produces zero dust. The KOL can verify the deal before promoting, which is a
better arrangement for both sides than a private agreement.

*Roadmap because:* the v1 constitution does not encode creator sub-splits.

## 15. Moderators, on a recurring basis **[roadmap — needs one new mechanism]**

*Who:* people doing ongoing work. *Shape:* weekly or monthly, and it should stop
when the work stops.

This is the one use case that needs something genuinely new. Every other pocket is
**permanent by design**, and a moderator pocket needs to **end**. That means either
epochs or versioned roots with an activation point — a second allocation dimension —
plus a decision about what happens when nobody rolls the epoch: does the moderator
keep earning, or does everything halt?

That unanswered fallback is the same shape as the worst bug this project has
found, which is why it is roadmap rather than a small addition.

*Also worth naming honestly:* recurring payment for ongoing work is
compensation-shaped rather than fee-share-shaped, and deserves a look from someone
qualified before it ships.

## 16. Further shapes the primitive already supports **[roadmap]**

**A treasury pocket** — a slice to a community-controlled key rather than a person.
**A contributor pocket** — a developer paid from the stream instead of a grant.
**A public-goods pocket** — a permanent slice to something outside the project.
**A reciprocal pocket** — two projects each holding a slice of the other, so their
incentives are literally shared.

None of these need new contract mechanics. They need constitution configuration and
a decision that they are in scope.

## 17. A tradeable pocket — the credit / claim split **[roadmap]**

*The question:* could a pocket be an NFT, so it can be sold?

**Mechanically, yes, and it need not disturb anything already sealed.** A wrapper
contract accepts a deposit of the claim right and mints an ERC-721; trading the
token trades the position. No leaf-schema change, no new constitution, no
migration. (The cleaner form — the leaf binding `slot → tokenId` — changes root
law, so it would be a v2 campaign and never a retrofit.)

**The naive version breaks the product.** A pocket that can be bought
**separates the payout from the person, permanently and by design.** The buyer has
no audience, made no noise and brought nobody. Fifty Founding slots that can be
purchased are a pre-sale rather than a supporter cohort — and the ladder exists
precisely so that conviction outranks capital. It is the anonymous-wallet failure
mode again, except deliberate.

It also weakens the sentence the product is built on. *"Your pocket is yours,
forever"* becomes *"yours until you sell it, and then theirs"* — still true, but
conditional, and the buyer's expectations are not the earner's.

### The split that resolves it

Separate what is currently one object:

| | Lives | Transferable |
|---|---|---|
| **The credit** — who was there | inside the sealed root, bound to the npub | **never** |
| **The claim** — who collects | a layer above the root | optionally yes |

*"These fifty people launched this"* then stays true forever, whatever happens to
the cash flow afterwards. The exposure already happened and is recorded. The
community graph on Nostr is untouched, because it is keyed to npubs rather than to
whoever currently holds the money.

And it closes a real gap. Today a supporter needing liquidity has only the buyback
— convert and sell, which exits the token entirely. A transferable claim lets them
exit **the stream** while the stream continues. It would also produce price
discovery: *"a Founding slot trades at X"* is a legible signal about the mechanism
that no amount of documentation generates.

### Before it is built

**Transferability is the property that changes the legal shape.** A
non-transferable claim received for participating is one thing; a transferable
instrument paying a proportional share of revenue from a common enterprise is
another. That is not an engineering judgement and this document should not pretend
otherwise — take advice **before**, because transferability is the specific feature
that moves it.

## 18. A visibility pocket — DEX listing, then boosts **[roadmap — nice to have]**

*The question every memecoin community asks by day two:* **"wen dex?"**

*The shape:* a pocket anyone can fund and anyone can trigger, which pays for the
token's DexScreener listing first and its Boosts afterwards — so the answer to
"wen dex" is a public balance and a threshold rather than a promise from the dev.

**Priority, stated plainly: this is nice to have, not a differentiator.** Bags
already ships it. They partnered with DexScreener to build **DEX Boosts on Bags**,
described as *"a custom fee sharing app that uses fees to buy DEX Screener boosts
automatically"*, alongside a **Pay DEX** app. The idea is sound and it is no longer
ours to introduce. It is recorded here because the *composition* is still
interesting — a permissionless trigger on a public balance is a different object
from a hosted app — not because it moves anyone's decision to launch with us.

### Verified mechanics, because designing around an assumption is how the last four defects got in

| | What DexScreener actually documents |
|---|---|
| **Enhanced Token Info** | $299, discounted from $499. "All major cryptocurrencies and credit/debit cards." A **form** plus a payment. Processed in minutes, up to 12 hours |
| **Boosts** | Bought by clicking the yellow **Boost** button on the token page. 12–24h depending on pack. A multiplier on Trending Score, not a guarantee of placement. Golden Ticker at 500+ active. **Non-refundable.** Web browser only — not in the mobile app |
| **Who may buy a Boost** | Not restricted to the token owner. The terms say only: *"It is the User's sole responsibility to ensure they are purchasing Boosts for the correct token"* |
| **Programmatic route** | **Not documented for either.** No API, no published payment address |

The third row is the one that helps: a **community-triggered** boost is legitimate
under DexScreener's own terms. Nothing requires the buyer to be the creator.

The fourth row is the one that decides the design.

### The blocker, named honestly

**A permissionless `trigger()` can move money to an address. It cannot click a
button.** If there is no address — and none is published — then the pocket funds a
purchase that a *person* completes. That person is a **new trusted party**, and
they rank in `SOVEREIGNTY.md` alongside the observer and Bags, because a funded
pocket with an unfulfilled purchase is exactly the failure the trust surface exists
to render.

Bags' version resolves this through a **partnership integration** with DexScreener.
That is a business conversation, not a build task, and it is the honest reason this
sits in roadmap rather than in a sprint.

### The constraint that is already law

**A boost pocket cannot be a second Bags claimer.** `BL-03 bindLaunch` requires our
Distributor to be **sole claimer at 10000 bps**; a second claimer reverts the launch
with `InvalidLaunchBinding`. So Bags' own DEX apps and our Distributor are mutually
exclusive on the same token, and any pocket of ours must be funded **downstream** of
the Distributor — from the operating fee or the creator's residual.

**Never from the community's 6000 bps.** A creator spending supporters' entitlement
on their own marketing is the thing this whole product exists to make impossible.

### Two more things that would go wrong

**Sequencing is a preference, not a dependency.** Boosts work on a token with no
Enhanced Token Info at all. Order them if you like, but a hard gate means a stalled
form freezes the pocket permanently — a fail-closed that closes on the wrong thing.

**$299 is a fiat price and the pocket holds WETH.** Either an oracle, or a WETH
threshold with deliberate headroom and the overshoot rolling into boosts.

### The part with independent value

The creator signs a statement that **the metadata they gave BermLaunch is the dex
metadata** — name, description, socials, website. That artifact needs nothing from
DexScreener. It gives a canonical, creator-signed record that can be handed to
whoever submits, including a human.

And when a creator has **no website**, the link goes to their **BermLaunch token
page** — which carries that same metadata *and* the Nostr-signed messages from their
supporters. The dex surface then points back at the community that funded it, and
that page is readable whether or not anything above ever ships.

One rule, and it is the same rule as the X composer in BL-14: **signing the
metadata is not the metadata being live.** Until a fetch of the token page confirms
it, the status is *submitted*, never *listed*.

## 19. Why the divisor is fixed — and why an unfilled cohort strands value

A Founding slot is `2000 bps ÷ 50` whether fifty people enroll or twenty. A
supporter who reads that carefully will ask the obvious question: *if only twenty
of us showed up, why isn't my share bigger?*

**Because if it were, you would be paid to keep people out.**

### The counter-incentive we removed

Divide the cohort pot by the number who actually enrolled, and every existing
supporter's share shrinks each time someone new joins:

| Founders | Each would get |
|---|---|
| 20 | 1.00% |
| 30 | 0.67% |
| 47 | 0.43% |

A supporter who brings ten friends would cut their own share by a third. **We would
be charging people for the exact behaviour the product exists to encourage.**

The whole argument for binding a pocket to a Nostr identity rather than a bare
wallet is that a supporter is a person with an audience. A wallet can hold a pocket;
it cannot post, be followed, vouch, or bring anyone. Designing the economics so that
bringing someone is expensive would quietly undo that.

**With a fixed divisor, recruiting costs you nothing.** Your slot is your slot. Ten
more Founders do not touch it.

### And it gives you a reason to recruit

A fixed divisor does more than remove a penalty. It means the only way your slot
becomes worth anything is if the token itself is worth something — and a token with
fifty real supporters who each brought an audience is worth more than one with five.

**0.40% of something beats 2% of nothing.** That is the entire incentive, and it
points outward.

### What happens to the unfilled slots — stated plainly

If twenty Founders enroll against a fifty-slot cohort, thirty slots are never
claimed. **That value is stranded permanently.**

It does not go to the creator. `creatorTotal` is
`rangeAllocation(received, communityBps, BPS, BPS)` — the creator's range begins
*above* the community share, so unclaimed community value is unreachable from the
residual by construction, not by promise. It does not go to us. There is no sweep,
no expiry, and no admin path to it — that is the same rule that makes your own
entitlement unsweepable.

It stays in the contract, unclaimable by anyone, forever.

| Enrolled | Paid to Founders | Stranded permanently |
|---|---|---|
| 20 | 8% of fees | **12% of fees** |
| 30 | 12% | 8% |
| 40 | 16% | 4% |
| 50 | 20% | 0% |

**That is a real cost and we are not going to hide it.** It is the price of making
recruitment free, and we think it is the right trade — but you should be able to see
it and disagree.

### The fill ratio is public

Because the cohort size is fixed before anyone enrolls, **how full it got is a
number.** A token that filled 50/50 and a token that filled 12/50 are different
objects, and the difference is visible on the campaign page before you buy anything.

A cohort that filled is evidence that someone did the work. A cohort that did not is
evidence of the opposite. Neither is hidden, and the market can price both.

## 20. Creator-chosen thresholds **[roadmap]**

*The shape:* the cohort size is not 50 by law — it is a number the **creator picks
before anyone enrolls**, and it is immutable from that moment. Ten. Fifty. Five
hundred.

**The threshold must be reached for the cohort to fill.** It is not a cap that the
enrollment count quietly redefines — it is a target fixed in advance, and falling
short is visible rather than erased.

That makes the number a **commitment**, not a description. Choosing 100 and reaching
it is expensive and public. Choosing 10 is an honest statement about scale. Choosing
500 and filling 40 is legible too, and the page will say so.

**Why this matters for a launchpad rather than for one token.** If a campaign could
simply launch with whatever turned up and divide the pot among them, the cost of
firing off a token with three supporters would be zero — and a launchpad where that
is free fills up with tokens nobody worked for. A threshold that must actually be
achieved puts a price on launching, paid in the only currency that matters here:
people who showed up.

Then BermLaunch carries tokens with a hundred Founders and tokens with ten, side by
side, with the number stated — and the market judges.

*Roadmap because:* `memberCount(uint8)` is currently `public pure` and returns
50/100/300 as hardcoded constants. Making it a per-campaign immutable is a small
change, but it is a **contract** change, so it lands in a future Distributor rather
than this one.

**One warning, recorded because the same change can be built two opposite ways.**
The creator-chosen threshold sets the divisor **before enrollment opens**. It must
never be implemented as "the divisor equals however many actually enrolled" — that
is the counter-incentive in §19, reintroduced through the back door, plus it lets a
later cohort out-earn an earlier one whenever it happens to be smaller. **The number
is chosen in advance and is immutable. It is never derived from the outcome.**

---

# Part IV — How a creator uses it

1. **Decide the shape.** Cohort sizes, the moments, the operating fee and who
   receives it, any partner. This becomes the **campaign constitution**, and its
   hash is committed on-chain at deployment.
2. **Deploy the Distributor** with those parameters. They are immutable from this
   instant. A zero constitution hash is rejected.
3. **Launch atomically.** The Controller creates the Bags token and binds the
   Distributor in one transaction. Any invariant failure reverts everything.
4. **Waive the manager role.** Until this is done, Bags lets the creator rewrite the
   fee configuration — so *"the dev cannot redirect the split"* is not yet true.
   Publish the transaction.
5. **Let people enroll.** Each supporter signs their own binding. The creator never
   assigns membership, cannot add anyone, and cannot remove anyone.
6. **Finalize each cohort** as it closes, then **seal**. After sealing the creator
   has no privileged operation left except drawing their own residual.

## What a creator cannot do, ever

Change the split · redirect the fees after binding · add or remove a member ·
replace a finalized root · draw against the community's share · introduce a
deadline or expiry on anyone's entitlement.

---

# Part V — How a supporter uses it

1. **Get an identity.** Either an existing Nostr signer, or the default: a key
   generated in the browser and downloaded as an encrypted file. The download is
   **not optional** — you cannot continue without it.
2. **Enroll.** One signature binding campaign, mode, your identity, your payout
   address, and proof you control that address.
3. **Get a slot.** Membership comes from published snapshots, so you are in the
   batch where you were *seen* — backdating buys nothing.
4. **Wait, or don't.** Your entitlement accrues whether or not you are watching.
   There is no window, no deadline, no requirement to be online.
5. **Claim when you want.** Prove membership, convert to the token through the
   committed route. **No account, no approval, and our website does not need to be
   reachable.**

## What a supporter is trusting

Bags, who can rewrite the fee configuration upstream — disclosed at the top of
`SOVEREIGNTY.md`, not buried. And the observer key that orders rebindings before
finalization. **That is the complete list**, and if the fee stream fails it fails
for the creator too. That makes the arrangement **honest, not safe**, and the
enrollment copy says so in those words.

---

# Part VI — How anyone verifies

Nothing below requires our permission, our website, or an account.

## On-chain, directly

**Immutables** — read them from the contract:

```
campaignId                  campaignConstitutionHash
weth                        bagsFactory / bagsLens
launchBinder                launcherAuthority
partnerRecipient            operatingFeeRecipient / operatingFeeBps
rootFinalizer               launchBound
```

**Events** — the whole lifecycle is a public log:

```
LaunchBound(token, feeShare, curve, poolId)
CohortRootFinalized(cohortId, root, evidenceManifestHash)
RootsSealed()
FeesHarvested(amount, totalReceived)
ExternalDepositSynchronized(amount, totalReceived)
GraduationActivated(token, poolId)
PocketConverted(...)
ResidualClaimed(amount, residualSpent)
```

**Pure functions** — check the arithmetic yourself:

```
rangeAllocation(total, start, end, denominator)   your exact share of any amount
leafHash(cohortId, slotIndex, count, npubRaw, wallet)   your exact leaf
```

### Five checks, and what each one actually proves

| Check | Proves |
|---|---|
| `RootsSealed` emitted | membership can never be changed again |
| `campaignConstitutionHash` equals the published constitution | the rules on chain are the rules published |
| fee share `getClaimers()` is `[Distributor]` at 10000 | fees cannot reach anyone else *from Bags' side* |
| `operatingFeeBps` ≤ 1000 and immutable | the service cut cannot be raised on you |
| your leaf verifies against a sealed root | your share is committed and computable |

## Off-chain — the evidence chain

Every step is reproducible from public signed events:

```
signed enrollment events → deterministic snapshot and cutoff → cohort selection law
  → canonical roster → wallet binding → evidence manifest → Merkle root
  → finalization → seal
```

## In a browser — the explorer

Rebuilds the roster from published evidence and reports **four independent
verdicts**, because collapsing them is how a false assurance gets manufactured:

- **root recomputation** — reproduced, divergent, or insufficient
- **destination-proof coverage** — how many payout addresses were actually proven
- **per-member binding status**
- **finalizable under current law**

A reproduced root **does not** mean every destination was proven. Those are
different questions and the explorer refuses to merge them.

It runs from a domain we do not control, and from a file on your own machine.

## What verification cannot tell you

That Bags will not rewrite the fee configuration. That the token will be worth
anything. That a market route will be available when you claim — your entitlement
is preserved, not your exit price.

---

# Part VII — Fixed, chosen, and never changeable

| Frozen when the campaign is authored | Chosen at deployment | Never changeable by anyone |
|---|---|---|
| cohort sizes and bps ranges | the Distributor's parameters | the split, once deployed |
| the economic preset | operating fee and recipient | the bound token, once bound |
| the observer policy and its hash | partner recipient | a finalized root |
| chain and domain | root finalizer | the finalizer, once sealed |
| verifier and schema versions | minimum claim | anyone's entitlement, ever |

---

# Part VIII — The v1 boundary

`BERMLAUNCH-SCOPE.md` is the frozen scope: 14 components, 20 explicitly
out-of-scope items, 4 invariants. Everything marked **[roadmap]** here is
mechanism the contract supports and the v1 constitution does not configure.

The four invariants, because they outrank every use case above:

1. **No address enters a payout list without proof of control.**
2. **Nothing renders as verified that was not verified.**
3. **Entitlement does not expire and cannot be swept.**
4. **Claiming never requires our website, our account, or our permission.**

A feature that would break one of those does not ship, however good it is.
