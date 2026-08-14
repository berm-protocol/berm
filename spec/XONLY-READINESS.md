# xonly.ai — editor and signer, readiness for the canary

Same grading as `bags/CANARY-READINESS.md`: **VERIFIED** (I ran it, or `file:line`
here) · **REPORTED** (a pack says so, unreproduced) · **ASSERTED** (prose, no
artifact) · **OPEN**.

The headline: **the editor is real, the signer origin is real, the signer
application is not.** `signer.xonly.ai` is live, hardened and answering
`signer-ok` — it just serves *"Provisioned. Nothing deployed yet."* The remaining
job is deploying an app into a correctly configured origin, not building one.

---

## 1. The editor — VERIFIED, and stronger than expected

`npm run verify` in `editor/` runs a genuine end-to-end against two local relays.
Observed this run:

| Claim | Evidence from the run |
|---|---|
| Signs and publishes NIP-23 long-form | `EVENT c07e1f4abb06… sig=VALID -> stored`, accepted by both relays |
| Addressable and resolvable by any client | `30023:c1cc626…:your-identity-should-outlive-the-platform` |
| **Decline publishes nothing** | `relay A stored: 0 (must be 0)` — the property most editors get wrong |
| Card renders as a real image | `card is a real PNG data URL: true \| bytes: 741KB` |
| Handle honesty | `badge: claimed \| shown as claimed, never as verified` |
| X path fails honestly | `No X access token yet — nothing was sent`, exact request shown |
| Errors | `none` |

Source: `editor/src/` — 12 modules, four publish targets (`nostr-30023`,
`node-page`, `x-article`, `x-export`).

The decline path is the one worth naming to users. An editor that publishes on
refusal is the whole trust argument lost in one bug, and this one is asserted by
a test rather than by a promise.

**Sibling packages, also VERIFIED:** `recovery/` — `npm run verify` walks every
loss scenario to a stated outcome including `[NOT RECOVERABLE]`, `errors: none`.
`signer-log/` — 20/20. `crypto/` — 119/119, including V5.

---

## 2. The signer — origin live, application absent

There is **no `signer/` package in this repo**, but the origin it would deploy
into is provisioned and serving. What exists:

| Piece | State |
|---|---|
| `spec/signer-broker.md` | written, and good — popup not iframe, NIP-46 vocabulary, *"an API key buys presentation, not permission"* |
| `crypto/src/webauthn.ts` | the passkey primitive |
| `crypto/src/origin.ts` | origin guard + RP ID derivation, V5-tested |
| `signer-log/src/{attest,verify}.ts` | attestation log, 20 tests |
| The signer **origin** | **LIVE.** `signer.xonly.ai/health` → `signer-ok`, TLS, hardened headers, `frame-ancestors 'none'`, its own CSP. Provisioned and correct |
| The signer **application** | **absent.** `signer.xonly.ai/` serves *"Provisioned. Nothing deployed yet."* |
| ROR allowlist at `xonly.ai/.well-known/webauthn` | **404.** Empty on purpose per the provisioning note — *"every entry is a full grant of identity power to that origin"* — but nothing serves it yet |
| A NIP-46 backend | **EXISTS** — `sdk/src/backends/nip46.ts`, built on `nostr-tools/nip46`, wired through `connect.ts`, `index.ts`, `types.ts`, `errors.ts`, covered by `sdk/test/sdk.test.ts` (34/34). **An earlier revision of this file claimed it did not exist. That was wrong** — the grep behind it ran from `editor/` after a stray `cd`, so it searched one subdirectory and reported the whole repo. Re-run from the root, it returns eight files |
| `nostrconnect://` QR | **absent** — `nip46.ts` takes a pasted `bunker://` URI; the reverse QR flow in `ENROLLMENT-SPEC.md §5` is not built |
| `ncryptsec` / NIP-49 export | **absent** — confirmed from the repo root, zero files. This one stands |

So: every primitive is built and tested, and the origin is live and hardened.
What is missing is the page that composes them — plus the ROR allowlist that makes
the credential usable across our own surfaces.

### `rpIdFromOrigin` — I argued three positions. Here is the settled one and why

**Position 1:** RP ID must be `xonly.ai`, not `signer.xonly.ai`. **Position 2:**
withdrawn — `spec/signer-broker.md:28` forbids RP-ID sharing, so `u.hostname` is
right. **Position 3, and this one stands:** position 1 was correct.

The withdrawal conflated two different mechanisms. The broker spec forbids handing
the credential to **third-party clients** — *"Client B's JavaScript would receive
the same `prf_out`"*. It says nothing against **Related Origin Requests across
origins we operate ourselves**, which is a curated allowlist, not an open grant.

The deployed infrastructure runs both, and says so plainly.
`infra/cloud-init.xonly.yaml:25`:

> `signer.xonly.ai` — the signer origin. **RP ID is `xonly.ai`, NOT this hostname**

with the apex provisioned to serve `/.well-known/webauthn`, and the final
provisioning message:

> The ROR origins list is **EMPTY on purpose.** Add `bermlaunch.com` only after
> the signer is deployed and verified — **every entry is a full grant of identity
> power to that origin.**

So the architecture is two-layer: **ROR** for apex / signer / editor, empty by
default and expanded only deliberately; **broker popup** for everyone else, who
receive signatures and never credentials. `bermlaunch.com` is a broker client, not
a ROR entry, unless explicitly granted.

`crypto/src/origin.ts:57` returning `u.hostname` is therefore inconsistent with the
deployed intent, and `webauthn.ts:68` passes the wrong `rp.id` today.

**Why trust this position over the previous two:** both of those were reasoning
from documents. This one is the provisioning file declaring the intended RP ID,
plus a live fetch showing the ROR path returns 404 because nothing has been
deployed into it yet.

---

## 3. What we need, for canary day

### 3a. Blocking — the origin is live, the application is not

Correction to an earlier revision of this file: I wrote that the signer origin did
not exist. It does, and it has since provisioning. What is missing is the app
inside it. That is a materially smaller job — deploying into a hardened, correctly
configured origin rather than standing one up.

| # | Item | Closed when |
|---|---|---|
| 1 | **The signer application** | `signer.xonly.ai/` serves a page that creates a passkey, derives the identity key, and signs an event — replacing *"Provisioned. Nothing deployed yet."* Built from existing `crypto/` primitives: composition, not new cryptography |
| 1b | **The ROR allowlist** | `xonly.ai/.well-known/webauthn` returns a document instead of 404, and `rpIdFromOrigin` returns the registrable domain so the credential is actually scoped to it |
| 2 | **`postMessage` request/response channel** | a client at another origin obtains a signature and never sees `prf_out`. Asserted in a browser test, cross-origin, not same-page |
| 3 | **Origin allowlist** | the signer refuses to sign for an unregistered client origin. The allowlist is the product; `assertSignerOrigin` already exists to enforce it |
| 4 | **Deploy to the box** | `xonly.ai` is live with TLS and serving nothing. Two paid hosts, zero content |

### 3b. Needed if Bermers are told a bunker is the better path

| # | Item |
|---|---|
| 5 | **`ncryptsec` / NIP-49 export** — genuinely absent, and it is the load-bearing one. `ENROLLMENT-SPEC.md §1.1` makes the download **non-optional** and blocks "continue" until it exists. Without it, tier 1 has no exit and the default path cannot ship. (The NIP-46 backend itself is built and tested — see above) |
| 6 | **`nostrconnect://` QR** — specced in `ENROLLMENT-SPEC.md §5`; pasting a `bunker://` URI on a phone is the friction that loses people |
| 7 | **`ncryptsec` download before continue** — specced; acceptance is *"Continue is unreachable until the backup is downloaded"* |

### 3c. Not blocking for the canary

| # | Item |
|---|---|
| 8 | API keys for third-party devs — the broker spec's commercial layer. `bermlaunch.xonly.ai` is client zero and needs no key issuance to work |
| 9 | Long-form posts rendered under each handle on xonly.ai — the content product |
| 10 | Three-way linking in `post/` |

---

## 4. The honest shape of it

For the canary you need **the editor** (done), **a signer application** (not
started, but composition of tested parts, deploying into an origin that is already
live and hardened), and **content on the apex** (not started).

The risk is not difficulty. It is that `spec/signer-broker.md` reads like a
finished thing — precise, opinionated, correct — and specs do not serve HTTP.
`signer-log` having 20 green tests does not mean a user can log in.

If the canary slips, this is where it slips: the editor's polish makes the stack
feel further along than the signer's absence allows.

### The cheapest honest option

If the signer origin will not be ready, **ship the canary with tier-0 and tier-2
only** — NIP-07 extension and bunker. Both are paths the project already says are
*better* than tier 1 anyway. Item 5 becomes blocking instead of item 1, and the
enrollment copy tells the truth it already wanted to tell: bring your own signer,
ours is the fallback, and it is coming.

That is a smaller build and a more sovereign launch. It is worth considering on
the merits, not only as a fallback.
