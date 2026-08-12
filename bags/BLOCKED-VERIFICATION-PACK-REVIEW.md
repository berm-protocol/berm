# Review — `BERMLAUNCH_ROBINHOOD_BLOCKED_IMPLEMENTATION_VERIFICATION_20260812`

**Short answer: yes, better — and it introduces the worst instance yet of the
pattern we keep finding.**

Better in the ways that count: the classification is honest, every hash claim it
makes is true, and it builds the observer enforcement I said was missing. Then it
puts a fail-open default on the user-facing trust surface.

---

## 1. Everything checkable, checked

| Claim | Result |
|---|---|
| Own manifest | **82/82 verified** |
| Continuity zip `dcdc8cea…d4e8` | **matches** the pack I reviewed |
| Checkpoint zip `07e026ea…9e5f` | **matches**, and the sidecar agrees |
| Continuity inner manifest `390/390 PASS` | **independently confirmed** |
| V2 constitution digest `0xbaef1dbf…995a` | **matches** raw SHA-256 of the canonical file |

Five claims, five true. That is a better evidence record than any pack so far.

**And it refuses to claim closure.** `closed_proof_partial_claimed: false`, with
five blocking gates named: `forge` unavailable so no native build/fork, the
root-safety matrix timing out at 900s (exit 124), ABI regeneration blocked, no
final seal. It states plainly that
`…BAGS_BIND_AND_CONSTITUTION_ANCHOR_CLOSED_PROOF_PARTIAL` is **not** claimed.

A pack that says *"I could not run the thing that would prove this"* is worth more
than one that finds a way to report green. This is the right behaviour.

---

## 2. It builds the enforcement I asked for — beside the bypass, not replacing it

`packages/roster/verify_enrollment_evidence.mjs` is new and does the job properly:

- an observer policy is **mandatory** — `constitution_observer_policy_required`
- the policy is **hash-bound to the campaign constitution** —
  `constitution_observer_policy_hash_mismatch`, so the observer set cannot be
  swapped without changing the constitution hash
- per record it runs `verifyEnrollmentEvent` **and** `verifyObservationReceipt`
  with `expectedObserverPubkeys` from the constitution and `expectedEventId` bound
  to the verified enrollment
- emits `PROVEN_BY_RAW_CRYPTOGRAPHIC_EVIDENCE` only after both

The observer is now a **named key committed in the constitution**
(`0x3bb03660…80fe`, `rotation_supported: false`). That is materially better than
the last pack, where the observer was load-bearing and appeared nowhere.

**But `packages/sdk/src/enrollmentRoster.js` is not in the diff.** The passthrough
at line 122 — `record.trustedObservation ?? receipts.get(record.eventId)` — is
untouched. So there are now two doors: a strict CLI verifier that checks
signatures, and a library compiler that accepts a caller-supplied observation and
still stamps `PRODUCTION_VERIFIED_ENROLLMENT`.

Building a locked door beside an unlocked one does not secure the room. Whichever
path production actually uses, the library should not certify unverified input.

---

## 3. BLOCKING — the trust surface passes with no evidence at all

`apps/web/robinhood-beta/src/trustVerify.js:58-75`

```js
observationStatus:  protocol?.observation?.status  ?? "SIGNED_OBSERVATION_RECEIPT_VERIFIED",
backupStatus:       protocol?.backup?.status       ?? "ROUND_TRIP_VERIFIED_PORTABLE_ENCRYPTED_BACKUP",
walletProofStatus:  protocol?.walletProof?.status  ?? "EIP191_PERSONAL_SIGN_RECOVERED_TO_COMMITTED_WALLET",
exportStatus:       protocol?.export?.status       ?? "PUBLIC_EVIDENCE_READY",
```

Every default is the **affirmative verification string**. And lines 209-212 derive
the receipt's booleans by comparing against those same constants:

```js
enrollmentObservationReceiptVerified: enrollment.observationStatus === "SIGNED_OBSERVATION_RECEIPT_VERIFIED",
enrollmentBackupRoundTripVerified:    enrollment.backupStatus === "ROUND_TRIP_VERIFIED_PORTABLE_ENCRYPTED_BACKUP",
enrollmentEip191WalletProof:          enrollment.walletProofStatus === "EIP191_PERSONAL_SIGN_RECOVERED_TO_COMMITTED_WALLET",
```

So missing evidence produces the string that means "verified", which the check then
compares to itself.

### Reproduced — `enrollmentSummary` lifted verbatim, called with `protocol = null`

```
protocol evidence supplied : null
committedDestination       : Loading
verifiedNostrIdentity      : Loading

{
  "enrollmentObservationReceiptVerified": true,
  "enrollmentBackupRoundTripVerified": true,
  "enrollmentEip191WalletProof": true
}

all three PASS with zero evidence: true
```

The page cannot even name the destination — it says **"Loading"** — while
simultaneously certifying that the wallet proof recovered to it.

This is the most serious version of the pattern so far, because this file is not
an internal compiler. **It is the screen whose entire purpose is telling a Bermer
whether their binding was proven.**

### They already know how to write it correctly

Three lines above, in the same object:

```js
creatorControlPassOnlyWhenProven: creator?.state === "PASS" && creator.proven === true,
bermControlPassOnlyWhenProven:    berm?.state === "PASS" && berm.proven === true,
```

Positive evidence required, `&& proven === true`. Same file, same function, two
standards. The fix is to make the enrollment checks look like the control checks:
default to `"UNVERIFIED"` and require the affirmative string to have come from
real evidence.

---

## 4. The pattern, named

Three instances, one disease:

```
1. legacy_roster_wallet_v0        missing enrollment  → pass the wallet through   FIXED
2. record.trustedObservation ??   missing receipt     → trust the caller's        OPEN
3. ?? "…_VERIFIED"                missing evidence    → render as verified        NEW
```

Every one is `??` used to mean *"assume the good outcome."* In ordinary code that
operator supplies a harmless default. **In a verification path it manufactures
proof**, and it does so silently, at exactly the moment evidence is absent.

Worth a lint rule rather than another review: no `??` and no `||` on any
identifier matching `/status|verified|proven|proof/i` inside a trust surface. That
turns a recurring finding into a build failure.

Their own baseline audit already named the family — CBR2-007, *"Existing EVM tests
mock away the trust boundary."* This is the third sighting.

---

## 5. Also good, briefly

- Bags upstream authority is now **on the surface**, not just in docs:
  `canBagsChangeFutureRouting: "YES_UPSTREAM_DEPENDENCY_DISCLOSED"`, with the
  fee-share owner and factory owner named. Exactly the disclosure discipline
  `SOVEREIGNTY.md` argues for
- V2 removes `distributor_address` and marks the anchor
  `DEPLOYMENT_CANDIDATE_NOT_ONCHAIN_CONFIRMED` until a contract readback exists —
  refusing to assert an address it has not confirmed
- Distributor now rejects zero evidence hashes at constructor, finalization and
  seal, and rejects upstream owner / beacon-owner collisions
- `normalized_status_strings_authoritative: false` in the verifier output — an
  unusually honest flag, and directly relevant to §3

---

## 6. Verdict

**Better. Keep this pack's habits: it verified its own claims, it named what it
could not run, and it refused to claim closure.**

Two things before the canary:

1. **`trustVerify.js` fail-open defaults** — blocking. The trust screen must not be
   able to say PASS with `protocol = null`
2. **`enrollmentRoster.js:122`** — the passthrough survives the new verifier

Neither is large. The pattern behind them is the thing worth spending effort on,
because it has now produced three findings in three packs and will produce a
fourth.
