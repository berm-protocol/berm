# Berm protocol · xonly.ai · bermlaunch.com — the unified view

One sentence, and the rest of this document is its consequences:

> **A handle is a mutable string. A key is not. Everything here exists because
> people keep attaching things of value to the mutable one.**

---

## 1. The problem, stated once

`bags/README.md` puts it in the form that generalises:

> Bags lets a token launch assign fee shares to a **social handle** rather than a
> wallet … That is a binding from a **mutable string** to a claim on money.
> Handles get renamed, abandoned, suspended, and re-registered by strangers.

That is not a Bags problem. It is the shape of nearly every trust relationship
online: a follower count, a verified badge, a reputation, a revenue split — all
bound to a string a platform can reassign, and all quietly assumed to be durable.

The three properties are the same fix applied at three stakes:

| | The mutable string is worth | So the fix must be |
|---|---|---|
| **Berm protocol** | a reputation | checkable by anyone |
| **xonly.ai** | a body of work | survivable without the platform |
| **bermlaunch.com** | a revenue stream | **immutable once committed** |

The stakes rise left to right, and the guarantees have to harden with them. A
badge that turns out to be wrong is embarrassing. A payout that turns out to be
wrong is theft.

---

## 2. The three layers

```
                          BERM PROTOCOL
        a keypair · an externally anchored claim to an X handle ·
        a grade saying how much of that was actually proven

        created_at proves nothing — any key can sign an event
        dated 2009 — so priority comes from an OpenTimestamps
        anchor at a Bitcoin block height nobody can backdate

                                 │
              federated: any signer origin can participate,
              no registration, no key to obtain, no quota
                                 │
         ┌───────────────────────┴───────────────────────┐
         │                                               │
    ═══ xonly.ai ═══                            ═══ bermlaunch.com ═══
    where an identity is made                   where an identity is
    and used                                    worth money

    signer   hold a real key with                campaign   cohorts, slots,
             no extension and no                            a published root
             seed phrase to lose
                                                enrollment  npub → pocket,
    editor   publish long-form,                             proven, signed
             signed. It outlives
             the platform that                  explorer   rebuild the root
             deletes it                                    yourself, in your
                                                           own browser
    /who     resolve any identity,
             see what is actually                post      "here is my share,
             proven — and what is                          and here is how to
             merely claimed                                check I am not lying"

         └───────────────────────┬───────────────────────┘
                                 │
                    one identity, two surfaces,
                  federation tested between them
```

**Berm protocol works alone.** It needs neither of the others. `sdk/` is four
backends behind one `window.berm` interface, and the whole integration is a script
tag — no registration, no key to obtain, no quota.

**xonly.ai is the first signer**, not the only permitted one. That distinction is
the protocol's entire claim to being a protocol.

**bermlaunch.com is the first application** where getting it wrong costs money
rather than face.

---

## 3. What a launch actually looks like

```
  ENROLL                     frictionless on purpose
  ──────
  Bermer signs one event: campaign · mode · npub · EVM address · control proof.
  Mode and campaign are inside the signature preimage, so a proof cannot be
  lifted between modes or replayed into another campaign.
                                 │
  COHORT                     membership by observation, not assertion
  ──────
  Batch 1 = the first published snapshot. Batch 2 = the second minus the first.
  A backdated timestamp gains nothing: you are in the batch where you were seen.
                                 │
  COMMIT                     the root
  ──────
  Cumulative weight ranges — floor(R·end/W) − floor(R·start/W) — telescope to
  exactly R. Zero dust, by arithmetic rather than by rounding policy.
                                 │
  VERIFY                     by a stranger, not by us
  ──────
  The explorer rebuilds the root from published evidence and shows its work,
  including every relay it asked and which ones answered.
                                 │
  FLOW                       trading fees
  ──────
  Bags fee config → Distributor → pockets. Entitlement is cumulative and does
  not expire. There is no claim window and no way to be too late.
```

**Enrollment is easy and claiming is hard, deliberately.** Joining should cost a
signature. Moving money should cost proof. Most systems get this backwards and
then discover they gated the wrong end.

---

## 4. What is actually new

Four things. Not a list of features — four claims that are either true or not.

### 4.1 The identity is the payout key

A Nostr key is secp256k1, so it already *is* an EVM keypair: `pub = 0x02‖x` →
uncompressed → `keccak256(x‖y)[12:]`. One object answers three questions that are
normally three separate systems:

- **who are you** — an npub with a public history
- **where do we pay you** — the address that key derives
- **are you real** — an anchored handle claim with a continuity grade

No address collection, no mailing list, no KYC vendor. Verified 300/300 against
frozen vectors, both parity branches, anchored to an external value anyone can
check: key `1` → `0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf`.

### 4.2 Sybil resistance from continuity, not identity documents

You do not prove you are a person. You present a key with **history** — an anchored
handle claim, archived proof posts, published work. Faking that costs time nobody
can compress, because the anchor is a Bitcoin block height.

An account farm can make ten thousand npubs in an afternoon. It cannot make ten
thousand npubs that were anchored eighteen months ago.

### 4.3 The promise is checkable before you decide to trust it

Every launchpad asks you to believe a roadmap. This one publishes a root you can
rebuild in your own browser, on a host we do not control, from a `file://` copy if
you prefer.

That is also why the explorer exists as an engineering tool and not a marketing
one. An undisclosed third binding mode once committed 50 EVM destinations with **no
control proof at all**, and survived an evidence pack, an independent review and a
`PASS` verdict — because the only view of that roster was a JSON blob and a green
tick. A page showing 50 rows with their binding status would have made it
unshippable. Not because an outsider would have caught it. Because we would have.

### 4.4 The disclosure is the product

`SOVEREIGNTY.md` is a twelve-row table naming, layer by layer, exactly who can
break what. It says out loud that **Bags' program admin can rewrite the fee split
and we cannot stop them**, and that every `BagsFeeShare` is a beacon proxy Bags can
replace for every token at once.

That is not a caveat buried in documentation. In a category built on
implication and vibes, *"here is precisely who can still break this"* is a
position nobody else is standing on.

And it is honest about its own shape: if the fee stream fails, it fails for the
dev too. Nobody extracts while supporters get nothing. That makes the arrangement
**honest, not safe** — which the enrollment copy has to say in those words.

---

## 5. What is trusted, plainly

| Trusted | Why it has to be, today |
|---|---|
| **Bags** | the platform. Their admin can rewrite the split; their beacon can replace the contract. Disclosed, not defended against |
| **The dev, until the manager role is waived** | `manager_update_fee_config` exists. Until it is waived the community is trusting a person, not a structure. This is a launch gate, and it is ours to pass |
| **The signer origin, for tier-1 users** | which is why tiers 0 and 2 — extension and bunker — are described as *better*, not as fallbacks |

| Not trusted | Why not |
|---|---|
| Any relay | signatures are re-verified in the browser; a relay serving a forgery cannot get it on the page |
| `created_at` | self-asserted by the party whose timing is in dispute |
| Our own server | the verifier runs from a domain we do not control, and from `file://` |
| Our own code, by the explorer | it recomputes independently and cross-tests against frozen vectors. A tool that imports the implementation it is checking is a checksum, not a check |

---

## 6. Where it actually stands

Graded honestly, in two documents rather than asserted here:

- `bags/CANARY-READINESS.md` — the launch list, every row anchored, every anchor
  graded **VERIFIED / REPORTED / ASSERTED / OPEN**
- `spec/XONLY-READINESS.md` — the editor is real and end-to-end verified; the
  signer origin is a very good specification and nothing else

Short version: the protocol is built and tested. The editor is built and verified.
The launchpad's enrollment library exists and its roster compiler has a known
open finding. The signer origin is not started. Two servers are live and serving
nothing.

The gap between *"the architecture is right"* and *"a stranger can use it on
Tuesday"* is the whole remaining job, and neither readiness document pretends
otherwise.

---

## 7. The sentence to launch with

> **Your share is fixed, and you can check it yourself.**
> The split cannot be changed by us once committed. It can still be broken
> upstream by Bags — and if it is, it breaks for the developer too.
> Here is the page where you rebuild the numbers without asking us anything.

Every clause is either provable today or named as a dependency. That is the
standard the rest of the copy has to meet.
