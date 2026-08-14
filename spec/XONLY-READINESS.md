# xonly.ai — editor and signer, readiness for the canary

Same grading as `bags/CANARY-READINESS.md`: **VERIFIED** (I ran it, or `file:line`
here) · **REPORTED** (a pack says so, unreproduced) · **ASSERTED** (prose, no
artifact) · **OPEN**.

The headline: **the editor is real and the signer is not.** One is a working
product with an end-to-end proof; the other is an excellent document. Do not let
the quality of the document disguise which is which.

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

## 2. The signer — spec only

There is **no `signer/` package in this repo.** What exists:

| Piece | State |
|---|---|
| `spec/signer-broker.md` | written, and good — popup not iframe, NIP-46 vocabulary, *"an API key buys presentation, not permission"* |
| `crypto/src/webauthn.ts` | the passkey primitive |
| `crypto/src/origin.ts` | origin guard + RP ID derivation, V5-tested |
| `signer-log/src/{attest,verify}.ts` | attestation log, 20 tests |
| The signer origin as a deployable app | **does not exist** |
| A NIP-46 backend | **EXISTS** — `sdk/src/backends/nip46.ts`, built on `nostr-tools/nip46`, wired through `connect.ts`, `index.ts`, `types.ts`, `errors.ts`, covered by `sdk/test/sdk.test.ts` (34/34). **An earlier revision of this file claimed it did not exist. That was wrong** — the grep behind it ran from `editor/` after a stray `cd`, so it searched one subdirectory and reported the whole repo. Re-run from the root, it returns eight files |
| `nostrconnect://` QR | **absent** — `nip46.ts` takes a pasted `bunker://` URI; the reverse QR flow in `ENROLLMENT-SPEC.md §5` is not built |
| `ncryptsec` / NIP-49 export | **absent** — confirmed from the repo root, zero files. This one stands |

So: every primitive the signer needs is built and tested. The thing that composes
them into an origin a browser can visit is not started.

### Correction — one I had wrong for several turns

I said repeatedly that `rpIdFromOrigin` must return `xonly.ai` rather than
`signer.xonly.ai`, and called it unfixable after the first enrollment. **That was
wrong.** `spec/signer-broker.md:24-30`:

> The tempting design is to let every client share the RP ID … **it is
> unshippable.** Clients sharing an RP ID share the **credential**. Client B's
> JavaScript would receive the same `prf_out` … and sign as any of A's users.

Clients never call WebAuthn. The signer does, in a top-level popup where the user
sees the real URL bar. So `u.hostname` is correct, V5's *"the same passkey cannot
be used from a second origin"* is the intended property, and my proposed fix would
have broadened the credential to every `*.xonly.ai` origin — causing precisely the
failure the architecture refuses.

Federation comes from **the broker**, not from credential sharing. That was
already solved; I was solving it twice and the second solution was harmful.

---

## 3. What we need, for canary day

### 3a. Blocking — the canary cannot use a signer that does not exist

| # | Item | Closed when |
|---|---|---|
| 1 | **The signer origin app** | `signer.xonly.ai` serves a page that creates a passkey, derives the identity key, and signs an event. Built from the existing `crypto/` primitives — this is composition, not new cryptography |
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

For the canary you need **the editor** (done), **a signer origin** (not started,
but composition of tested parts), and **a deploy** (not started, trivial).

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
