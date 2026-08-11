# Campaign explorer — implementation specification (R1)

> **STATUS: SUPERSEDED by [`CAMPAIGN-EXPLORER-SPEC-R2.md`](CAMPAIGN-EXPLORER-SPEC-R2.md).**
> Reviewed as `GPT_BERM_CAMPAIGN_EXPLORER_SPEC_R1_REVIEW_20260808_R1`; nine
> findings accepted, two contested. Kept because the R2 closure table cites it.
> **Do not implement from this file.** Two things in it are known wrong: the
> rebinding rule never defines "later" (E-01), and `CONFLICTED` treats normal
> pre-finalization rebinding as a conflict (E-03).

**For an implementer.** Extends the existing `/who` explorer from identity to
campaigns. Same rule as `/who`: the claim is worthless without somewhere to check
it.

## Why this is worth building before almost anything else

An undisclosed gap in the R1 enrollment pack — a third binding mode
(`legacy_roster_wallet_v0`) that committed 50 EVM destinations to a Merkle root
with **no control proof at all** — survived a full evidence pack, an independent
review, and a `PASS` verdict.

It survived because the only view of that roster was a JSON blob and a green tick.

**A page showing 50 rows, each labelled with its binding status, would have made
it unshippable.** Not because an outsider would have caught it — because the
people who built it would have seen it first.

That is the point of this tool. Outward-facing verifiability is the marketing
benefit. **Making gaps hard to hide from yourself is the engineering benefit**,
and it is the larger one.

### This does not close that finding

Rendering `UNPROVEN_LEGACY` loudly is not the same as refusing to commit it. The
roster-finalization fix — fail closed, or require an explicit
`allowUnprovenLegacy` argument and disclose the count in the receipt — is a
separate change and it lands first. If the explorer ships instead of the fix,
the project has built a very honest window onto a wall it should have moved.

Order: **fix the compiler, then build the window.**

---

## What it is, and what it must never become

**It is a renderer.** It fetches public data — signed events from relays, state
from a public RPC — recomputes conclusions locally, and shows its work.

**It is not a source of truth.** The moment anyone says *"the explorer says so"*
instead of *"I recomputed it"*, this has rebuilt the thing the project is an
alternative to. Every view therefore:

- names **where each fact came from** — which relays, which RPC, which block
- offers the **recompute** rather than asserting the answer
- shows **when it could not verify**, as loudly as when it could

No database of record. No API that other things trust. No cache that outlives a
page load without being labelled as a cache.

---

## Build order — the recompute first

Not the tables. **Build the recompute, prove it against the live campaign, then
build views around it.** A pretty roster table with no independent verification
is a JSON viewer, and the project already has one of those in the form of a text
editor.

1. `recomputeRoot(campaignId, relays)` — fetch enrollments, compile the roster,
   rebuild the root, compare to published
2. The verdict vocabulary below, with every state reachable in a test
3. Campaign view
4. Cohort view
5. npub view
6. Only then: styling

---

## The vocabulary. This is the specification's real content.

Everything else is presentation. Get these two enums right and the tool is
honest whatever it looks like.

### Per-member binding status

| Status | Means | Display |
|---|---|---|
| `PROVEN_DERIVED` | `derived_v1`; address recomputed from the npub **and** control proof verifies | normal |
| `PROVEN_BOUND` | `bound_wallet_v1`; explicit wallet, control proof verifies | normal |
| `UNPROVEN_LEGACY` | **no enrollment event.** Address came from input data with no proof of control | **loud** |
| `UNVERIFIABLE` | an enrollment exists but could not be fetched or verified — relay gap, malformed event | **loud** |
| `CONFLICTED` | multiple valid enrollments disagree, or the committed address differs from the latest valid binding | **loud** |

**`UNPROVEN_LEGACY` must never render like `PROVEN_*`.** Different colour,
different weight, and a count at the top of the cohort. A member whose payout
destination nobody proved control of is the single most important thing this tool
can tell you.

### Per-campaign recompute verdict

| Verdict | Means |
|---|---|
| `REPRODUCED` | our root equals the published root |
| `DIVERGENT` | it does not — and the view names **which leaves differ and how** |
| `INSUFFICIENT` | not enough events could be fetched to attempt it |

**`INSUFFICIENT` is not a pass.** It renders as prominently as `DIVERGENT`, with
the relays queried and which ones answered. The same rule as *"unvalidated is not
valid"* from the enrollment contract — a check that could not run has not
succeeded.

For `DIVERGENT`, reuse the `reconcile()` semantics already in `bags/src/merkle.ts`:
report `omitted`, `extra` and **`changed` per field**, and when nothing it
compares differs, say so and name what to check instead. A mismatch that points at
nothing is a bug in the diagnostic, not a mystery.

---

## The four views

### `/c/<campaign>` — campaign

Root · manifest hash · cohort counts · finalization and seal state · the upstream
Bags fee config it is bound to · **the recompute verdict, at the top, before
anything else.**

Also, from `SOVEREIGNTY.md`: the disclosed upstream authorities. This is the
natural place for a reader to meet them, and burying them here would repeat the
mistake the disclosure exists to prevent.

### `/c/<campaign>/<cohort>` — cohort

Every member: slot · npub · committed destination · **binding status** · the
enrollment event id that produced it. Sortable, and **defaulting to
status-first** so anything not `PROVEN_*` is at the top of the page rather than at
slot 37.

Header line: `50 members · 50 PROVEN · 0 UNPROVEN` — and if that second number is
not zero it is the loudest thing on the screen.

### `/n/<npub>` — identity

Their enrollments across campaigns · current binding per campaign · handle claim
and continuity grade (from the existing `/who` work) · slots held.

Links to `/who` rather than duplicating it.

### `/verify` — the standalone verifier

Paste a root and a set of events, or a campaign id. Recompute. No key, no account,
no server. **This one is deliberately boring and deliberately portable.**

---

## Hosting split, and it matters

| Piece | Where | Why |
|---|---|---|
| Campaign / cohort / npub views | **bermlaunch.com** | product surface, that is where the campaigns are |
| `/verify` — the standalone verifier | **GitHub Pages** | needs no key and no server, and being on a domain we do not control is a *feature*: a skeptic checks the claim without trusting our host |

The verifier must also run from a `file://` copy with relays supplied by the user.
If it only works on our infrastructure it is not a verifier, it is a dashboard.

---

## Data sources

```
signed enrollment events   ← relays. Query many, PUBLISH WHICH, report which answered
published root / state     ← public RPC, with the block number shown
campaign manifest          ← content-addressed, hash displayed and checked
```

Nothing else. No server-side index that the page trusts. If an index is added
later for speed it must be **a cache in front of a recompute**, labelled as such,
and the recompute must remain reachable in one click.

Relay coverage is a real failure mode and already documented in `campaign.ts`: a
subscription on a relay nobody queried is not in the snapshot. So the view names
the relay set, marks which responded, and treats a thin result as `INSUFFICIENT`
rather than a clean answer.

---

## Must not be built

```
a server-side database of record
an API other services depend on for truth
a cache that is not labelled a cache
any view that renders UNPROVEN_LEGACY like a proven binding
a green tick shown before the recompute has actually run
"verified" as a badge without the recomputation behind it
INSUFFICIENT rendered as a soft pass
an explorer-assigned identifier that competes with the npub or the root
write access of any kind — this tool has no keys and signs nothing
```

That last one is worth enforcing structurally: the explorer bundle should contain
no signing code at all, and a test should assert it. A read-only tool that cannot
sign is a read-only tool you do not have to audit for custody.

---

## Acceptance

- [ ] `recomputeRoot` reproduces the live campaign root from relay events alone
- [ ] `UNPROVEN_LEGACY` is reachable in a fixture and renders visibly differently —
      asserted in a browser test, not reviewed by eye
- [ ] A cohort containing one unproven member shows a non-zero count in the header
- [ ] `INSUFFICIENT` is reachable by pointing at a relay set that answers nothing,
      and does **not** render as a pass
- [ ] `DIVERGENT` names the differing leaves and fields
- [ ] Every view lists the relays queried and which answered
- [ ] `/verify` works from `file://` with no network except user-supplied relays
- [ ] The bundle contains no signing code — asserted, not promised
- [ ] No external origins in the built artifact — `explorer/build.mjs` and
      `graph/build.mjs` already throw on this; reuse the same check

The first two are the ones that matter. If a stranger can recompute your root, and
an unproven binding cannot hide, the tool has done its job before a single pixel
is styled.
