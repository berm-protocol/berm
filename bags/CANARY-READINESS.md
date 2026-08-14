# Canary launch — readiness

**Rewritten from a corrected baseline at commit `7ce22bf`.** Earlier revisions of
this file carried four claims that were false. They are listed in §6 rather than
deleted, because how they got in matters more than that they are gone.

---

## 0. The evidence rule

> **No claim enters this file unless it was produced by running something.**
> A test executed, a script reproduced, a live host fetched, or `file:line` read
> from the repository **root**.

Specifically, and because each of these produced a false claim in an earlier
revision:

- **No absence claim** unless the search ran from the repository root. A `grep`
  after a stray `cd` reports on one subdirectory and reads like the whole repo.
- **No deployment claim** unless the host was fetched. "Serving nothing" and
  "does not exist" are different facts.
- **No architectural claim** from a specification alone where a provisioning file,
  config, or running system can be consulted instead. Documents describe
  intentions; the deployed system is the intention that survived.

Grades: **VERIFIED** (produced by execution) · **REPORTED** (someone's pack says
so, unreproduced) · **OPEN** (known not done).

**REPORTED is not VERIFIED.** The sealed R1 pack was manifest-clean, honestly
self-classified, and still shipped an undisclosed bypass.

---

## 1. VERIFIED — test suites, run at `7ce22bf`

| Package | Result |
|---|---|
| `crypto/` | **119/119** |
| `bags/` | **181/181** |
| `landing/` | **89/89** + 31 browser checks |
| `post/` | **68/68** |
| `sdk/` | **34/34** |
| `graph/` | **24/24** |
| `signer-log/` | **20/20** |
| `node-pages/` | **18/18** |

**553 assertions.** Plus browser end-to-end suites in `editor/` and `recovery/`,
both `errors: none`.

### Guards, all passing

`scripts/check-vectors-frozen.mjs` · `check-supply-chain.mjs` (311 files) ·
`check-package-graph.mjs` · `check-ci.mjs` · `check-readme.mjs` ·
`check-no-machine-paths.mjs` · `check-caddyfile.mjs` (takes a path argument;
running it bare prints usage and exits non-zero — that is not a failure, and an
earlier draft of this section recorded it as one).

---

## 2. VERIFIED — protocol facts, with anchors

| Fact | Anchor |
|---|---|
| npub → EVM derivation, both parity branches | `bags/vectors/pocket-address.json`, `crypto/vectors/test-vectors.json`; reproduce byte-identically |
| Derivation anchor | key `1` → `0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf` |
| Bags claimer ceiling | `MAX_CLAIMERS = 100` — `bags/src/bags.ts:102` |
| Solana case-mangling detector | `solanaAddressIsCaseMangled()` — `bags/src/bags.ts:96` |
| `BagsFeeShare.owner()` is the **factory** owner; `renounceOwnership()` reverts | **proven on a fork at block 28814524** — `bags/SOVEREIGNTY.md:35` |
| Upstream authority disclosure | `bags/SOVEREIGNTY.md`, 12-row table |
| NIP-46 backend | `sdk/src/backends/nip46.ts`, wired through `connect.ts`/`index.ts`/`types.ts`/`errors.ts` |
| Intended RP ID | *"RP ID is xonly.ai, NOT this hostname"* — `infra/cloud-init.xonly.yaml:25` |

---

## 3. VERIFIED — live infrastructure, fetched at review time

| Host | `/health` | `/` |
|---|---|---|
| `bermlaunch.com` | `berm-ok` | *"Server up, TLS working. Nothing deployed yet."* |
| `xonly.ai` | — | *"Provisioned. Nothing deployed yet."* |
| `signer.xonly.ai` | `signer-ok` | *"Provisioned. Nothing deployed yet."* |
| `editor.xonly.ai` | — | *"Provisioned. Nothing deployed yet."* |
| `xonly.ai/.well-known/webauthn` | — | **404** — the ROR allowlist is not served |

**All four hosts are provisioned, hardened placeholders.** TLS, HSTS, per-host CSP,
`frame-ancestors 'none'` on the signer — `infra/Caddyfile.xonly`.

### The deploy pipeline is built

`infra/cloud-init.bermlaunch.yaml:201` — `/usr/local/bin/bermlaunch-deploy`:
clones or fast-forwards `GIT_REMOTE`, **refuses to publish if `PUBLISH_DIR` is
missing** (*"refusing to publish an empty site"*), swaps by rename so no visitor
sees a half-copied tree, reloads Caddy, prints the live commit.

`PUBLISH_DIR=public` — line 199. **No `public/` tree exists in this repo yet**, so
deploying needs an assembly step, not new content: `landing/` verifies 89/89 + 31
browser checks, `explorer/dist/who.html` is built.

**Deploying is: generate a deploy key → add it to the repo → set `GIT_REMOTE` in
`/etc/bermlaunch.env` → `sudo bermlaunch-deploy`.** Not a project.

---

## 4. REPORTED — Codex packs, and what I reproduced

Manifests verified: continuity pack **390/390**, blocked pack **82/82**, replay
envelope **6/6 inputs**, disposable reconstruction **55/55**.

**Reproduced by execution — these are VERIFIED, not reported:**

| Finding | Result |
|---|---|
| `legacy_roster_wallet_v0` **closed** | production compile with zero enrollments throws `missing_verified_enrollment` |
| Historical root preserved, non-finalizable | `0x30b9a085…c1a2`, `UNPROVEN_HISTORICAL`, `finalizable: false`, portable bundle throws |
| Observation passthrough — `enrollmentRoster.js:122` | C1–C6 compiled `PRODUCTION_VERIFIED_ENROLLMENT` with a fabricated receipt; **C4 compiled even with a correct outsider policy** |
| Destination selection | **C9** — attacker-supplied sequence 99 put the attacker's wallet in the leaf |
| Trust surface fail-open — `trustVerify.js:58-75` | **F1** `protocol = null` → **5/5** guards true, destination renders `Loading` |
| Two guards are tautologies | `enrollmentPortableAfterFinalization`, `enrollmentBrokerDisclosureVisible` — match a hardcoded literal against a substring of itself |
| Empty observer policy is permissive | rogue observer accepted under `null` **and** `{observerPubkeys: []}`; populated policy correctly throws |
| FIX-03 regex unfit | **6 false negatives, 1 false positive** — misses `trustedObservation`, blocks `?? "UNVERIFIED"` |
| Controller-only binding correct | one-shot, **zero** unbind/rebind paths; permissionless would permanently brick the Distributor |

**Still REPORTED, never reproduced by me:** the enrollment protocol library's
internals — mode/campaign in both preimages, duplicate-tag rejection, EIP-191
mandatory, parity at generation, no compressed-pubkey trap. Read, not re-derived.

---

## 5. OPEN — what actually blocks the canary

### 5a. Yours alone — no dependency on anyone

| # | Item | Anchor | Closed when |
|---|---|---|---|
| 1 | **`manager_waive_fee_config`** | BDR-002; `bags/README.md:462` | a published tx signature. Until then *"the dev cannot redirect the split"* is false |
| 2 | **`rpIdFromOrigin`** | `crypto/src/origin.ts:57` returns `u.hostname`; `webauthn.ts:68` passes it as `rp.id` | returns the registrable domain (needs the Public Suffix List). **Unrepairable after the first passkey exists** — see §7 |
| 3 | **Rotate Bags API key + Hetzner token** | both in a chat transcript | rotated |
| 4 | **Enrollment disclosure copy** | `spec/WHAT-IT-DOES.md` §13, §14 | the sentence a Bermer reads *before* signing |
| 5 | **Canary scope decision** | claimers fixed at `create_fee_config` | explicit: does the canary carry real Founders? Recommended **no** |
| 6 | **`SOVEREIGNTY.md:34`** | reads *"Stronger than any Solana admin power"* | corrected to match the B-04 ruling |
| 7 | **Cohort finalization counts** | `bags/src/campaign.ts` has no size gate; historical spec required *exactly* 100/300 | one law, stated once |
| 8 | **Deadline anchoring** | `bags/src/subscribe.ts:25-29` — `created_at` MUST NOT order anybody | pre-committed rule + anchored snapshot |

### 5b. Build — verified absent from the repository root

| # | Item | Evidence of absence |
|---|---|---|
| 9 | **`ncryptsec` / NIP-49 export** | `grep -rln "ncryptsec\|nip49\|scrypt"` from root → **zero files**. `ENROLLMENT-SPEC.md §1.1` makes the download non-optional, so **the default enrollment path cannot ship** |
| 10 | **`nostrconnect://` QR** | `grep -rn "nostrconnect"` from root → **zero hits**. Specced in `ENROLLMENT-SPEC.md §5` |
| 11 | **Signer application** | `signer.xonly.ai/` serves the placeholder. Origin is live; the page is missing |
| 12 | **ROR allowlist** | `xonly.ai/.well-known/webauthn` → 404 |
| 13 | **`public/` assembly** | deploy expects it; repo has none |

### 5c. Codex — verify on delivery, never accept on report

| # | Item | Evidence that closes it |
|---|---|---|
| 14 | `enrollmentRoster.js:122` passthrough removed | closure e2e passes **without** pre-attaching `trustedObservation` |
| 15 | Non-empty observer policy enforced **at the compiler** | rogue-observer fixture rejected with `observerPolicy: null` |
| 16 | `trustVerify.js` defaults fail closed | `protocol = null` → no affirmative string in the DOM |
| 17 | Library wired to the app | an import of `enrollmentProtocol` in `apps/` |

### 5d. Bags — parallel, gates nothing

Case-preserving claimer route (Solana) · whether `BagsFeeShare` ownership can sit
with the launcher (EVM). Both **disclosure items**: the failure is shared, which
makes the arrangement **honest, not safe** — and item 4 must say which.

---

## 6. Claims this file previously carried that were false

| Was written | Actually | How it got in |
|---|---|---|
| *"no `nip46.ts` anywhere in this repo"* | 8 files, tested | `grep` ran from `editor/` after a stray `cd` |
| *"the signer origin does not exist"* | live since provisioning | never fetched the host |
| *"`u.hostname` is correct, finding withdrawn"* | wrong | reasoned from `signer-broker.md` instead of reading `cloud-init.xonly.yaml` |
| *"you cannot launch the canary until Bags answers"* | wrong | the founder corrected it; `bags/README.md:462` already said so |

Every one is the same shape: **a conclusion offered in place of the method that
produced it** — the exact defect this file exists to catch in other people's work.
Hence §0.

---

## 7. Order

**2 first.** It is the only item that cannot be repaired after launch: changing the
RP ID orphans every passkey already created. Then **1 and 3** — cheap, yours,
unblocked. Then **9** — without it the default enrollment path does not exist.

Then 4–8. Then 11–13. Then 14–17 on Codex delivery.

5d runs alongside and blocks nothing.
