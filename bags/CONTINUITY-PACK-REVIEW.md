# Review — `BERMLAUNCH_CURRENT_CONTINUITY_PACK`

**Subject** head `b609354632510fa5d15856bbc411047fdbfe459d`, branch
`build/bermlaunch-bags-bindlaunch-constitution-anchor-r1`, resealed
2026-08-12T08:13:59Z.

**Manifest 390/390 verified.** (The file uses a three-column `sha256 bytes path`
format with CRLF endings, so `sha256sum -c` cannot read it directly — not a defect,
but worth a one-line note in the pack so a reviewer does not report a false
failure.)

**My R2 explorer spec arrived intact** — `ae384fda…fb22` matches what I sent, byte
for byte.

---

## 1. The R1 blocking finding is genuinely closed. I reproduced it.

Not accepted on report — re-run against this pack's own campaign bundle:

```
--- production roster, zero enrollments ---
THREW (correct): missing_verified_enrollment:0xd0080df1…f103:0

--- historical unproven roster ---
root           = 0x30b9a0854070e881a66f9dc644a14f3d863fdbbb4e34052fd5e45a9a2156c1a2
classification = UNPROVEN_HISTORICAL
modes          = ["historical_roster_wallet_unproven_v0"]
finalizable    = [false]

--- portable bundle from historical roster ---
THREW (correct): portable_bundle_requires_verified_roster
```

`selectBindingForFinalization` no longer falls through to `currentWallet`; it
throws. The 50-member root still reproduces **bit-identically to the one I
reproduced in the R1 review** — but only through a separately named function,
classified `UNPROVEN_HISTORICAL`, `finalizable: false`, with the money path gated.

**This is better than either option I proposed.** I offered fail-closed *or* an
`allowUnprovenLegacy` flag. This keeps the historical root reproducible as forensic
evidence *and* makes it structurally unable to become money. Credit where it is
due.

Also genuinely good, and tested: `USER-SEQUENCE-GRIND` proves a user-declared
sequence loses to the observer sequence; `OBS-LATE` blocks a post-cutoff
observation; `OBS-TIE` gives a deterministic tie-break; `verifyObservationReceipt`
does real work — Schnorr verification, observer allowlist, campaign and chain
binding.

---

## 2. BLOCKING — the observer check has a passthrough, and the evidence runs the passthrough

`packages/sdk/src/enrollmentRoster.js:122`

```js
const trustedObservation = record.trustedObservation ?? receipts.get(record.eventId);
```

The left branch **never calls `verifyObservationReceipt`.** A caller-supplied
`trustedObservation` is accepted with no signature check, no observer allowlist,
and `observerPolicy` never consulted.

### Reproduced

Compiled a roster with `observerPolicy: null` and a hand-written observation
naming itself `receiptId: "self-made"`:

```
COMPILED with a self-supplied trustedObservation and NO observerPolicy
classification = PRODUCTION_VERIFIED_ENROLLMENT
receiptId used = self-made
```

An unsigned, unverified, self-declared observation produces a roster labelled
`PRODUCTION_VERIFIED_ENROLLMENT`.

### And the test suite depends on that branch

`e2e/supporter_enrollment_r2_closure.mjs:175` builds records as
`{ ...verified, trustedObservation: observed }`, and every `compileEnrollmentRoster`
call in that file passes `observationReceipts: []`. So the compiler's own
verification path — `receipts.get(...)` — is **never exercised**.

Proof: delete the passthrough, changing nothing else.

```
$ sed -i 's/record.trustedObservation ?? receipts.get/receipts.get/' …
$ node e2e/supporter_enrollment_r2_closure.mjs
Error: trusted_observation_required:0x3073bb3f…1036
    at recordsWithTrustedObservations (enrollmentRoster.js:119)
    at compileEnrollmentRoster (enrollmentRoster.js:202)
    at main (supporter_enrollment_r2_closure.mjs:277)
```

It fails at the **first** production compile. The suite proves the bypass works; it
does not prove the verification works.

Note line 281 passes `observerPolicy: { observerPubkeys: [OBSERVER…] }` — but with
`observationReceipts: []` the receipts map is empty, so the policy is applied to
nothing. It reads as enforcement and is inert.

### Why this is the R1 finding again, one layer up

`INDEPENDENT_REVIEW_R2.md:10` states:

> C-02: CLOSED. Ordering now uses signed `bermlaunch.enrollment_observation.v1`
> receipts, not user-declared event sequence.

True of the design. Not true of the enforcement, and the evidence certifying it
runs the unenforced branch. That is the same disease as
`legacy_roster_wallet_v0`: **a trust-establishing step with a passthrough, and a
green tick over the path that was not the one being claimed.**

Your own baseline audit already named the pattern — CBR2-007, *"Existing EVM tests
mock away the trust boundary."* This is its enrollment-side instance, and it is not
on the open list.

### Fix

Delete the `??` branch; require every record's observation to come from a verified
receipt. Then update the e2e to pass `observationReceipts` and let the compiler
verify them — which is the thing the review claims is happening. Add a negative
test: a receipt signed by a key outside `observerPolicy.observerPubkeys` must be
rejected at compile, not merely at `verifyObservationReceipt` in isolation.

**Severity note, stated fairly.** This is not a supporter-facing attack — the caller
is the roster builder. It is a *certification* defect: the compiler will stamp
unverified input `PRODUCTION_VERIFIED_ENROLLMENT`. It matters most for the explorer,
whose entire job is to recompute independently: an explorer importing this library
would certify the same unverified data and display green.

---

## 3. The observer is now a trusted party, and nothing discloses it

The R2 architecture resolves ordering with an approved-observer key — option (c) in
`CAMPAIGN-EXPLORER-SPEC-R2.md §3`, the one I ranked last and said must be *priced*
rather than refused.

Grep across every `.md` in the pack returns **exactly one file** mentioning an
observer, and it is about a different meaning of the word (permissionless
verification, CBR2-004). There is no disclosure row anywhere stating that:

- a key we control assigns the ordering that decides which binding wins;
- withholding or reordering receipts changes the canonical roster;
- a stranger recomputing the root is trusting that key.

`SOVEREIGNTY.md` names Bags at this rank. The observer belongs in the same table,
before anyone enrols. This is the condition I attached to option (c) in R2, and it
is currently unmet.

---

## 4. Smaller

**4.1** `CBR2-004` says `bindLaunch` requires `msg.sender == launchBinder` while the
governing spec calls it permissionless. Still open. Worth resolving before the
canary, since "permissionless verification" is a claim in the public story.

**4.2** The manifest's three-column CRLF format silently defeats `sha256sum -c`,
which returns 0 OK and 390 FAILED — a reviewer in a hurry could report the pack as
corrupt. One line in the header naming the format would prevent that.

---

## 5. Verdict

**The R1 blocking finding is closed, verified by reproduction, and closed better
than proposed.**

**One new blocking finding**, structurally identical to the old one, one layer up:
the observation check can be bypassed by the caller and the evidence exercises the
bypass. One code change and one test change close it.

**One disclosure gap**: the observer is now load-bearing and undisclosed.

The pack's honesty holds up — `INTEGRATED_PROOF_PARTIAL` is an accurate
classification, the baseline audit keeps nine findings open rather than quietly
resolving them, and nothing here was hidden. The defect is in what the tests
exercise, not in what the pack claims to have done.
