# xonly.ai — signer and editor, readiness

**Rewritten from a corrected baseline at commit `7ce22bf`.** Three claims in
earlier revisions of this file were false; they are in §5 with how they got in.

Same evidence rule as `bags/CANARY-READINESS.md` §0: **nothing enters this file
unless it was produced by running something** — a test executed, a script
reproduced, a live host fetched, or `file:line` read from the repository **root**.

---

## 1. The one-line status

**The editor is real. The signer origin is real. The signer application is not.**

`signer.xonly.ai` has been live and hardened since provisioning. It serves
*"Provisioned. Nothing deployed yet."* The remaining work is deploying a page into
a correctly configured origin — **not standing an origin up**.

---

## 2. VERIFIED — live hosts, fetched at review time

| Host | Response |
|---|---|
| `xonly.ai/` | *"Provisioned. Nothing deployed yet."* |
| `signer.xonly.ai/health` | **`signer-ok`** |
| `signer.xonly.ai/` | *"Provisioned. Nothing deployed yet."* |
| `editor.xonly.ai/` | *"Provisioned. Nothing deployed yet."* |
| `xonly.ai/.well-known/webauthn` | **404** |

Configuration is in `infra/Caddyfile.xonly` and provisioned by
`infra/cloud-init.xonly.yaml`. Per-host CSP, HSTS, `X-Frame-Options: DENY`,
`-Server`, and on the signer specifically:

```
frame-ancestors 'none'
```

with the reason recorded in the file rather than assumed: *"load-bearing rather
than hygiene: the approval UI must never be embeddable, because a client that can
frame it can cover it."*

---

## 3. VERIFIED — what is built and tested

### The editor — `editor/`

`npm run verify` runs an end-to-end against two local relays. From the run:

| Claim | Evidence |
|---|---|
| Signs and publishes NIP-23 long-form | `EVENT c07e1f4abb06… sig=VALID -> stored`, both relays |
| Resolvable by any client | `30023:c1cc626…:your-identity-should-outlive-the-platform` |
| **Decline publishes nothing** | `relay A stored: 0 (must be 0)` |
| Card is a real image | `card is a real PNG data URL: true \| bytes: 741KB` |
| Handle honesty | `badge: claimed \| shown as claimed, never as verified` |
| X path fails honestly | `No X access token yet — nothing was sent` |
| Errors | `none` |

Source: `editor/src/` — 12 modules, four publish targets (`nostr-30023`,
`node-page`, `x-article`, `x-export`).

The decline path is the one worth naming to users: an editor that publishes on
refusal loses the entire trust argument in one bug, and here it is asserted by a
test rather than promised.

### Primitives the signer needs — all present

| Piece | Path | Status |
|---|---|---|
| Passkey / PRF derivation | `crypto/src/webauthn.ts` | built, in **119/119** |
| Origin guard + RP ID | `crypto/src/origin.ts` | built, V5-tested |
| Build attestation | `signer-log/src/{attest,verify}.ts` | **20/20** |
| **NIP-46 backend** | `sdk/src/backends/nip46.ts` | built on `nostr-tools/nip46`, wired through `connect.ts`/`index.ts`/`types.ts`/`errors.ts`, in **34/34** |
| NIP-07 backend | `sdk/src/backends/nip07.ts` | built |
| Capability negotiation | `sdk/src/connect.ts` — `detect()`, `setup()` | built |
| Broker protocol | `spec/signer-broker.md` | **specification only** |

### Siblings

`recovery/` — every loss scenario walked to a stated outcome including
`[NOT RECOVERABLE]`, `errors: none`. `explorer/` — `/who` builds to
`explorer/dist/who.html`, a single self-contained file.

---

## 4. The RP ID decision — settled, on deployed evidence

I argued three positions on `rpIdFromOrigin`. **Position 1 was correct; position 2
was a mistake; this is position 3.**

**The architecture is two layers, and the provisioning file says so.**

**Layer 1 — Related Origin Requests, for origins we operate.**
`infra/cloud-init.xonly.yaml:25`:

> `signer.xonly.ai` — the signer origin. **RP ID is `xonly.ai`, NOT this hostname**

with the apex configured to serve `/.well-known/webauthn`, and the closing note:

> The ROR origins list is **EMPTY on purpose.** Add `bermlaunch.com` only after
> the signer is deployed and verified — **every entry is a full grant of identity
> power to that origin.**

**Layer 2 — the broker popup, for everyone else.** `spec/signer-broker.md:24-30`
forbids giving *third-party clients* the credential, because clients sharing an RP
ID share `prf_out`. Clients never call WebAuthn; they ask, in a top-level popup
where the browser's own address bar is the anti-phishing story.

**These are different mechanisms.** My withdrawal conflated them: it read a rule
about third-party clients as a prohibition on ROR across our own surfaces. A
curated allowlist that is empty by default is not an open grant.

**Consequence:** `crypto/src/origin.ts:57` returns `u.hostname`, so
`crypto/src/webauthn.ts:68` passes `rp.id = "signer.xonly.ai"` — inconsistent with
the deployed intent. Fix is the registrable domain via the Public Suffix List
(last-two-labels breaks `foo.co.uk`). Negative vector **V5** needs rewriting, since
its two origins share one registrable domain.

**`bermlaunch.com` is a broker client, not a ROR entry**, unless deliberately
granted — which the provisioning note warns against doing lightly.

### The subid model, recorded here because it lived only in conversation

`bermlaunch.xonly.ai` is **client zero** of the signer: a registered client with a
display name and icon, so an approval reads *"bermlaunch wants you to sign"*. Per
`spec/signer-broker.md`, an API key buys **presentation, not permission** —
unregistered origins are *named loudly*, never blocked, because blocking would make
us the gatekeeper of who may ask a user for a signature.

**Where @bermlaunch's own key lives: the xonly.ai signer.** That decision was made
and never written down until now.

---

## 5. Claims this file previously carried that were false

| Was written | Actually | How it got in |
|---|---|---|
| *"no `nip46.ts` anywhere in this repo — grep returns nothing"* | 8 files, wired, tested | the `grep` ran from `editor/` after a stray `cd` |
| *"the signer origin does not exist"* | live since provisioning, `signer-ok` | never fetched the host |
| *"`u.hostname` is correct — finding withdrawn"* | wrong; see §4 | reasoned from a spec instead of reading the provisioning file |

---

## 6. OPEN — verified absent from the repository root

| # | Item | Evidence of absence | Why it matters |
|---|---|---|---|
| 1 | **`ncryptsec` / NIP-49 export** | `grep -rln "ncryptsec\|nip49\|scrypt"` from root → **zero files** | `ENROLLMENT-SPEC.md §1.1` makes the download **non-optional** and blocks "continue" until it exists. **Tier 1 has no exit, so the default enrollment path cannot ship** |
| 2 | **Signer application** | `signer.xonly.ai/` serves the placeholder | no tier 1 at all |
| 3 | **ROR allowlist** | `xonly.ai/.well-known/webauthn` → 404 | one passkey cannot serve apex, signer and editor |
| 4 | **`rpIdFromOrigin` fix** | `crypto/src/origin.ts:57` | **unrepairable after the first passkey exists** |
| 5 | **`postMessage` channel** | not implemented | no third-party signing |
| 6 | **`nostrconnect://` QR** | `grep -rn "nostrconnect"` from root → **zero hits** | pasting a `bunker://` URI on a phone is the friction that loses people — `ENROLLMENT-SPEC.md §5` |
| 7 | **Content on the apex** | `xonly.ai/` placeholder | nothing to read |

**Not blocking the canary:** API-key issuance for third-party devs · long-form
posts rendered under each handle · three-way linking in `post/`.

---

## 7. The honest shape

For the canary you need **the editor** (built, verified), **a signer application**
(absent — composition of tested primitives into a live, hardened origin), and
**`ncryptsec`** (absent, and it is the one that decides whether the default path
exists at all).

The risk is not difficulty. It is that `spec/signer-broker.md` reads like a
finished thing — precise, opinionated, correct — and **specifications do not serve
HTTP**. `signer-log` passing 20/20 does not mean a user can log in.

### The option worth taking on merit

**Ship the canary with tier 0 and tier 2 only** — NIP-07 extension and NIP-46
bunker. Both backends are **built and tested today** (`sdk/` 34/34). Both are paths
the project already tells users are *better* than its own tier 1. GPT's readiness
map models the broker as a **conditional** dependency (`SIG-06`,
`SIGNER_XONLY_BROKER_ENABLED`), so this is a sanctioned shape rather than a
workaround.

That makes item 6 (`nostrconnect://` QR) blocking instead of items 1–5, which is a
much smaller build — and the enrollment copy gets to say the thing it wanted to say
anyway: *bring your own signer; ours is the fallback, and it is coming.*
