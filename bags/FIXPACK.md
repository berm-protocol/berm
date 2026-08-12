# Fix pack — BermLaunch, pre-canary

Five items. Two blocking, one systemic, two small.

**The rule for this pack: every fix ships with the test that would have caught
it.** All three findings so far were fixed correctly at the point of discovery and
then reappeared one layer over, because the evidence exercised the bypass rather
than the enforcement. A fix without that test is half a fix.

---

## FIX-01 — BLOCKING — the trust screen passes with no evidence

**File** `apps/web/robinhood-beta/src/trustVerify.js`
**Lines** 69-72 (defaults), 209-212 (checks that consume them)

### Now

```js
observationStatus:  protocol?.observation?.status  ?? "SIGNED_OBSERVATION_RECEIPT_VERIFIED",
backupStatus:       protocol?.backup?.status       ?? "ROUND_TRIP_VERIFIED_PORTABLE_ENCRYPTED_BACKUP",
walletProofStatus:  protocol?.walletProof?.status  ?? "EIP191_PERSONAL_SIGN_RECOVERED_TO_COMMITTED_WALLET",
exportStatus:       protocol?.export?.status       ?? "PUBLIC_EVIDENCE_READY",
```

Each default is the affirmative verification string, and lines 209-212 then derive
the receipt's booleans by comparing against those same constants. Missing evidence
produces the string meaning "verified", which the check compares to itself.

Reproduced with `enrollmentSummary` lifted verbatim and `protocol = null`: all
three enrollment booleans `true`, while the page renders the destination as
`"Loading"`.

### Required

```js
observationStatus:  protocol?.observation?.status  ?? "UNVERIFIED",
backupStatus:       protocol?.backup?.status       ?? "UNVERIFIED",
walletProofStatus:  protocol?.walletProof?.status  ?? "UNVERIFIED",
exportStatus:       protocol?.export?.status       ?? "UNVERIFIED",
```

and the checks must require positive evidence, exactly like the two done correctly
three lines above them:

```js
// the existing correct pattern, for reference — do not change these
creatorControlPassOnlyWhenProven: creator?.state === "PASS" && creator.proven === true,

// make the enrollment checks match it
enrollmentObservationReceiptVerified:
  protocol?.observation?.verified === true &&
  enrollment.observationStatus === "SIGNED_OBSERVATION_RECEIPT_VERIFIED",
```

`UNVERIFIED` must render **visibly differently** — loud, the way
`UNPROVEN_HISTORICAL` is loud. A neutral grey "unverified" next to four green rows
reads as a loading state.

### Acceptance

- [ ] `enrollmentSummary(null, null, null, null)` → all four statuses `UNVERIFIED`
- [ ] the derived receipt booleans are `false`, and the receipt verdict is **not**
      `PASS`
- [ ] a browser test renders the screen with `protocol = null` and asserts no
      affirmative verification string appears anywhere in the DOM
- [ ] `UNVERIFIED` styling asserted in a browser test, not reviewed by eye

---

## FIX-02 — BLOCKING — the roster compiler trusts the caller's observation

**File** `packages/sdk/src/enrollmentRoster.js`
**Line** 122

### Now

```js
const trustedObservation = record.trustedObservation ?? receipts.get(record.eventId);
```

The left branch never calls `verifyObservationReceipt` — no signature check, no
observer allowlist, `observerPolicy` never consulted. Reproduced: a roster compiled
with `observerPolicy: null` and a hand-written observation named `"self-made"`
returned `classification: PRODUCTION_VERIFIED_ENROLLMENT`.

`verify_enrollment_evidence.mjs` now does this correctly — mandatory policy,
hash-bound to the constitution, real receipt verification. **That enforcement sits
beside this bypass rather than replacing it.**

### Required

```js
const trustedObservation = receipts.get(record.eventId);
```

### Expected consequence, and it is the point

Removing the passthrough **breaks the current e2e at the first production compile**:

```
Error: trusted_observation_required:0x3073bb3f…1036
    at recordsWithTrustedObservations (enrollmentRoster.js:119)
    at compileEnrollmentRoster (enrollmentRoster.js:202)
    at main (supporter_enrollment_r2_closure.mjs:277)
```

That is not a regression. It is the proof that every existing test was exercising
the bypass. Fix the tests to pass `observationReceipts` and let the compiler verify
them — which is what `INDEPENDENT_REVIEW_R2.md:10` already claims is happening.

### Acceptance

- [ ] `e2e/supporter_enrollment_r2_closure.mjs` passes **without** pre-attaching
      `trustedObservation` to any record
- [ ] every `compileEnrollmentRoster` call supplies real `observationReceipts`
- [ ] **negative test**: a receipt signed by a key outside
      `observerPolicy.observerPubkeys` is rejected *at compile*, not only by
      `verifyObservationReceipt` in isolation
- [ ] **negative test**: `observerPolicy: null` with receipts present fails closed
- [ ] `grep -n 'trustedObservation' packages/sdk/src/` shows no caller-supplied path

---

## FIX-03 — SYSTEMIC — make the pattern a build failure

Three findings, three packs, one operator:

```
legacy_roster_wallet_v0        missing enrollment  → pass the wallet through   FIXED
record.trustedObservation ??   missing receipt     → trust the caller's        FIX-02
?? "…_VERIFIED"                missing evidence    → render as verified        FIX-01
```

`??` and `||` supply a harmless default in ordinary code. **In a verification path
they manufacture proof, silently, at exactly the moment evidence is absent.**

### Required

A repo check that fails the build on `??` or `||` fallbacks assigned to any
identifier matching `/status|verified|proven|proof|finalizable|allowed/i` inside
trust-surface paths — `apps/web/**/trustVerify*`, `packages/sdk/src/enrollment*`,
`packages/roster/**`.

Allow an explicit opt-out comment naming the reason, so the exception is visible in
review rather than invisible in syntax:

```js
// TRUST-DEFAULT-OK: cosmetic label, not a verification claim
```

Precedent: `scripts/check-supply-chain.mjs` and `scripts/check-caddyfile.mjs` in
the Berm repo — a guard written the day a mistake cost a morning.

### Acceptance

- [ ] the check fails on the pre-FIX-01 `trustVerify.js` — verified by running it
      against that exact revision
- [ ] the check passes after FIX-01 and FIX-02
- [ ] it runs in CI on every push, not only locally

---

## FIX-04 — SMALL — `bindLaunch` is not permissionless

`CBR2-004`, still open. `evm/src/BermRobinhoodDistributorV01.sol:162` requires
`msg.sender == launchBinder`, while the governing spec describes `bind_launch` as
permissionless verification.

This matters beyond the code because "permissionless verification" is a claim in
the public story. Either make it permissionless, or change the sentence — do not
ship the gap between them.

### Acceptance

- [ ] controller and non-controller binding paths both tested, including negative
      cases for invalid Bags state
- [ ] the public copy matches whichever way it resolves

---

## FIX-05 — TRIVIAL — the manifest format defeats `sha256sum -c`

`FILE_MANIFEST_SHA256.txt` uses three columns (`sha256  bytes  path`) with CRLF
endings, so `sha256sum -c` reports 0 OK and 390 FAILED on a completely intact pack.
A reviewer in a hurry reports it corrupt.

### Required

One line in the header giving the verification command that actually works.

---

## Order

**FIX-01 and FIX-02 before anything is deployed that claims to verify.**
FIX-03 immediately after, so there is no fourth instance.
FIX-04 before the canary. FIX-05 whenever.

None of these is large. FIX-01 and FIX-02 are a handful of lines each; the work is
in the tests, which is exactly where it should be.
