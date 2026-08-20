# Opus review — CORE_RC R3 Functional Checkpoint Relay Pack R4

**Pack SHA-256** `4197c97c73533631f88acde568f653694f711c3918fff03eefff5dbc13e3767c`
**Branch** `build/bermlaunch-bags-bindlaunch-constitution-anchor-r1` · **HEAD R** `1e1bb2027a2c1729ab906cf90758ed9aa4958011`

**Manifest: 435/435 verified.** Two files on disk are unlisted, and both are the
manifest itself. No mismatches, no omissions.

---

## §0 · Method, and what it excludes

Same evidence rule as `bags/CANARY-READINESS.md` §0: **no claim enters this document
unless it was produced by running something.** Everything in §1 and §2 was executed
against the pack's own sources in a clean sandbox, or read at `file:line` from
`current_relevant_source_snapshot/`.

**§4 is opinion and is labelled as such.** It contains no findings. Nothing in it
should be treated as a defect claim.

**What I have not seen:** the 209-case matrix. §4.2 proposes a method for collapsing
it and cannot be a verdict on its contents.

---

## §1 · VERIFIED by execution — what holds

### 1.1 The fail-open class is closed, and closed above the bug

I re-ran the historical attacks against this build rather than reading for them:

```
C1  caller-supplied trustedObservation, null policy    -> THREW
C2  caller-supplied trustedObservation, empty policy   -> THREW
C3  populated policy, no receipts, pre-attached obs    -> THREW
C9  attacker-supplied sequence 99 reaching the leaf    -> THREW
      all four: pre_normalized_verified_enrollments_are_not_production_authority
C10 zero enrollments, production compile               -> raw_signed_enrollment_records_required
```

`compileEnrollmentRoster` (`enrollmentRoster.js:252`) rejects **any** caller-supplied
`verifiedEnrollments` or `observationReceipts` unconditionally. The only production
path is `rawEvidenceRecords`, which re-derives every signature from raw evidence. An
empty or absent observer policy throws `observer_policy_required` (`:142`).

**This is stronger than the fix that was asked for.** C1–C9 were specific bypasses;
what shipped removes the category — caller-normalised records cannot reach a
production compile at all. It is the P-04 principle implemented rather than asserted.

### 1.2 Frozen law, checked value by value

| Anchor | Result |
|---|---|
| Constitution canonical bytes | **1,862** — exact |
| Constitution SHA-256 | **`baef1dbfcc212379f9e66addf474c5cba1f48547783c64db97be66bb44e4995a`** — exact |
| Cohorts | 50 / 100 / 300 |
| Cumulative ranges | 0–2000 · 2000–4000 · 4000–6000 |
| Economic preset | `BERM_STANDARD` 6000 / 4000, `mutable_after_launch: NO` |
| Presets available | `COMMUNITY_FIRST` 7500 · `BERM_STANDARD` 6000 · `BALANCED` 5000 |
| Operating fee cap | `operatingFeeBps_ > 1_000` reverts (`:182`) |
| Chain | `block.chainid != 4663` reverts at construction (`:181`) |
| Deployment binding | `DISTRIBUTOR_SELF_ANCHOR` v1 |

### 1.3 Allocation arithmetic — zero dust, proven

`rangeAllocation` (`:436`) telescopes exactly. Executed against a deliberately
awkward total (`123456789012345678901` wei) across all three presets:

```
community=7500  allocated == total   diff=0
community=6000  allocated == total   diff=0
community=5000  allocated == total   diff=0
```

### 1.4 Two structural properties worth stating plainly

**The creator provably cannot reach community BPS.** `creatorTotal` (`:403`) is
`rangeAllocation(received, communityBps, BPS, BPS)` — the residual range begins
*above* the community share. Unfilled slots strand in the contract; they do not
become creator upside. This is D-01 / BL-04 enforced in the contract rather than in
prose.

**The Founding roster is committed at deployment and unreachable afterwards.**
`prelaunchRoot_` is a constructor argument (`:166`, `:199`), and
`finalizeCohortRoot` accepts only `GRADUATION` and `FOMO` (`:254`). No authority can
alter cohort 0 after deployment — including the finalizer.

**Consequence for sequencing: Founding enrollment must complete before deployment.**
That is not a preference; it is what the constructor requires.

### 1.5 Merkle construction

`leafHash` (`:445`) prefixes `0x00`; `_verifyProof` prefixes internal nodes `0x01`.
Sorted pairs with domain separation — correct against second-preimage confusion
between a leaf and an internal node.

### 1.6 Live chain evidence

Three Robinhood fork tests pass unsandboxed, including
`testForkAtomicLaunchRollbackWhenAdapterRejectsPool` (atomic revert on a real fork)
and `testForkFactoryCreatePinsPoolAndExposesFeeShareOwnerBlocker`. Foundry full
suite 30/30, native Distributor 27/27.

### 1.7 The enrollment preimage is settled by implementation

`evmProofMessage` (`enrollmentProtocol.js:302`) implements the **R2 canonical-JSON**
form. `spec/LAW-OWNERSHIP.md` assigns the enrollment wire contract to the BermLaunch
lane, so **this build is authoritative** and the berm-side
`berm.enroll.v2\n<campaign>\n<mode>\n<npub>\n<evm>` form is the one that must change.
The divergence I flagged as blocking is decided; only conformance remains.

---

## §2 · FINDINGS

Each is anchored and reproducible. Severity is my assessment; the facts are not.

### F-01 · `claimBuyback` is sender-bound — decide before deployment · **BLOCKING**

`BermRobinhoodDistributorV01.sol:321`

```solidity
if (msg.sender != wallet) revert Unauthorized();
```

Every claimant must hold native gas at the address in their leaf. Under Path A that
address is the **derived pocket** — an address that has, by construction, never held
anything. A supporter arriving to claim finds an empty account and no way to fund the
transaction except an exchange withdrawal or a transfer they must arrange first.

**Why it is time-boxed rather than merely open:** the Distributor is immutable once
deployed. If it ships sender-bound, that campaign is sender-bound forever. There is
no retrofit and no upgrade path.

**Not a defect** — sender-bound is a defensible choice. It is a **one-way door that
is still open**, and this pack is the last checkpoint before it may close. §3 is the
alternative, specified.

### F-02 · `member_count` is unchecked against contract law · **HIGH**

`memberCount(uint8)` (`:396`) is `public pure` and returns only 50 / 100 / 300.
`compileEnrollmentRoster` takes `cohortBundle.member_count` verbatim
(`enrollmentRoster.js:250`) and embeds it in every leaf. **No gate compares them.**

Executed:

```
member_count  50 -> 0x1f3cac7a6068c97d471dca0e7fad8d43e1cf8743618da5261b15245587619bea
member_count  30 -> 0x43e267bf648a8b5fa9ffa1f35cecd7ee9e60a88094a10ed97212c3caa6f5912e
member_count 100 -> 0xac30cebb932dba0dfc1c21d3315ca45cde5efca011f9fd8373ccca6334ee9dbc
```

A roster built with any other value produces leaves and a root that **no proof can
ever verify on-chain**. Nothing fails at compile time, at finalization, or at seal.
The first symptom is `InvalidProof` for every member, discovered at the first real
claim — after the root is immutable.

**Fix.** Assert `member_count === {0:50, 1:100, 2:300}[cohort_id]` in the compiler,
and assert the constitution's `cohort_law` agrees. Two lines, and it converts a
silent permanent failure into a loud early one.

### F-03 · Under-fill has no honest path, and it strands the finalizer · **HIGH**

Because `memberCount` is fixed and `count` is inside the leaf, a GRADUATION roster
must contain **exactly 100 leaves**. If 40 people enroll, the only way to finalize is
to pad with 60 provably-unclaimable leaves.

That padding may well be correct — the value strands, which is the intended outcome —
but **the padding law is written nowhere.** It would be invented under pressure, by
whoever is finalizing, at the moment it matters most.

The second-order consequence is worse. `sealRoots()` (`:262`) requires **all three**
roots and all three evidence hashes to be non-zero. If FOMO never reaches 300 and no
padding law exists:

- cohort 2 is never finalized
- `sealRoots()` can never be called
- **`rootFinalizer` is never retired**
- *"after sealing, no privileged actor remains"* never becomes true

This directly contradicts the ruling *"an unfilled cohort is a smaller cohort"*
(`BERMLAUNCH-SCOPE.md` BL-07, §16). Either the padding law is written down, or the
scope ruling is wrong. It cannot stay as it is.

**Fix.** Write the padding law: what occupies an unfilled slot, why it is provably
unclaimable, and how the explorer renders it. Then state that sealing is reachable
regardless of fill.

### F-04 · `RootsNotSealed` is declared and never thrown · **MEDIUM**

`:68` declares the error. No code path throws it. `claimBuyback` does **not** gate on
`rootsSealed`.

**I believe the contract is right and my own spec is wrong.** `BERMLAUNCH-SCOPE.md`
BL-11 lists `RootsNotSealed` in its must-fail set. Enforcing that would lock Founding
claims behind cohorts that may never fill — F-03's failure mode, with the money
inside it. Claiming per-cohort as soon as that cohort's root is set is the safer
design.

**Two owed actions, in different repositories.** Codex: remove the dead selector or
use it. Me: correct BL-11, which I will do on your confirmation.

### F-05 · The observer is one key with rotation disabled · **MEDIUM, disclosure**

`campaign-constitution.v2.canonical.json`:

```json
"observer_policy": {
  "observer_pubkeys": ["0x3bb03660430c43f7e3b68acf00fe692b5ed6703cc808d7a7503b3536381180fe"],
  "rotation_supported": false,
  "version": "OBSERVER_POLICY_STATIC_V1"
}
```

This was an OPEN decision — owner, quorum, rotation, SLA — and it has been resolved
as the most fragile available shape. If that key is lost or compromised, no further
observation receipts can be produced, so **GRADUATION and FOMO can never be
finalized**, which lands in F-03's terminal state.

Not necessarily wrong for a canary. But it is a trusted party with a single point of
failure and no recovery, and it belongs in `SOVEREIGNTY.md` at the same rank as the
Bags rows — stated, not defended.

### F-06 · Dead code retaining the closed vulnerability's shape · **LOW, hygiene**

`recordsWithTrustedObservations` (`enrollmentRoster.js:107`) is defined and called
nowhere. It is the function that accepted caller-supplied observations. A dormant,
compiling copy of a closed bypass is a re-introduction hazard: a future refactor that
reaches for it restores C1–C9 without touching the guard that closed them.

**Fix.** Delete it. If it must survive for reference, it belongs in the test tree
asserting that it is *not* reachable from a production path.

### Not a finding, but nobody has written it down

Cohort boundaries are hardcoded equal thirds of the community share —
`_cumulativeCohortBps = mulDiv(selectedCommunityBps, boundary, 3)` (`:432`). It is
not a constitution parameter, and it matches frozen law exactly for `BERM_STANDARD`.

The number this produces should be on the Founders page:

| Cohort | Slots | Per slot, permanently |
|---|---|---|
| Founding | 50 | **0.40% of all trading fees** |
| Graduation | 100 | 0.20% |
| Momentum | 300 | 0.067% |

**A Founding slot is 6× a Momentum slot.** That is the conviction ladder as an actual
figure, and it is more persuasive than any paragraph about it.

---

## §3 · The gasless claim, specified

Addressing F-01. This is a design proposal, not a defect claim.

### 3.1 Why not simply make the claim permissionless

`harvest()` and `syncExternalDeposit()` are permissionless because their destinations
are immutable and **no price is involved**. `claimBuyback` executes a swap. A fully
permissionless claim would let a stranger choose *when* someone's conversion happens
and with what `minTokensOut` — a griefing surface, and the reason claim cannot simply
inherit harvest's reasoning.

### 3.2 The shape that fits

The member signs the claim parameters off-chain; **anyone submits**. The contract
recovers the signer and requires it to equal the `wallet` already inside the leaf.

```solidity
function claimBuybackWithSig(
    uint8 cohortId, uint32 slotIndex, bytes32 npubRaw, address wallet,
    bytes32[] calldata proof, uint256 minTokensOut, uint256 deadline,
    uint256 nonce, bytes calldata signature
) external nonReentrant returns (uint256 tokensReceived);
```

- EIP-712 domain bound to `campaignId`, `block.chainid` and `address(this)`
- signed struct covers **every** parameter, including `minTokensOut` and `deadline`
- recovered signer **must equal `wallet`** — the same address the Merkle proof
  already commits to
- a per-identity `nonce` prevents replay of a signature after a partial claim
- proceeds go to `wallet`, exactly as today; the submitter receives nothing

**No trusted forwarder, no EIP-2771, no new authority.** The leaf address is already
the verifying key and it is already sealed in the root. The relayer chooses nothing
and pays only for block space.

### 3.3 Three rules it must obey

1. **Additive, never exclusive.** `claimBuyback` stays exactly as it is. If it were
   replaced and no relayer ran, entitlement would be unreachable — a sweep by
   neglect, which invariant 3 forbids.
2. **Anyone may relay.** If the only working relayer is ours, claiming requires our
   permission, which invariant 4 forbids. The function must not check the caller at
   all.
3. **Gas is funded from the operating fee.** It exists to pay for service, it is
   capped at 1000 bps, and it is immutable — so it cannot grow to swallow what it
   sponsors. **Never the community's 6000 bps**, consistent with the UC-13 ruling.
   Taking gas from claim proceeds is possible but makes the claim amount
   unpredictable and needs its own cap and disclosure.

### 3.4 Alternatives, and why they are second

**EIP-7702** would sponsor the derived EOA with no contract change. Modern and
well-suited — but I have **not verified** that Robinhood chain supports it, and it
grants the pocket more capability than the task needs. Worth checking; not worth
depending on.

**A gas drip** — push dust to a pocket when its entitlement first becomes claimable.
No contract change, works today, near-zero cost. But it is operational, it is a
heuristic, and it fails for the person who arrives in three years when nobody is
running it. Acceptable stopgap, wrong foundation — and the late arrival is precisely
the person this product exists for.

### 3.5 The decision, stated as a decision

**If `claimBuybackWithSig` is not in the deployed bytecode, it never can be.** Adding
it costs a function and a nonce mapping now. Omitting it costs nothing now and cannot
be undone. That asymmetry is the entire argument.

---

## §4 · MY VIEW — opinion, not findings

Everything above is reproducible. Everything below is judgement, and should be argued
with rather than implemented.

### 4.1 What this pack actually changed

The defect class that has dominated every review since the R1 sealed pack is closed,
and closed at the right altitude — not patched instance by instance, but made
structurally unreachable. That is the difference between a fix and an architecture,
and it is worth saying plainly because it has not been true before.

What remains is smaller and differently shaped: two decisions (F-01, F-05), one
missing law (F-03), one missing assertion (F-02), and two lines of cleanup (F-04,
F-06). None of them is research. All of them are closable in days.

### 4.2 On the 209 — a method, since I have not seen the list

I have not read the matrix, so this is a way to shrink it, not a claim about what is
in it. Run every open case through three questions **in this order**:

**One — is it a one-way door?** Constructor arguments, the constitution hash, the
PRELAUNCH root, the observer policy, the claim path, the Bags claimers fixed at
`create_fee_config`, a sealed root. These are the only cases where being wrong is
unrecoverable. My expectation is that this set is **under twenty**, and it is the
only set with a real deadline.

**Two — does it serve the first fifty, or strangers?** The entire
`ncryptsec` + signer-application + `postMessage` + ROR + `rpIdFromOrigin` block exists
so that someone with no Nostr key can enroll. NIP-07 and NIP-46 are **built and tested
today**. Fifty founding supporters recruited personally can bring their own signer.
Every case downstream of "a stranger with no key arrives unaided" is a **platform**
case, and the opening is a **campaign**.

**Three — is it a decision or a build?** Decisions cost an afternoon and usually
unblock several cases each. Builds cost weeks and usually unblock one. My expectation
is that the decision backlog is doing most of the blocking, and that 133 is not 133
independent items but roughly five clusters plus a handful of unmade rulings.

**The test of whether this is right:** if partitioning the 209 this way does not
collapse it substantially, the reframe is wrong and I would rather know that than
have it politely adopted.

### 4.3 What I would do next, in order

1. **Rule on F-01.** It is the only item with a hard deadline attached to an
   irreversible event.
2. **Close F-02.** Two assertions against a silent permanent failure — the best
   effort-to-risk ratio on the page.
3. **Write F-03's padding law.** Not code. A paragraph that stops it being invented
   under pressure.
4. **Rule on F-05**, and disclose it either way.
5. **Delete F-06 and F-04's dead selector.** Minutes.
6. **Then partition the 209** and re-cost what is left.

### 4.4 The thing I would not defer

The fail-open defects are closed and should stay closed. If any later simplification
reintroduces a path where caller-supplied data reaches a production compile, that is
not a scope decision — it is invariant 2, and it is the credibility of everything
else. §4.2 is about deferring **platform** work. It is not about deferring correctness.

---

## §5 · What this review does not authorize

No deployment, beta, canary, public release, or Explorer authorisation. No
implementation. No reduction of fail-closed behaviour anywhere.

The pack's own `REPORT.md` declares its non-closure without being asked: no S/A/B
evidence commits, the 209-case matrix not started, and production PASS still
fail-closed pending reviewed Bags runtime code hashes and real same-block
Controller/Distributor/Bags readback. `EXCLUSIONS.md` records that a fork log was
redacted because it printed an RPC endpoint.

**That is the behaviour a pack should have**, and it is the opposite of the sealed R1
that was manifest-clean, honestly self-classified, and still shipped an undisclosed
bypass. It is worth acknowledging directly.
