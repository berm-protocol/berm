# Campaign explorer — specification, R2 (rebase)

**Supersedes** `CAMPAIGN-EXPLORER-SPEC.md` (R1).
**Adjudication target** `GPT_BERM_CAMPAIGN_EXPLORER_SPEC_R1_REVIEW_20260808_R1`
(subject SHA-256 `7ba1b5e1…b0c8`, confirmed against the zip as sent).

Specification only. No implementation, no economics, no chain reopening.

Nine findings accepted, one of them already closed in code. **Two contested**, and
they are §3 and §4 — the rest of this document is settled and can be read quickly.

---

## 1. Closure table

| # | Finding | Disposition |
|---|---|---|
| E-01 | Relay events alone cannot yield the canonical roster | **PROBLEM ACCEPTED · REMEDY CONTESTED** → §3 |
| E-02 | Root equality and destination-proof coverage must be separate | **ACCEPTED** → §5 |
| E-03 | `CONFLICTED` is stale under deterministic rebinding | **ACCEPTED, conditional on E-01** → §5.3 |
| E-04 | `TASK.md` reopens a closed production decision | **ACCEPTED** — stricter than I proposed, in the direction I argued |
| E-05 | Bundled `merkle.ts` is predecessor Solana/equal-share law | **ACCEPTED** → §7 |
| E-06 | Bundled enrollment references are superseded | **ACCEPTED — CLOSED IN CODE**, commit `7d661c2` |
| E-07 | Data-source list incomplete | **ACCEPTED, conditional on E-01** → §6 |
| E-08 | Must not become a competing protocol implementation | **CONTESTED** → §4 |
| E-09 | Clarify the static-verifier portability rule | **ACCEPTED** → §8 |
| E-10 | Trust & Verify and Explorer must not compete | **ACCEPTED, one carve-out** → §9 |
| E-11 | KOL/moderator/ratings are roadmap | **ACCEPTED** — independently reached the same conclusion |

### E-06 is closed, with evidence

Both sub-findings were true and are fixed in this repo:

- `checkMode` no longer rejects `bound_wallet_v1` when the address equals
  `derive(npub)`. G-02 is landed; the test is inverted to assert acceptance.
  `bags/src/enrollment.ts`, `bags/test/enrollment.test.ts` — bags **181/181**.
- The acceptance item reading *"A subscription with no address parses, and derives
  the pocket from the npub"* contradicted the fail-closed rule two sections above
  it. Now reads **rejected**, and says why the old text was dangerous.

---

## 2. What R1 got right and R2 keeps

Unchanged, and not re-argued: recompute before styling · no keys, no signing code,
no write path · no database of record · no unlabelled cache · every conclusion
names its sources · every relay and RPC queried is shown · `INSUFFICIENT` is loud
· `DIVERGENT` names omitted/extra/changed · cohort view defaults to status-first ·
portable standalone verifier · link `/who` rather than duplicate it.

One framing addition, from `bags/CANARY-READINESS.md`: that document grades every
claim **VERIFIED / REPORTED / ASSERTED / OPEN**, where VERIFIED means *someone can
re-run it*. **The explorer's whole job is to turn REPORTED into VERIFIED for a
stranger.** That is the product in one sentence.

---

## 3. E-01 — the problem is real, the remedy costs more than it should

### The problem, conceded without reservation

R1 said a later valid enrollment supersedes an earlier one and **never defined
"later"**. That is a genuine hole. `created_at` is self-asserted, and this project
knows it better than most — `bags/src/subscribe.ts:25-29`:

> `created_at` is set by whoever signs. It is a claim about time made by the party
> whose timing is in dispute … It is recorded here and **MUST NOT order anybody.**

An implementer reaching for `created_at` would let a user reorder their own
rebindings at will. R1 left that door open. The spec now marks it OPEN and forbids
implementing any rebinding ordering until it is closed.

### Why the proposed remedy is not free

E-01 resolves it with an **authenticated observation receipt** signed by an
**approved observer** carrying an **observer sequence**. That works. It also puts a
key we control inside the one function this tool exists to perform: a stranger
recomputing the root would be trusting our observer not to withhold or reorder.

That is not a reason to refuse it. It is a reason to **price it**, and the price
is a row in `SOVEREIGNTY.md` at the same rank as the Bags rows — a new trusted
party, named, before anyone enrolls.

### Three options, ranked

**(a) Hash-linked rebinding chain — preferred.** Each rebind carries
`["prev", <event_id>]` naming the enrollment it replaces.

- canonical binding = the chain tip (the event no other event names as `prev`)
- ordering is **structural**: you cannot forge a predecessor hash
- two events naming the same `prev` = equivocation = `CONFLICTED`, fail closed
- a `prev` naming an event you do not hold = **the gap announces itself** →
  `INSUFFICIENT`, never a silently-stale binding
- the whole chain is signed by the same npub, so it is self-authenticating
- **no new trusted party**

Honest limits: a user can withhold their own tip, which harms only them; and an
attacker holding the npub can rebind regardless — hash-linking does not change
that, and nothing at this layer does.

**(b) Published, externally archived snapshots.** Already this project's documented
answer — `subscribe.ts` continues: *"Ordering comes from the published snapshots,
which are archived by a third party."* Weaker than (a), but it introduces no key
we control and reuses machinery `/who` already relies on.

**(c) Observer receipts** — as E-01 proposes. Works, and is the most operationally
convenient. Requires the disclosure row.

### Binding requirement whichever is chosen

If (c), the explorer renders **"ordering depends on observer `<id>`"** with the
same prominence as `UNPROVEN_LEGACY`. A trusted party inside a verification tool
that the verification tool does not mention is the failure this whole document
exists to prevent.

---

## 4. E-08 — the preference is inverted

E-08 lists two acceptable relationships and prefers the first:

1. Explorer imports the production verifier/root library
2. Explorer implements the protocol independently, cross-tested byte-for-byte
   against canonical vectors

**Only (2) is a verification.** An explorer that imports the production library
reproduces production bugs perfectly and reports `REPRODUCED`. That is a checksum
of the deployment, not a check of the law.

The concrete case is the one that motivates this tool: a shared-library explorer
pointed at the R1 roster would have called `selectBindingForFinalization`, received
`legacy_roster_wallet_v0` for all 50 members, rebuilt the identical root, and shown
green. **The bug that justifies the explorer survives the shared-library
explorer.** I reproduced that root at `MATCH: YES` with zero enrollments and zero
proofs; a shared library would have reproduced it too, and agreed with itself.

E-08's real concern — that the explorer must not invent a second protocol law — is
correct and is met by (2). **The shared artifact is the vectors, not the code.**
Frozen, published, byte-compared, with an explicit protocol-version mismatch state
when the explorer and production disagree about which law applies.

`bags/vectors/pocket-address.json` and `crypto/vectors/test-vectors.json` are
already frozen and hash-checked by `scripts/check-vectors-frozen.mjs`. The pattern
exists; extend it to the root law.

---

## 5. The verdict model

E-02 is right that one badge cannot carry these claims. Four orthogonal axes:

### 5.1 `rootVerdict`
`REPRODUCED` · `DIVERGENT` · `INSUFFICIENT`

For `DIVERGENT`, keep R1's discipline: name `omitted`, `extra`, and `changed`
**per field**; when nothing compared differs, say so and name the unexamined
inputs. A mismatch pointing at nothing is a bug in the diagnostic.

### 5.2 `destinationProofCoverage`
`ALL_DESTINATIONS_PROVEN` · `UNPROVEN_HISTORICAL` · `UNVERIFIABLE_EVIDENCE` ·
`CONFLICTED_EVIDENCE`

**`REPRODUCED` must never imply proven control.** The 50-member root is the
standing counterexample: perfectly reproducible, 0/50 proven.

### 5.3 Per-member binding status
`PROVEN_DERIVED` · `PROVEN_BOUND` · `UNPROVEN_HISTORICAL` · `UNVERIFIABLE` ·
`CONFLICTED`

`CONFLICTED` is redefined per E-03: **not** "multiple valid enrollments exist" —
that is normal pre-finalization rebinding. It means the governing evidence cannot
resolve one deterministic binding: equivocation, unresolved tie, or a committed
root destination differing from the deterministic result.

### 5.4 `finalizableUnderCurrentLaw`
`YES` · `NO`

Per E-04, production finalization is fail-closed. The 50-member root is
`UNPROVEN_HISTORICAL`, reproducible as forensic evidence, **never finalizable, never
a Trust & Verify PASS, never a migration exception.**

A campaign summary shows all four. Example, and it should be readable as one
sentence: *root `REPRODUCED` · destinations `0 / 50 proven` · historical
`UNPROVEN_HISTORICAL` · finalizable `NO`.*

---

## 6. Data sources

```
signed enrollment events        ← relays; publish which, report which answered
ordering evidence               ← per §3: chain tips (a) / archived snapshots (b)
                                  / observation receipts + observer policy (c)
published root and state        ← public RPC, block number shown
campaign manifest               ← content-addressed, hash displayed and checked
finalization cutoff / receipt   ← as published
chain and domain configuration  ← as published
verifier / root schema version  ← explicit, and compared
```

An index may **locate** these. It may not establish them. Any index is a cache in
front of a recompute, labelled, with the recompute one click away.

Relay coverage is a real failure mode, documented in `campaign.ts`: a subscription
on a relay nobody queried is not in the snapshot. Thin results are `INSUFFICIENT`,
not a clean answer.

---

## 7. Reference material — what may and may not be carried over

**Not implementation authority:** `merkle.ts` as shipped uses `solanaAddress`,
equal `amount`, and `distributeEqually()`. Predecessor law. Do not port the leaf
encoding, destination type, distribution or root algorithm.

**Retained, as vocabulary:** `reconcile()`'s `omitted` / `extra` / `changed`
discipline, and its rule that changed fields are named.

R2 ships **no source files as reference.** R1 shipped `merkle.ts` and
`enrollment.ts` and both drew findings for containing superseded semantics. The
diagnostic discipline is described in prose here instead; the current law comes
from the current repository.

---

## 8. The standalone verifier

No account, no server authority, no signing code, runs from a `file://` copy.

Clarified per E-09: **the no-external-origins rule governs bundled assets** — no
hardcoded third-party script, font or asset origins, enforced the way
`explorer/build.mjs` and `graph/build.mjs` already throw. **User-supplied relay and
RPC endpoints are permitted and must be displayed.** A source that fails produces
`INSUFFICIENT`, never a silent fallback. No Berm API may be required for `/verify`.

Hosting split unchanged: campaign views on bermlaunch.com; `/verify` on GitHub
Pages, because being on a domain we do not control is a feature.

---

## 9. Relationship to Trust & Verify

Accepted: Trust & Verify is the published disclosure surface; the Explorer is the
independent recomputation lens. `Trust & Verify` beside `Independently recompute`.

**One carve-out.** E-10 says the Explorer must not reinterpret upstream
dependencies into a new launch-blocking policy. Agreed — *blocking* is a founder
decision. **Displaying is not.** The Explorer shows upstream authority as fact,
including the beacon.

Concretely, and per the founder ruling on B-04 — global upgrade is protocol-level,
so severity is high but aimability is low and detectability is high — the campaign
view carries **the beacon implementation address and the block of its last
upgrade**. That converts an authority nobody can control into one anybody can
watch, which is the only honest thing to do with it.

Related and outstanding: `bags/SOVEREIGNTY.md:34` currently reads *"Stronger than
any Solana admin power"*, which contradicts that ruling. The file disagrees with
the decision and should be corrected, or the next reviewer re-argues it.

---

## 10. Build order

1. The recompute, against whichever ordering law §3 settles on
2. The four verdict axes, every state reachable in a test
3. Campaign view · 4. Cohort view · 5. npub view · 6. `/verify`
7. Only then: styling

Buildable **now**, independent of §3: the verdict rendering, relay-coverage
display, the no-signing assertion, portability, and the vector cross-test harness.
Holding all of it on the ordering decision is more delay than the finding
justifies. Build the shell; bind the selection law last.

---

## 11. Acceptance

- [ ] Recompute reproduces the live campaign root from published evidence alone
- [ ] `UNPROVEN_HISTORICAL` reachable in a fixture and visibly different — browser
      test, not reviewed by eye
- [ ] A cohort with one unproven member shows a non-zero count in its header
- [ ] `INSUFFICIENT` reachable by pointing at a relay set that answers nothing, and
      does **not** render as a pass
- [ ] `DIVERGENT` names differing leaves and fields
- [ ] The four verdict axes render independently; no single badge collapses them
- [ ] `REPRODUCED` + `0/50 proven` renders without implying safety — the standing
      counterexample, as a fixture
- [ ] Byte-for-byte agreement with canonical vectors; **protocol-version mismatch
      is its own visible state**
- [ ] If ordering resolves to (c), the observer is named in every affected view
- [ ] Beacon implementation address and last-upgrade block shown on the campaign view
- [ ] Every view lists relays and RPCs queried, and which answered
- [ ] `/verify` runs from `file://` with no network but user-supplied endpoints
- [ ] The bundle contains no signing code — asserted, not promised
- [ ] No external origins in the built artifact

The two that matter are unchanged from R1: a stranger can recompute the root, and
an unproven binding cannot hide.

---

## 12. Sequence

R1's own justification stands and is worth restating, because it now cuts at the
document that contains it: the `legacy_roster_wallet_v0` gap survived a full
evidence pack, an independent review and a `PASS` verdict, because the only view of
that roster was a JSON blob and a green tick.

**The explorer still does not close it.** Rendering `UNPROVEN_HISTORICAL` loudly is
not refusing to commit it. The roster-finalization fix lands first. Fix the
compiler, then build the window.

Proposed: settle §3 and §4 → freeze the root/verifier interfaces and their public
vectors → Codex builds §10 steps 1–2 against the vectors → the rest.
