# Canary launch — readiness, anchored in evidence

**What this is.** The go/no-go list for the canary token. Every line carries an
anchor, and every anchor carries a **grade**. A claim without an anchor is not on
this list — it is in §5, which is the part worth reading twice.

**Why graded.** A `PASS` verdict once hid a third binding mode that committed 50
EVM destinations with no control proof. It was not caught by scepticism about the
claim; it was caught by asking *"what would I have to run to see this for
myself?"* That question is this document's only real content.

## 0. The grades

| Grade | Means |
|---|---|
| **VERIFIED** | I ran it, or it is `file:line` in this repo. Reproducible by anyone with the checkout |
| **REPORTED** | Someone's pack says so. Plausible, manifest-clean, **not independently reproduced** |
| **ASSERTED** | Claimed in prose with no artifact behind it |
| **OPEN** | Not done, and known not done |

**REPORTED is not VERIFIED.** The sealed R1 pack was manifest-clean, honestly
classified, and still shipped an undisclosed bypass. Manifest integrity proves the
bytes did not change in transit; it proves nothing about whether the claim is true.

---

## 1. What we have — VERIFIED

| Item | Anchor |
|---|---|
| npub → EVM derivation, both parity branches | `bags/vectors/pocket-address.json`, 10 vectors; `node scripts/check-vectors-frozen.mjs` → *"reproduce byte-identically"* |
| Derivation anchor vector | key `1` → `0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf`, externally checkable |
| Enrollment wire contract | `bags/src/enrollment.ts`, 346 lines, 9 exported symbols |
| Enrollment behaviour | `bags/test/enrollment.test.ts` — 21 assertions, part of **bags 181/181** |
| Crypto suite | **119/119** |
| SDK suite | **34/34** |
| G-02 landed (Path-B ≠ derived rule removed) | commit `7d661c2` |
| Rebinding-ordering gap flagged, ordering forbidden until closed | `bags/ENROLLMENT-SPEC.md` §Rebinding, marked OPEN |
| Addressless-enrollment acceptance contradiction fixed | same commit |
| `BagsFeeShare.owner()` is the factory owner; `renounceOwnership()` reverts | **proven on a fork at block 28814524** — `SOVEREIGNTY.md:35` |
| Bags claimer ceiling | `MAX_CLAIMERS = 100`, `bags/src/bags.ts:102` |
| Solana address case-mangling detector | `solanaAddressIsCaseMangled()`, `bags/src/bags.ts:96` |
| Upstream authority disclosure exists | `bags/SOVEREIGNTY.md` §disclosure table, 12 rows |
| `/who` identity explorer builds | `explorer/dist/who.html` |
| Two hosts live, TLS, keys-only SSH, separate credentials | `infra/README.md` runbook |

Line 35 is the standard the rest of this list should meet: *a claim, a method, and
a block number.* Aim there.

---

## 2. What we have — REPORTED (Codex R1 pack, not reproduced by me)

Manifest self-verified 7/7. Classification `IMPLEMENTED_PROOF_PARTIAL` was honest.

| Item | Status |
|---|---|
| Mode + campaign bound into both signature preimages | REPORTED — read, not re-derived |
| Duplicate critical tags rejected before signature check | REPORTED |
| `derived_v1` recomputes rather than trusting supplied address | REPORTED |
| EIP-191 control proof mandatory in both modes | REPORTED |
| Parity normalised at generation, single scalar | REPORTED |
| No compressed-pubkey trap in `recoverAddressFromDigest` | REPORTED — and notable, since this bug bit my own test helper |

One item in that pack **I did reproduce**, and it failed: the roster compiler
regenerated the full 50-member root from zero enrollments and zero proofs,
`MATCH: YES`. That is the difference the grades exist to record.

---

## 3. What we need before the canary

### 3a. Ours — no external dependency

| # | Item | Closed when |
|---|---|---|
| 1 | **`manager_waive_fee_config` called** | a tx signature, published. Until then *"the dev cannot redirect the split"* is false and the community is trusting you personally, not the structure |
| 2 | **`rpIdFromOrigin` — REINSTATED. Third position, and this one has evidence** | `crypto/src/origin.ts:57` returns `u.hostname`, so `webauthn.ts:68` passes `rp.id = "signer.xonly.ai"`. **The deployed infrastructure says that is wrong, in a comment written when it was provisioned** — `infra/cloud-init.xonly.yaml:25`: *"signer.xonly.ai — the signer origin. **RP ID is xonly.ai, NOT this hostname**"*, with the apex provisioned to serve `/.well-known/webauthn`, the Related Origin Requests file. My withdrawal misread `signer-broker.md`: it forbids handing the credential to **third-party clients**, not ROR across origins **we operate**. Those are different mechanisms and the infra runs both — ROR for apex/signer/editor, broker popup for everyone else. Fix is registrable domain via the Public Suffix List; V5 needs rewriting since its two origins share one registrable domain. **Still unfixable after the first passkey exists** |
| 3 | **Bags API key + Hetzner token rotated** | both are in a chat transcript |
| 4 | **Enrollment-time disclosure copy** | the sentence a Bermer reads *before* signing: share is fixed and verifiable, delivery depends on Bags. Disclosed after enrollment is the `legacy_roster_wallet_v0` pattern one level up |
| 5 | **Canary scope decision** | claimers are set at `create_fee_config` and only Bags' admin can update. Whatever the canary launches with, it keeps. **Decide explicitly whether the canary carries real Founders** — if it does, their pockets depend on manual forwarding forever, with no upgrade path |
| 6 | **B-04 ruling recorded** | `SOVEREIGNTY.md:34` currently reads *"Stronger than any Solana admin power"* — which the founder ruling contradicts (global upgrade is protocol-level, high severity, low aimability, high detectability). **The file disagrees with the decision. Fix the file** |
| 7 | **Cohort finalization counts reconciled** | `campaign.ts` enforces no size gate; the historical dual-chain spec required *exactly* 100 / 300. Two laws, one campaign |
| 8 | **Deadline anchoring** | pre-commit the rule, OTS-anchor the snapshot. Same anchor closes rebinding order and E-01 — one mechanism, three uses |

### 3b. Codex — verify on delivery, do not accept on report

| # | Item | Evidence that closes it |
|---|---|---|
| 9 | `legacy_roster_wallet_v0` fails closed | a roster compile with zero enrollments **throws**. Re-run my repro; it must now fail |
| 10 | Library wired to the app | an import of `enrollmentProtocol` in `apps/`. Currently `apps/web/robinhood-beta/src/browserApp.js:267` is a hardcoded `"derived_v1 mock enrollment"` string |
| 11 | `REPORT.md` precision | "UI" claim matches what is actually integrated |

### 3c. Bags — parallel, not gating

| # | Item |
|---|---|
| 12 | Case-preserving route for naming a program address as claimer (Solana) |
| 13 | Whether `BagsFeeShare` ownership can ever sit with the launcher (EVM) |

Both are **disclosure items, not blockers** — the launch proceeds with them open,
because the failure is shared: if the fee stream fails it fails for the dev too.
That is what makes the promise credible without irrevocability. It makes it
**honest, not safe** — and the copy in item 4 has to say which.

---

## 4. Ordering

1, 2 and 3 first. **2 is back**, and it is again the only item on this page that
cannot be repaired after launch — a passkey created under the wrong RP ID is
orphaned by the fix. I have now argued all three positions on this; the reason to
trust this one is that it does not rest on my reading of a spec. It rests on the
provisioning file stating the intended RP ID outright, the apex being configured
to serve the ROR allowlist, and that allowlist currently returning 404 because
nothing has been deployed into it yet.

Then 4, 5, 6. Then Codex 9–11 on delivery. Then 7 and 8.

12 and 13 run alongside and gate nothing.

---

## 5. What is not evidence

```
a manifest that self-verifies      → the bytes are intact, the claim is untested
a PASS verdict                     → someone concluded; reproduce the conclusion
a green CI run                     → the checks that exist passed
"tests pass"                       → which tests, and what would fail if the bug were present?
an independent review              → the R1 review missed the bypass entirely
a spec saying it fails closed      → the spec said that; the compiler failed open
my own prior statement             → I claimed the launch was blocked; it was not
my own repeated statement          → I called rpIdFromOrigin an unfixable defect,
                                     then withdrew it, then reinstated it. Two of
                                     those three were reasoning from documents.
                                     The one that settled it was reading the
                                     deployed config and fetching the live host
```

The pattern in every one: **a conclusion offered in place of the method that
produced it.** The question that catches all of them is the same — *what would I
have to run to see this for myself?* If the answer is "nothing, it says so", the
row is `ASSERTED` and belongs in §5, not §1.
