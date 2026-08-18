# Enrollment — implementation specification

**For an implementer.** Design is settled; this is what to build, in what order, and
what must not be built. Where this disagrees with `POCKET.md`, this file wins.

> ## Revision 2 — the pocket is not imposed on everyone
>
> Revision 1 derived an EVM address from the npub for **every** user. That is
> right for someone arriving with no identity and wrong for someone arriving with
> one, because it quietly requires them to export an established identity key and
> import it into a wallet. Two paths now, and they are deliberately different.
>
> **Path A — no existing Nostr identity.** Generate, derive the pocket, done.
> **Path B — an existing npub (NIP-07, NIP-46, any signer).** Require an explicit
> EVM wallet. **Never silently derive.**
>
> And the vectors changed with it. Revision 1 exposed a separate
> `spendingKeyHex`, so a user who exported their nsec and imported it into a
> wallet would have landed on a **different address than the one displayed**. The
> secret is now normalised for BIP-340 parity **at generation**, so what they
> export is what controls the address. `vectors/pocket-address.json` is version 2
> and the field is gone rather than documented.
>
> **Enrollment is an upstream identity layer. It does not define the economics.**
> The pocket, in BermLaunch, is the cumulative WETH entitlement inside the
> immutable Distributor; the EVM address is the authority that spends it and the
> destination the launched token is delivered to. Nothing here replaces the
> buyback, the graduation gate, or the cumulative accounting.

Companion artefacts:
- `vectors/pocket-address.json` — **v2**, frozen. 10 vectors, both parity branches at generation, no `nsec` field
- `POCKET.md` — why the pocket works
- `SOVEREIGNTY.md` — what may and may not be claimed

---

## 1. The two doors

> ### Revision 3 — the file is the front door
>
> Revision 2 ordered four paths *by how little the user ends up depending on us*.
> The ordering was right and the shape was wrong: the path that depends on us
> least was third in a list nobody finishes reading, and the path that depends on
> us most was the one that looked easiest.
>
> **The portable encrypted key is now tier 1.** The passkey at our signer origin
> is demoted to an optional convenience, deferred, and not required for launch.
>
> Three reasons, in order of weight:
>
> 1. **It is the only tier that depends on nobody.** Tier 2's own copy admitted
>    *"that is a real dependency and you should not accept it permanently."* A
>    project whose argument is sovereignty should not make the sovereign option
>    the advanced option.
> 2. **There is no gap to explain.** The file **is** the key **is** the pocket.
>    With a passkey the user holds a gesture and the key is derived at an origin
>    they must trust — true, disclosed, and awkward to say out loud.
> 3. **It removes the only unrepairable decision from the critical path.**
>    `rpIdFromOrigin` is irreversible solely because changing the RP ID orphans
>    passkeys that already exist. If no passkey is ever created, nothing is baked
>    in, and that fix becomes ordinary work owed before tier 2 ships. See §1.4.

Two doors, and nothing else on the screen.

### 1.0 Door zero — a signer is already present. Short-circuit.

`window.nostr` detected, or a bunker session already established: **use it, and say
so.** A user with an extension already made a custody decision, and overriding it
to push our own is precisely the behaviour this project claims to be an
alternative to. `sdk/src/connect.ts` — `detect()` then `setup()` — already prefers
NIP-07 when present. Do not fight it.

This is not an option in a list. It is a branch taken before the list is drawn,
and it is the door savvy users take. **They will not upload a raw key to a web
page and should not be asked to.**

### 1.1 Door one — the file. The default, PATH A ONLY.

Generate a fresh secp256k1 key in the browser. **Immediately** offer the NIP-49
`ncryptsec` download, passphrase chosen by the user.

They walk away with a portable, standard-format key that works in Amber, Damus,
Alby, nsec.app, or anything invented later. **They depend on us for nothing from
the first second**, and can choose a signer a week from now having lost nothing.

Copy must state, without softening:

> Your key is created here, in this browser tab. That is fast, and it is the
> weakest place a key can be made — so download it now, encrypted with a
> passphrase only you know. Then it works in any Nostr app, forever, with or
> without us.

**The download is not optional.** "Continue" stays unreachable until the file has
been generated and the passphrase confirmed. This is the only place in the product
where blocking a user is justified: someone who leaves without it has an identity
and a pocket that exist only in a browser tab.

Everything about the file — parameters, the passphrase screen, backup guidance,
and how it is later unlocked — is §3, which is now the longest section in this
document for a reason.

### 1.2 Bring your own → PATH B

A user arriving with an existing npub takes **Path B**, and Path B does not use a
derived pocket. Require an explicit EVM wallet, bound from both sides:

```
npub signs        "<evm address> is my destination for campaign <id>"
evm wallet signs  "<npub> may direct payments to me for campaign <id>"
```

Both signatures, or the binding is not accepted. One side alone proves half of a
two-sided claim.

The binding is replaceable — by a **new, valid, dual-signed binding** — up until
the cohort root is finalised. **After finalisation the destination committed in
the root is frozen**, because it is inside the leaf.

Why not derive for these users: they would have to export an established identity
key, work out BIP-340 parity, and import it into MetaMask — coupling an identity
they already use elsewhere to a wallet, for one launchpad. They already have an
EVM wallet. Ask for it.

Amber and Damus connect via `nostrconnect://` QR (§5); Alby and nos2x via NIP-07.

### 1.3 Deferred — passkey at our signer origin

Face ID / Touch ID, no download, no app. **Not built for launch, and not
required.** When it ships it is offered *after* the file, labelled as a real
dependency, with `ncryptsec` export reachable from the account screen at all times.
That export *is* the exit from the tier, and offering it before anyone has a reason
to distrust us is the strongest form of the claim we make.

### 1.4 What deferring tier 2 buys, stated so it is not lost

No passkey means no WebAuthn ceremony, which means **no RP ID is committed**.
`crypto/src/origin.ts:57` currently returns `u.hostname` while
`infra/cloud-init.xonly.yaml:25` declares the intended RP ID to be `xonly.ai` —
a genuine inconsistency, and one that is *only* irreversible once credentials
exist. Shipping the file first converts it from a now-or-never decision into work
owed before tier 2, alongside the ROR allowlist at
`xonly.ai/.well-known/webauthn`.

### 1.5 Custody display, unchanged and non-negotiable

**Every path shows the custody tier at all times — and for tier 2, WHICH signer.**
"Bunker" is not a custody property. Amber on a phone in a pocket, `nsec.app` as a
web service, and a self-hosted daemon on a VPS are all NIP-46 and their properties
are not the same. Show what is known about the actual signer rather than a tier
number that flatters the weakest member of the category. A single connect button
that hides which of these the user landed in is the version of this product that
does not deserve to exist.

---

## 2. The pocket

**Path A only.** A user who arrived with an existing npub gets an explicit wallet
(§1.3), not this.

```
d      = raw if y(raw·G) is even else (n − raw)    ← AT GENERATION
xonly  = x-coordinate of d·G, 32 bytes
npub   = bech32('npub', xonly)
                                                    (the user exports d, bech32 as nsec)
addr   = keccak256(x ‖ y)[12:] of d·G, EIP-55
```

**Normalise at generation, not at spend time.** Revision 1 kept the raw key and
carried a separate `spendingKeyHex`. A user who exported their nsec and imported
it into a wallet would have arrived at **a different address than the one we
showed them** — plausible, funded, and not theirs. Normalising first makes the
exported secret the one that controls the address, and the field is deleted rather
than explained.

Negation does not change the npub: x-only is the x coordinate, and negation
preserves it. So this costs nothing and removes a trap.

**Assert `secretKeyHex` is even-y.** Do not assume it — a future refactor that
reintroduces the raw key would otherwise fail silently, months later, in the one
place nobody is watching.

`vectors/pocket-address.json` is **version 2**, frozen, covers both parity
branches at generation, and includes an external anchor: secret key `1` derives to
`0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf`, the canonical Ethereum address for
that key. If an implementation disagrees with that line, it is wrong, and no
further debugging is required to know it.

Every implementation — TypeScript, Solidity, anything else — must pass these
vectors before it is wired to anything.

**Display rule:** never show the pocket address without saying where it came from.
An address that appears without explanation reads as one we chose for the user.

> `0xeb88…` — computed from your key. Not assigned to you. Only your key opens it.

---

## 3. The file — generation, passphrase, backup, unlock

This is tier 1. It is the whole custody story for most users, so it is specified
here rather than left to an implementer's judgement.

### 3.1 Format — NIP-49, non-negotiable parameters

| | |
|---|---|
| KDF | scrypt, `r=8`, `p=1` |
| `log_n` | **16** for browser-generated keys. Higher only if measured on real phones — a mobile tab cannot do 22 |
| Cipher | XChaCha20-Poly1305 |
| **Key-security byte** | **`0x00`** for anything generated in a browser. It means *handled insecurely* and that is the truth |
| Encoding | bech32, `ncryptsec1…` |
| Filename | `berm-<campaign>-<cohort>-<slot>.ncryptsec` |

Writing `0x01` because it reads better is lying in a field that exists to prevent
exactly that lie. Clients that warn the user are doing their job.

### 3.2 The passphrase screen is a screen, not a field

**Now that the file is tier 1, the passphrase is the entire security boundary.**
A passkey delegates that work to a secure enclave. A file delegates it to whatever
the user typed. Build it accordingly:

- a dedicated step, not an input beside a button
- strength enforced, with the check run locally and the reason shown
- no "skip", no "remind me later", no default
- confirmed by re-entry before the file is issued
- **never transmitted, never stored, never recoverable.** There is no reset

Next to the field, not in a help page:

> This passphrase is the only thing protecting the file. scrypt buys time against
> guessing; it cannot rescue a weak passphrase. **This file is also your pocket** —
> the same key opens your money.

### 3.3 Backup guidance at the moment of download, not later

`recovery/` already tells users the truth that a lost key is `NOT RECOVERABLE`.
The moment to prevent that is while the file is being created:

- **two copies, one of them offline.** A password manager plus a USB stick, or a
  printed `ncryptsec1…` string in a drawer
- not only `~/Downloads`, which is the folder that does not survive a new laptop
- the passphrase stored somewhere different from the file, because a single
  compromised location should not yield both

### 3.4 The unlock — and where it may happen

A file the user cannot use is a souvenir. To sign — to enroll, to claim, to prove
a slot — the key must be decrypted somewhere. **That somewhere is the signer
origin, and never the launchpad.**

```
   bermlaunch.com                            signer.xonly.ai
        │
        │  window.open() on a user gesture
        │─────────────────────────────────────▶  real URL bar, visible
        │                                        ┌──────────────────────────┐
        │                                        │ upload your key file     │
        │                                        │ passphrase: ________     │
        │                                        │ bermlaunch asks you to   │
        │                                        │ sign: "Claim slot 12"    │
        │                                        │ [ Approve ]  [ Decline ] │
        │  postMessage: signed event             └──────────────────────────┘
        │◀─────────────────────────────────────   decrypt → sign → discard
        │
   never sees the passphrase, never sees the decrypted key
```

**Why not decrypt at bermlaunch.** `spec/signer-broker.md` states the rule the
whole design serves: *"Only the signer origin ever sees a key. Clients receive
signatures."* And the file is not a login credential — §3.2 says it plainly, the
same key opens the money. A launchpad page is a large surface: token UI, charts,
third-party scripts, frequent deploys. A compromise there would take the identity
**and** the funds in one step. The signer origin exists to be small, boring, and
hard to change, and `infra/Caddyfile.xonly` already serves it with
`frame-ancestors 'none'` so the approval cannot be covered.

Rules for the unlock:

- decrypted key held **in memory only**, for the duration of the session
- **never** written to `localStorage`, `sessionStorage`, IndexedDB, or a cookie
- discarded on tab close, on timeout, and on explicit lock
- the passphrase never leaves the signer origin and is never sent anywhere
- the same origin guard as every other signer path — `assertSignerOrigin`

### 3.5 Phishing — the cost of this design, and the mitigation

A file model trains a reflex that attackers want: *upload your key here*. Passkeys
resist phishing because the browser binds a credential to an origin; a file has no
such protection, and anyone can stand up a convincing copy.

This is the real price of choosing the file, and it is paid in copy and habit
rather than in cryptography:

- **one sentence, repeated everywhere the file appears**, including in the
  downloaded file's own accompanying text:

  > We will never ask for this file anywhere except **signer.xonly.ai**. Check the
  > address bar every time. Nobody from Berm or BermLaunch will ever ask you to
  > send it — not in a DM, not by email, not in a support chat.

- the unlock is **always a top-level popup**, never an iframe, so the address bar
  is visible — the same reasoning as the broker approval
- **never publish an `ncryptsec` to a relay.** One passphrase away from being
  someone else's key, permanently, with no recall

### 3.6 Export is always available

Wherever a key exists in our custody — a future tier 2, or a live unlock session —
`ncryptsec` export is reachable from the account screen at all times, never buried.
That export is the exit, and offering it before anyone has a reason to distrust us
is the strongest form of the claim this project makes.

---

## 4. The signed enrollment — the wire contract

**Implemented: [`src/enrollment.ts`](src/enrollment.ts). Tested:
[`test/enrollment.test.ts`](test/enrollment.test.ts), 21 assertions.**

The v1 subscription could not distinguish Path A from Path B. It carried an
address tag, so the only way to tell them apart was to guess from what was
present — and the dangerous guess is the quiet one: *"no address, so derive from
the npub"*. For an existing Nostr user that names a plausible, fundable,
unopenable address.

**The mode is now stated in the signed object**, and in the signed control
message, so it can be neither inferred nor lifted between modes.

```
kind    30078
d       berm:enroll:v2:<campaign>
tags    campaign · mode · chain=evm · address · evm_proof · alt · handle?
mode    derived_v1 | bound_wallet_v1        ← versioned, no default
```

The EVM key signs one canonical preimage, which binds campaign AND mode:

```
berm.enroll.v2 ‖ campaign ‖ mode ‖ npub_hex ‖ evm_address_lowercase
```

### The invariant

> **No cohort root may commit an EVM destination unless control of that exact
> destination has been proven.**

Both modes require `evm_proof`. Neither is exempt. In `derived_v1` it proves the
parity normalisation happened — that the exported secret opens the committed
address. In `bound_wallet_v1` it proves the wallet is the user's.

### Validation

`derived_v1` — recompute the canonical address from the npub, require the
committed address to equal it, verify the proof recovers to that exact address.
**A missing derivation is not a pass**: unvalidated is not valid.

`bound_wallet_v1` — require an explicit address, verify the proof recovers to it,
and **reject an address equal to the derived one** — that is Path A wearing Path
B's label, and the two carry different promises about what the user was asked to
understand.

### Fail closed

Rejected, every one: missing mode · unknown mode · missing address · missing or
malformed proof · proof recovering to a different address · `derived_v1` with a
non-canonical address · a proof made for another mode or another campaign ·
**duplicate tags**, because two `mode` tags means two readers can reach two
conclusions about one signed object.

There is **no rule anywhere** saying a missing address means derive from the npub.

**Not** rejected: a `bound_wallet_v1` whose address happens to equal
`derive(npub)`. An earlier revision rejected it; G-02 overturned that and the
code follows. The control proof carries the security. What the coincidence does
create is a **disclosure duty** — a Path-B user was never told to back up a key,
so the UI must say what they are standing on before they sign. Copy, not
validator.

### Rebinding

A later valid enrollment supersedes an earlier one **only before the cohort root
containing the destination is finalised**. After finalisation the destination is
inside the leaf and inside the root, so it is frozen.

**OPEN — how "later" is determined is not yet specified, and the obvious answer
is wrong.** `created_at` is self-asserted; any key can sign an event dated 2009,
which is the whole reason `/who` ranks on an external anchor instead. An
implementer reaching for `created_at` here would let a user reorder their own
rebindings at will. Until this is closed, **no rebinding ordering may be
implemented**, and a second valid enrollment for one npub is `INSUFFICIENT` — not
a silently-picked winner. See `explorer/CAMPAIGN-EXPLORER-SPEC.md`; the two
candidate resolutions are a hash-linked rebinding chain (each rebind names the
event id it replaces, so ordering is structural and a gap announces itself) and
an authenticated external observation receipt (which introduces a trusted
sequencer and therefore a `SOVEREIGNTY.md` disclosure).

Slot assignment is unchanged and stays npub-only: `assignBatches` reads
`observed: string[]` and never touches an address.

## 5. `nostrconnect://` QR

`backends/nip46.ts` currently takes a pasted `bunker://` URI. On a phone that is
exactly the friction that loses people. Add the reverse flow: we generate a
`nostrconnect://` URI, render it as a QR, Amber or Damus scans and connects.

Keep the pasted-URI path for nsec.app and self-hosted bunkers.

---

## 6. The post

Built on `post/` — `card.ts` rasterises, `intent.ts` opens X, `nostr.ts` signs and
publishes. Template carries cohort, slot, npub, campaign root, and a verify link.

**Two separate actions, neither pretending to be the other.** Publishing to Nostr is
a signed event. Opening the X composer is an intent — the existing code already
refuses to claim X delivery, and that matters more when the post is about money.

The card is the product: 1200×630, showing the share and how to check it. A post
that says *"here's my share, and here's how to verify I'm not lying"* is a novel
thing on that timeline, and the verify link is what makes it one.

Incidental and valuable: a Bermer posting their npub from their X handle publishes
a timestamped handle↔key binding. Archive it and they move toward `anchored`. Do
not explain this to them; just make sure the npub is in the text.

---

## 7. Must not be built

```
any path that generates a key without forcing the backup
any "remember me" that stores an unencrypted nsec
publishing an ncryptsec to a relay
a connect button that hides the custody tier
localStorage as the ONLY copy of a key
a claim that the X post was delivered
key-security byte 0x01 on a browser-generated key
a modal that punishes the user for closing it
friction added to slow selling rather than to protect the user
```

That last one matters. The friction in this design is honest — it is the natural
consequence of the key being genuinely the user's. The moment a step exists to slow
people down rather than protect them, it is a soft lockup wearing self-custody's
clothes, and someone will notice.

---

## 8. Acceptance

- [ ] All 10 pocket vectors pass in TypeScript, including both odd-y cases
- [ ] Key `1` → `0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf`
- [ ] A generated `ncryptsec` round-trips, and imports into Amber on a real device
- [ ] Key-security byte is `0x00`, asserted by a test
- [ ] "Continue" is unreachable until the backup is downloaded — asserted in a browser test
- [ ] Custody tier is visible on every screen after connect — asserted in a browser test
- [ ] A subscription with no address is **rejected** — asserted, and asserted to
      reject rather than to derive. This item previously read "parses, and derives
      the pocket from the npub", which contradicted the fail-closed rule two
      sections above and would have had an implementer build the exact fallback
      this spec forbids. An acceptance criterion that disagrees with its own spec
      is worse than a missing one: it is a defect with a checkbox next to it
- [ ] Slot assignment is identical with and without addresses present
- [ ] The X intent path publishes nothing by itself — existing `post` tests cover the shape
- [ ] No unencrypted secret key reaches `localStorage`, `sessionStorage` or any network request — asserted, not reviewed

**Added at Revision 3, because the file is now tier 1:**

- [ ] A weak passphrase is **rejected** at the passphrase step — asserted, and the
      step cannot be skipped or defaulted
- [ ] The passphrase is never transmitted — asserted by inspecting every network
      request made during generation and during unlock
- [ ] Unlock succeeds **only** at the signer origin. A page at any other origin
      attempting to decrypt an `ncryptsec` throws — asserted, cross-origin, not
      same-page
- [ ] The decrypted key is discarded on tab close, on timeout and on explicit
      lock, and never reaches any storage API — asserted, not reviewed
- [ ] `bermlaunch.com` receives a **signature** and never key material — asserted
      in a browser test that inspects the `postMessage` payload
- [ ] The unlock renders as a **top-level popup**, never an iframe — asserted
- [ ] The anti-phishing sentence appears wherever the file appears, including in
      the text accompanying the downloaded file — asserted
- [ ] **No WebAuthn ceremony runs anywhere in the launch build.** No credential is
      created, so no RP ID is committed — asserted by a build-time check, so tier 2
      cannot ship accidentally before `rpIdFromOrigin` is fixed

---

## 9. Two objections, and how they were adjudicated

> **RESOLVED.** Both were ruled on by `GPT_BERM_HANDOFF_R2_REVIEW_20260807_R1`.
> Neither is an open instruction to an implementer. They are kept because the
> reasoning is why the current design looks the way it does.

Filed as disagreements rather than silently dropped, because a governing document
that absorbs objections without recording them stops being reviewable.

### The buyback must not be the only exit  →  **RULED: not V1 (D-10)**

**Do not implement `claimQuote()` in this lane.** The observation below was
accepted as valid; the mechanism was refused, and the refusal is better reasoned
than the proposal. An escape needs a deterministic, non-gameable activation
condition, and every obvious candidate introduces the authority this contract
exists not to have: an oracle to attest a paused pool, a route-failure window a
funded claimant can manufacture, a timeout that converts buyback economics into
optional withdrawal, or an admin switch.

What was conceded is the **disclosure**, and that IS binding: the promise must
state that *conversion still depends on the committed market route being
operational*, and that an unavailable route leaves the WETH entitlement preserved
in the Distributor. Tracked as a separate, explicitly undecided market-failure
resilience lane.

The original argument follows.

The ruling rejects "direct quote-asset payout replacing the buyback." Agreed as
stated — replacing it would delete working functionality and change the product.

But that is not what the finding was. **If the only way out is a swap, then a
paused, illiquid or migrated pool means a supporter cannot claim *anything*.** Not
delayed — unable. Setting `min_tokens_out` to 1 to force it through is not a
remedy; it is an invitation to be sandwiched for the whole pocket.

This collides with §3 of the ruling, which is otherwise the strongest part of it.
The website-independent acceptance test ends *"receive launched tokens at the
committed address"* — and that step assumes a working market. Shut down the
frontend, shut down the signer, hand the user their bundle and their key, and if
the pool is dead the test still fails. **Website-independent is not the same as
market-independent**, and only one of them is currently tested.

The narrow fix keeps everything: a `claimQuote()` that pays the supporter's own
WETH entitlement to their committed address, **available only when the buyback
route is unavailable** — pool paused, not migrated, or a stated period elapsed
with no working route. The buyback stays the default and the product. This is the
fire exit, and a building does not stop being a building because it has one.

Not implementing it is a decision that can be made. Making it without noticing is
not.

*(End of the original argument. The decision was made deliberately, with the open
questions named — which is the outcome this section was asking for.)*

### Solana case-folding is not stale architecture  →  **ACCEPTED as a dependency finding**

Not an implementation instruction. **No Solana work in this lane.** The finding is
a live defect in a third party's production API and belongs in a dependency
register, which is where it now lives (`bags/README.md`).

The ruling files it alongside superseded designs. It is not a design — it is a
**live defect in a third party's production API**, verified against the real
service with a real key:

```
provider=solana, username=7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
  → 200 success:true, wallet 7xkxtg2cw87d97txjsdpbd5jbkhetqa83tzrujosgasu
```

Base58 is case-sensitive. The returned string still decodes to 32 valid bytes, so
nothing errors — it is a different key nobody holds. Any Solana campaign that
names a raw address through that endpoint sends fees somewhere unrecoverable.

Robinhood-first is the right call and this changes none of it. But the finding
belongs in a **dependency register**, not in a bin marked *older design ideas*,
because the day someone opens a Solana campaign it is the difference between a
launch and a loss. Filed under `bags/README.md`, where it already is.

Similarly, the *assumption* that our controller could renounce `BagsFeeShare`
ownership is dead and should be discarded. The **finding** that produced that
conclusion — Bags retains `owner()` after `create()`, proven on a fork at block
28814524 — is live, governing, and the reason the assumption died. Discard the
assumption, keep the receipt.
