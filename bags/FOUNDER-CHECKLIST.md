# @bermlaunch — the founder's checklist

**Only items that are yours.** Nothing here is waiting on Codex, GPT, or Bags.
Ordered by *what it costs you to wait*, not by category.

---

## A. Today — because waiting is the expensive part

### A1 · Create the @bermlaunch project npub and anchor the handle claim

```bash
cd link && npm install && npm run build && npm run serve   # http://localhost:8105
```

Five steps, no API key, no developer account, nothing to pay for: identity on
device → post the proof → paste the post URL → **archive it** → sign and publish
kind 0 + kind 30078.

**Step 4 is the one that matters.** The proof post dies with the X account —
which is precisely the moment somebody else holds the handle and is claiming to
be you. The archived copy is held by a third party with no stake in the dispute.

- [ ] `@bermlaunch` npub created
- [ ] proof post published from `@bermlaunch`
- [ ] Wayback snapshot confirmed (poll `archive.org/wayback/available`)
- [ ] kind 0 + kind 30078 published to ≥2 relays
- [ ] OpenTimestamps anchor requested

**Why today and not next week:** the continuity grade comes from a Bitcoin block
height. An anchor made today is worth more in three months than one made in three
months, and there is no engineering that buys the difference back. This is the
only item on the page that punishes delay *by itself*.

### A2 · Your own key on paper

- [ ] Alby Master Key written down, offline, not in a password manager screenshot

### A3 · Rotate two credentials

Both are sitting in a chat transcript.

- [ ] Bags API key rotated
- [ ] Hetzner API token rotated

---

## B. Decisions only you can make

Each one is currently blocking somebody else's work, and none needs new
information.

- [ ] **B1 · Manager waiver.** Call `manager_waive_fee_config`, publish the tx
      signature. Until then *"the dev cannot redirect the split"* is false and
      Bermers are trusting you personally rather than the structure. This is the
      launch gate that is entirely yours to pass.

- [ ] **B2 · Does the canary carry real Founders?** Claimers are set at
      `create_fee_config` and only Bags' admin can change them — whatever the
      canary launches with, it keeps forever. If real Founders enrol against it,
      their pockets depend on you forwarding manually, permanently, with no
      upgrade path. **Recommended: no. Canary is a throwaway.**

- [ ] **B3 · The deadline at timeout.** 24h or 50, whichever first — undefined
      when the clock wins. **Recommended: 50 is a cap, not a threshold. Launch
      with whoever signed.** `perPersonCapBps` already exists for exactly the thin
      first batch. A hard deadline that actually fires is your first public proof
      the promise is real; extending it teaches people your commitments are soft,
      which costs more than a half-empty cohort.

- [ ] **B4 · Ordering law — ratify or overrule.** Codex has shipped the observer
      path (option c): a named key in the campaign constitution,
      `rotation_supported: false`. It works. It also makes that key a trusted
      party inside the verification. Either ratify it and disclose it (B5), or
      overrule it for the hash-linked chain.

- [ ] **B5 · Tier strategy for the canary.** The signer origin does not exist —
      spec only. **Option worth taking on merit: ship with tier-0 and tier-2
      only** (extension and bunker), both of which you already tell people are
      *better* than your tier 1. Smaller build, more sovereign launch, honest copy.

---

## C. Copy and disclosure you own

Nobody else can write these, and they gate what can be deployed.

- [ ] **C1 · The enrollment sentence**, shown *before* anyone signs:

  > Your share is fixed, and you can check it yourself. It cannot be changed by
  > us once committed. It can still be broken upstream by Bags — and if it is, it
  > breaks for the developer too.

  Disclosing after enrolment is the `legacy_roster_wallet_v0` pattern one level
  up: ship a guarantee, mention the exception later.

- [ ] **C2 · Fix `SOVEREIGNTY.md:34`.** It reads *"Stronger than any Solana admin
      power"* about the beacon, which your own B-04 ruling overturned. A file that
      disagrees with a decision is how the decision gets re-argued.

- [ ] **C3 · Add the observer row** to the disclosure table, if B4 ratifies it —
      name the key, say it assigns ordering, say what withholding would do.

---

## D. Deploy — split by whether it claims anything

Two paid servers are currently serving nothing, which is the worst state they can
be in.

**Ship now.** Each of these verifies in the browser and never says "verified"
without recomputing it:

- [ ] docs → bermlaunch.com / xonly.ai
- [ ] `/who` explorer
- [ ] editor (E2E verified: signatures re-checked, decline publishes nothing,
      real card render, `errors: none`)

**Hold until FIX-01 lands.** Anything rendering the Trust & Verify screen — it can
currently report `PASS` with `protocol = null`, and it is the surface a Bermer
would judge you on.

---

## E. Parallel — gates nothing

- [ ] **E1 · Email Bags** the two findings (Solana address case-folding;
      `BagsFeeShare` ownership sitting with the factory owner) and ask the claimer
      question. Costs an email, answers a question no amount of building answers.
- [ ] **E2 · V2 / V3 videos** — supporters, then creators
- [ ] **E3 · The post template** on `post/`, three-way linked

---

## The short version

**A1 today.** Everything else can slip a week without getting worse; the anchor
cannot.

**B1 before you ask anyone to enrol.** It is the difference between a promise and
a structure.

**Then deploy the three things that verify themselves**, and let Codex close
FIX-01 and FIX-02 while you do it.
