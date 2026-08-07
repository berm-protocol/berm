# @berm/bags

Fee continuity for Bags launches. Not an integration with Bags — a fix for the
identity fragility a Bags launch inherits.

```bash
npm ci
npm test          # 181 assertions, offline, no API key
npm run build     # the dispute screen → dist/dispute.html
npm run verify    # 26 browser checks, mostly about what it refuses to say
npm run probe     # read-only; needs BAGS_API_KEY
```

## The problem

Bags lets a token launch assign fee shares to a **social handle** rather than a
wallet. The SDK resolves it:

```
sdk.state.getLaunchWalletV2({ provider: 'twitter', username: 'alice' })
GET /token-launch/fee-share/wallet/v2  →  a Solana wallet
```

That is a binding from a **mutable string** to a claim on money. Handles get
renamed, abandoned, suspended, and re-registered by strangers — the same
fragility as a NIP-39 claim, except the stake is a revenue stream rather than a
badge.

Three failure modes, none exotic:

| | What happens |
|---|---|
| **Renamed** | `@alice` → `@alice_eth`; the old binding is dead or pointing at whoever takes `@alice` next |
| **Suspended** | The creator cannot demonstrate the handle was theirs — the proof lived on the account that is gone |
| **Re-registered** | Someone else holds `@alice` and has a plausible claim to a revenue stream they did not earn |

## The fix

No new mechanism. The creator's durable identity is their npub; the handle is a
*claim* attached to it, with a proof archived by a neutral third party **before**
any dispute.

```
npub ──verified claim──▶ @handle ──Bags──▶ fee wallet
  └──────── archived proof, third-party timestamp ────────┘
```

When the handle dies, the npub and the archive survive.

**Three grades, and the middle one is where most creators actually are:**

| Grade | Requires | What survives handle loss |
|---|---|---|
| `anchored` | verified claim **+** archived proof **+** immutable account id | You can demonstrate, from an archive nobody involved controls, that this key held the handle and when |
| `claim-only` | verified claim | Nothing. The proof disappears at the moment you need it |
| `none` | — | Nothing connects the fee share to a key you hold |

`summarise()` reports the number that matters to a launch operator: **what
percentage of the fee split depends on a handle alone.**

## What this does NOT do

It changes nothing on Bags' side. It cannot move a fee wallet, re-point a claim,
or touch a chain. It produces **evidence** and a signed, publishable record.

Whether Bags honours that evidence in a dispute is Bags' decision — the same
honest limit as guardian rotation, and it should never be described as anything
stronger.

The approval prompt says so out loud, and a test enforces it:

> Publish a public record linking @alice and this key to a 25% fee share.
> **This is evidence, not a transfer — it moves no funds and changes nothing on Bags.**

Anyone signing an event near a token launch must not think they are authorising
a payment.

## Checked against the spec, and one claim we had to withdraw

**Checked.** Every path, parameter, enum and field in `src/bags.ts` is transcribed
from Bags' published OpenAPI specification (`docs.bags.fm/api-reference/openapi.json`,
read 2026-08-03) and pinned in `test/spec.test.ts`. The spec check corrected four
things:

| We had | The spec says |
|---|---|
| `/token-launch/fee-share/wallet/v2` | `/agent/v2/fee-share-wallet` — **and the spec is wrong, see below** |
| three providers | eleven, including `solana`, `tiktok`, `instagram` |
| no chain parameter | `chain=SOL\|EVM`, default `SOL` — one handle, two wallets |
| account id needs X OAuth | the response carries `platformData.id` for an API key |

**Withdrawn.** This file previously said the endpoint was verified, because a
dummy key returned a clean `401` rather than a `404`, and reasoned that *"a 404
or 400 would have meant the path or header was wrong."*

That inference does not hold. We were calling a path that **does not exist** and
still got `401`, which means authentication is evaluated before routing. A `401`
proves the host and the header and says nothing whatever about the path. The
check could not have failed, which is exactly why it did not — and a check whose
pass condition is also satisfied by the failure case is not a check.

Both the probe and the client used to carry their own copy of the path, and both
were wrong. There is one copy now, in `src/bags.ts`, and a test asserts the probe
imports it rather than restating it.

**The account id, and why it does not raise a grade.** `platformData.id` is the
field that does not move when a handle is re-registered, and it arrives with
nothing but an API key — so the immutable identifier we thought needed an X
developer app is simply in the response. It is still Bags' record of what a
platform said at a moment this response does not timestamp. So it is carried,
displayed, and used to detect a **conflict** with the binding's own account id —
which is the loudest thing the record can say, because it means the account being
paid and the account we hold evidence for are different. It never upgrades
`claim-only` to `anchored`. Founding a grade on a third party's cache is
manufacturing confidence, which is the one thing this package exists not to do.

## Probed live, 2026-08-04 — and the spec check was the error

A real key, GET requests only. Six things came back, and the first one reverses a
correction this file was proud of.

**The path we "fixed" was the broken one.** `/agent/v2/fee-share-wallet`, taken
from the published OpenAPI specification, returns a routed 404 on the live host.
`/token-launch/fee-share/wallet/v2` — the path we modelled from prose and then
replaced — returns 200 and a wallet. A published specification is evidence about
intent, not about deployment. Where they disagree the running service wins, and
only a request tells you which is which.

Worse, `test/spec.test.ts` had pinned it: it asserted the spec path **and kept the
real path as a negative** "so a revert is loud". A correct fix had to delete an
assertion to land. A test written from the same source as the code checks
transcription, not truth.

**Q1 — a handle resolves for anyone.** `@jack` → `AeNScctZsCb4ayKFAD2M1MXfobuPoEJfgn3Ka3PiEmai`,
with `platformData.id` `12`. No onboarding required.

**Q2 — a handle with no wallet returns 404** and `{"success": false, "response":
"Fee share wallet not found"}`. Clean, and distinguishable from an error.

**Q3 — resolution is case-INSENSITIVE.** `@JACK` and `@jack` return the same
wallet and the same `platformData.id`.

**Q5 — yes, `chain=EVM` returns a different wallet for the same handle.**
`@jack` on EVM is `0xf42513c915c2aB0D66113daE849204BD5940dd9f`. One handle, two
claims on money, and a fee split that names a handle does not say which.

**Q4 remains open.** It needs a handle known to have been renamed.

### The finding that stops a design

**`provider: 'solana'` lowercases the address, and base58 is case-sensitive.**

```
in    7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
out   7xkxtg2cw87d97txjsdpbd5jbkhetqa83tzrujosgasu   200 success:true
```

The returned string still decodes to 32 valid bytes, so nothing errors anywhere.
It is a different public key, and nobody holds its private key. Fees assigned
there are unrecoverable by anyone, including Bags.

Garbage is rejected — `notanaddress` returns 404 — so there **is** validation. It
runs after the lowercasing, on a string that is always still valid base58, because
only 34 of the 58 base58 characters change under `toLowerCase()` and none of them
become illegal. The check cannot catch this.

There is no grinding around it either: an all-lowercase-safe 44-character address
turns up about once in 10^10 derivations.

**So naming a PDA as the Bags fee claimer is NOT established.** This endpoint is
the only public candidate for pointing a fee share at a raw address, and it
mangles it. Until Bags confirms a case-preserving route, an ingress-PDA design has
no way in. `feeShareWalletUrl` now throws on a mixed-case `solana` username rather
than warning, because the response to a mangled address is a clean 200 with a
plausible wallet and nothing downstream can notice.

Ask Bags. Do not test this with a live launch.

## Still unverified, and only a key can settle it

Behaviour, not shape. Run `probe.mjs` with a real key:

- **Q1** Does a handle resolve for anyone, or only after onboarding to Bags?
- **Q2** What comes back for a handle that does not exist?
- **Q3** Is resolution case-sensitive?
- **Q4** Does a **renamed** handle resolve to the old wallet, a new one, or
  nothing? *This decides whether fee continuity is a live problem or a
  theoretical one.* Needs a handle known to have changed.
- **Q5** Does `chain=EVM` return a different wallet for the same handle?

Record the answers here.

**The partner mechanism DOES work on Solana — an earlier version of this file
said it did not, and that was wrong.**

The mistake: the Solana fee-share *config* endpoint has no partner field, and I
read that as the partner mechanism being EVM-only. Partner is configured
**separately** — you create a partner key (a PDA, one per wallet) and pass
`partner` + `partnerConfig` at launch. It never appears in the fee-share config,
so its absence there means nothing.

Per `how-to-guides/create-partner-key`: *"a partner key receives 25% (2,500 bps)
of the fees generated by tokens launched via that partner key."* Custom
percentages require contacting Bags.

**Still unresolved, and it is the difference between a business and a rounding
error:** whether that 25% is taken from Bags' own share or from total fees. On
the EVM side the docs are explicit — the partner cut comes out of the protocol
half and *"the creator half is never shared with partners."* The Solana page does
not restate that. Until it is confirmed, treat it as unknown whether a partner
fee costs the creator anything, because that decides whether launching through a
partner key is free for the creator or paid for by them.

## How far this can go, honestly

| | Status |
|---|---|
| Model the resolution, validate splits locally, build continuity records | **done, tested offline** |
| Confirm the endpoint exists and accepts our request shape | **done** |
| Answer Q1–Q3 and Q5 against the live API | needs an API key. Read-only, free |
| Answer Q4 | needs a renamed handle to test against |
| Launch a token end to end | **mainnet only — no devnet is documented.** Real SOL, real money, and out of sequence |

The agreed order was protocol → product → pitch Bags → then token. Building
launch plumbing now would be building the fourth step during the second.

What is worth having for the pitch is the **demonstration**: a creator whose fee
claim survives losing their X account. That is one screen, and it is the thing
Bags cannot currently offer anyone.

## The subscription event

The one format that has to be right on the first subscriber. Everything else here
can be fixed by shipping a new version; this cannot. A field missing from the
signed event means going back to every subscriber and asking again, and the ones
who have drifted away never answer.

```
kind    30078                       addressable, so the record is replaceable
d       berm:subscribe:v1:<campaign>
tags    campaign, chain=solana, address, alt, handle?
content the full disclosure, verbatim, so it travels with the signature
```

**A Nostr identity is secp256k1 and a Solana address is ed25519.** An npub is not
a Solana address and you cannot send an SPL token to one. So the subscription
carries both under a single signature, or the payout list is a set of identities
with nowhere to pay.

**Membership and payout address are deliberately not the same field.** Membership
is who was early: established once, snapshotted, never edited. The address is
where to send: current and replaceable, because people lose wallets. Conflate
them and a subscriber who changes wallets loses their place in a queue they
already joined.

**`created_at` never orders anybody.** It is set by whoever signs — a claim about
time made by the party whose timing is in dispute, which is exactly what
`dispute.ts` refuses to score. `snapshotMembers()` sorts by npub, so the same set
produces the same snapshot no matter what order events arrive in and no matter
what timestamps they assert. Ordering comes from published snapshots archived by
a third party, one layer down but the same argument.

**A subscriber count is a count of keys.** Keys are free, so N proves who was
early and proves nothing about how many humans that is. `describeSnapshot()`
says so in the output rather than leaving the reader to infer it, and reports
payout addresses named by more than one key without pretending to know whether
that is one person or several.

**The address is validated at signing, not at payout.** A typo found at payout is
a token sent somewhere unrecoverable, months after the person who could have
fixed it stopped paying attention. The base58 decoder is checked against real
mainnet addresses — its first draft passed every synthetic fixture and rejected
wrapped SOL.

**What the signer shows is the whole disclosure**, not a link to it: no money
moves in either direction, a gift for showing up early rather than payment for
work, and not guaranteed to be worth anything. A test asserts the text never
mentions price, value or return — describing the mechanism is arithmetic, and
predicting the outcome is the one sentence that would make this something else.

## The campaign: schedule in, root out

A batched campaign has to say who was in which batch. The obvious answer — read
`created_at` — is wrong for the reason two other files here already establish:
that field is set by the signer, so it is a claim about time made by exactly the
party whose timing decides their payout. Backdating would be free.

**So batch membership comes from observation, not assertion.** At each batch close
you publish a snapshot of the set as it stood. Batch 1 is the first snapshot;
batch 2 is the second minus the first. Subscribers never un-subscribe, so each
snapshot is a superset of the last and the differences are exactly the batches.

A backdated timestamp then buys nothing: you are in the batch where you were first
**seen**, and nothing you sign changes what was already published.

**The attempt is counted anyway.** `claimedBeforeFirstSeen` reports subscriptions
whose asserted time precedes the snapshot they first appeared in — reported, never
acted on, because acting on it is precisely what would make backdating worth
trying. A rising count means people are trying it *or* relay coverage is poor, and
both are worth seeing.

**What it costs, stated plainly:** a subscription sitting on a relay nobody queried
is not in the snapshot. That is a real way to be unfairly late. The defence is
coverage — query many relays, publish which — not a claim that it cannot happen.

### The cap and the carry

A tiny first batch would hand two people ten percent each: honest, deterministic,
and guaranteed to be read as insiders forever. So `perPersonCapBps` bounds any one
share, and what a batch cannot use carries to the next. An empty batch keeps
nothing and passes its whole pot on.

Whatever the last batch cannot use is **residue**, and `ResiduePolicy` is required
with no default. It is a policy question the code refuses to have an opinion on —
and equally refuses to leave unstated, because an undeclared residue is a decision
somebody makes later, in public, under pressure, which is the exact situation a
pre-committed schedule exists to prevent.

### What it does not do

**Nothing here launches anything.** No key, no transaction, no network call — a
test reads the source and asserts the absence of `fetch(`, `Keypair`,
`signTransaction`, `sendTransaction` and `WebSocket`. A countdown reaching zero
cannot launch a token, because the Bags flow ends in *sign and broadcast* and
signing needs a key somebody holds. The schedule is the human-facing part; the
root published at the close is the enforcement.

## The distribution commitment

One hash that anybody can rebuild. Publish the root; a stranger fetches the same
subscriptions from relays, runs the same snapshot, builds the same tree, and
compares. A mismatch means the published list is not what the relays support —
checkable without anyone's cooperation.

`reconcile()` does exactly that and names both sets: who is on relays and absent
from the list, who is in the list and absent from relays. It does **not** deliver
a verdict, because a root can differ from a late subscription or a relay that was
down as easily as from an omission, and a test asserts the wording never says
fraud, stole, cheated or lied.

**This does not enforce anything.** It is the checkable version, not the enforced
one — the same distinction [`chain/`](../chain) draws. A Solana program verifying
these proofs against a root in a PDA makes it enforcement later, and the data
model does not change when it does. That is why this half is worth building
first: useful immediately, thrown away never.

**The trust hinge that survives**, stated rather than hidden: somebody publishes
the root, and that somebody could leave people out. What the design buys is that
the omission is provable by a stranger in one command, because every input is
public and the computation is deterministic. Detection, cheap and mechanical.

### Three ways Merkle implementations get this wrong

| Attack | What we do instead |
|---|---|
| **Second preimage** — present an internal node as a leaf | leaves hashed with a `0x00` prefix, nodes with `0x01`, so the two spaces are disjoint |
| **Odd-node duplication** (CVE-2012-2459) — padding a level by repeating the last node lets two different leaf sets share a root | an odd node is **promoted unchanged** |
| **Ambiguous leaf encoding** — `("npub1a","Xyz")` and `("npub1","aXyz")` concatenate identically | every field is length-prefixed, unambiguous by construction |

`verifyProof()` takes an **entitlement**, never a pre-computed hash, so there is
no argument through which a caller could inject a raw node hash and have it
verified as a leaf.

**Amounts are `bigint`**, so nothing rounds at the 53-bit float boundary, and the
remainder integer division cannot split is reported as `dust` and left in the
vault. Pushing it onto "the first member by sort order" would be deterministic
and would also be a silent decision that somebody gets more.

**An independent implementation is part of the test suite.** The scheme is
rebuilt from the prose in `merkle.ts`'s header using `node:crypto` and a
different structure, and the roots are compared across eight tree sizes. If that
ever fails, either the code changed or the description stopped describing it —
and both are the same bug, because a commitment nobody can reproduce is not a
commitment.

## The dispute screen

`npm run build` produces one self-contained page: two parties claiming `@alice`,
one fee share, and what an operator actually has to go on.

It exists because everything above prepares evidence, and evidence is worth
having or it is decoration. The screen puts **what Bags can see today** beside
**what a continuity record adds**, because without that comparison a reader sees
a tidy record and feels no gap.

Four scenarios, and three of them are cases where we lose:

| Scenario | Verdict |
|---|---|
| Account suspended, handle re-registered | `demonstrable` — a neutral archive predating the re-registration |
| Creator verified but never archived | `unresolved`. A claim today says nothing about the past |
| A challenger archives the page today | `contested`. Earlier is stronger; two archives is a real conflict |
| Neither side archived anything | `unresolved`, and it says the operator gained nothing |

**The ranking rule.** Evidence is worth what its timestamp is worth, and a
timestamp is worth what the holder does *not* control. A capture by
`web.archive.org` beats any assertion made after a dispute began; a "proof"
hosted by the claimant proves they can write files. `NEUTRAL_ARCHIVES` is a short
allowlist rather than a heuristic — "looks like an archive" is not a property
somebody's revenue should rest on, and `isNeutralArchive` rejects
`web.archive.org.attacker.com`, which a substring check would accept.

**Possession is ranked last, deliberately.** In every failure mode this package
exists for, the wrong party is the one holding the handle.

**It never names a winner.** `adjudicate()` returns `demonstrable`, `contested`
or `unresolved` and an operator decides. A model that always produces a name
launders a guess into a verdict, and the person relying on it cannot tell the
confident case from the coin flip.

The browser suite is mostly negative assertions — that the page does not render
`demonstrable` without a neutral archive behind it, does not promise Bags will
honour anything, and contains no wording suggesting funds moved. A screen that
strengthens a claim on its way to the reader is this package's own failure mode,
one layer up, and no unit test that stops at the module boundary can see it.

**The scenarios are fixtures and the page does not pretend otherwise.** They
become real the moment there is a real npub with a real Wayback capture. A demo
that looked live would be the same overstatement in a nicer font.

## The distributor — specified, not built

[`historical/DISTRIBUTOR_SPEC_SOLANA_R1_HOLD.md`](historical/DISTRIBUTOR_SPEC_SOLANA_R1_HOLD.md) is a Solana program written down
before any Rust exists, so it can be attacked while attacking it is still cheap.

**The party it defends against is the launching developer.** That is unusual and
it is the whole point: if a dev can withhold a community's share, a launchpad
built on this is a nicer way to make unenforceable promises, and the promise was
the only part with value.

The mechanism, from Bags' published IDL: `claim_user` takes `payer` and `user` as
**separate** signers, and claimers are plain pubkeys in the config — never signers
at registration. So the fee claimer can be a PDA with no private key, and
`harvest()` can be permissionless — any subscriber pays the transaction fee and
harvests for everyone. The dev is not in the path and has nothing to withhold.

Two programs, split by what holds money: an **immutable distributor** that owns
the vault and pays against the root, and an **upgradeable harvester** that holds
nothing and cannot choose a destination. Upgradeable usually means custody in a
costume; here the coupling to somebody else's program interface lives entirely in
the half that touches no funds.

The index is inside the Merkle leaf for this spec's sake: an on-chain bitmap needs
one unambiguous bit per claimant, and an index that was passed alongside a proof
rather than committed inside it would let anyone set a stranger's bit and lock
them out permanently, for free.

**It came back HOLD.** An adversarial review returned 5 CRITICAL findings, and the
design as written does not deliver its own headline guarantee — the developer can
still redirect revenue by keeping the Bags `manager` role, and the harvester
cannot sign for the distributor's PDA at all, because PDA signing is
program-ID-bound. The spec now leads with those findings; §2–§8 are retained
unedited as the reviewed artifact.

Four of the findings were in **shipped TypeScript**, not just the document. The
worst: equal `claimedAt` values let relay arrival order pick a payout address, so
two honest parties could compute two different roots from identical data. That is
the one property everything else rests on. Fixed, with reproductions kept in
`test/review-r1.test.ts`.

Re-reading the IDL against the review then found something the review could not
have: `update_fee_config` answers to Bags' **program admin**, not to the manager,
and three `force_claim_*` instructions move a claimer's fees with no signature
from the claimer. Waiving the manager role does not reach any of it. So the
guarantee is stated at the size it holds — **the developer cannot redirect the
split; Bags can** — and that sits in the disclosure at the same rank as the tier-1
signer disclosure. A launchpad whose selling point is enforceable promises does
not get to hide who can still break one.

Which is the argument for publishing an unbuilt spec: intentions are cheap to
correct, and an immutable program holding other people's money cannot be corrected
at all.

[`historical/REVIEW_DUAL_CHAIN_R1_HISTORICAL.md`](historical/REVIEW_DUAL_CHAIN_R1_HISTORICAL.md) reviews a two-chain build
spec proposed on top of all this. Its cumulative range math is exact — verified
over 3,000 revenue values at both nesting levels, zero dust. Its Solana half is
blocked by the case-folding finding above. And two of its rules combine to strand
up to 40% of lifetime revenue permanently, which is the kind of thing that costs a
paragraph now and cannot be fixed after deployment at all.

[`ENROLLMENT-SPEC.md`](ENROLLMENT-SPEC.md) is the implementation handoff, with
[`vectors/pocket-address.json`](vectors/pocket-address.json) frozen alongside it —
10 vectors covering both y-parity branches, anchored on the fact that secret key
`1` derives to `0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf`, the canonical Ethereum
address for that key. An implementation that disagrees with that line is wrong and
needs no further debugging.

The ladder order changed from `POCKET.md`: paths are now ranked by **how little the
user ends up depending on us**, not by what they already have. Create-and-download
is the default, our own passkey signer is second with the exit signposted.

[`POCKET.md`](POCKET.md) is the enrollment design: sign once, and your pocket is
yours forever. A Nostr key is a secp256k1 keypair, so every npub has a canonical
EVM address that only that key can spend — verified over 300 keys, including the
BIP-340 odd-y normalisation. Enrollment therefore asks for a signature and nothing
else: no address field, no wallet, no way to lose a share by forgetting. And no new
cryptography in the contract, because the leaf still commits an ordinary address.

[`SOVEREIGNTY.md`](SOVEREIGNTY.md) — canonical R4 — is the disclosure that came out of it: every
layer, who can break it, and the two sentences no marketing copy may exceed. It
also specifies the **minimum shippable contract** — claim-only, no admin, no
sweep, no upgrade, epochs are deployments — which removes five of the six CRITICAL
findings by removing the machinery they were about. Berm is an app on Bags. Bags
is the trusted layer. That goes first, not in a footnote.

## Safety

`probe.mjs` issues GET requests and nothing else. There is no code path in this
package that builds a transaction, signs anything, or touches a wallet.

Keep the API key in a file, never in a shell history or a chat window:

```bash
echo 'BAGS_API_KEY=...' > .env.local     # gitignored
set -a; . ./.env.local; set +a
npm run probe -- @yourhandle
```

Sources: [Bags API docs](https://docs.bags.fm/how-to-guides/launch-token) ·
[bags-sdk](https://github.com/bagsfm/bags-sdk)
