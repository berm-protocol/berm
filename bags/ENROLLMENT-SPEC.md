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

## 1. The ladder, in this order

The old order ranked paths by what the user already had. **The order is now by how
little the user ends up depending on us.** That is the project's whole argument, so
the enrollment screen should be the first place it is visible.

### 0. If a signer is already present — offer it first

`window.nostr` detected, or a bunker session already established: **use it, and say
so.** A user with an extension already made a custody decision, and overriding it to
push our own signer is precisely the behaviour this project claims to be an
alternative to. The SDK's `connect()` already prefers NIP-07 when present; do not
fight it.

This is not an option in the list. It is a short-circuit above the list.

### 1. Create a key and download it — the default, PATH A ONLY

Generate a fresh secp256k1 key in the browser. **Immediately** offer the NIP-49
`ncryptsec` download, passphrase chosen by the user.

Why first: the user walks away with a portable, standard-format key that works in
Amber, Damus, Alby, nsec.app or anything that comes later. **They depend on us for
nothing from the first second.** They can decide what signer they want a week from
now, having lost nothing.

Copy must state, without softening:

> Your key is created here, in this browser tab. That is fast, and it is the
> weakest place a key can be made — so download it now, encrypted with a
> passphrase only you know. Then it works in any Nostr app, forever, with or
> without us.

**The download is not optional.** Do not allow "continue" until the file has been
generated and the passphrase confirmed. This is the only step in the whole product
where blocking is justified: a user who leaves without it has an identity and a
pocket that exist only in a browser tab.

### 2. Passkey at our signer origin — convenience, with the exit signposted

Face ID / Touch ID, no download, no app. Offer it **second**, and label it plainly:

> Fastest, and it depends on us. Your key is derived at `signer.xonly.ai`, so it
> stays exclusively yours for as long as that one domain stays in honest hands.
> **That is a real dependency and you should not accept it permanently.**
> Export your key whenever you like — the button is always there.

`ncryptsec` export must be reachable from the account screen at all times, not
buried. That export *is* the exit from tier 1, and offering it before anyone has a
reason to distrust us is the strongest form of the claim we make.

### 3. Bring your own — extension or bunker  →  PATH B

A user arriving with an existing npub takes **Path B**, and Path B does not use a
derived pocket. Require an explicit EVM wallet, and bind it from both sides:

```
npub signs        "<evm address> is my destination for campaign <id>"
evm wallet signs  "<npub> may direct payments to me for campaign <id>"
```

Both signatures, or the binding is not accepted. One side alone proves half of a
two-sided claim.

The binding is replaceable — by a **new, valid, dual-signed binding** — up until
the cohort root is finalised. **After finalisation the destination committed in
the root is frozen**, because it is inside the leaf. Do not carry forward any
wording suggesting the payout wallet stays freely replaceable; that was true of an
earlier design and is not true of this one.

Why not derive for these users: they would have to export an established identity
key, work out BIP-340 parity, and import it into MetaMask — coupling an identity
they already use elsewhere to a wallet, to use one launchpad. They already have an
EVM wallet. Ask for it.

Amber and Damus connect via `nostrconnect://` QR (see §5); Alby and nos2x via
NIP-07.

**Every path shows the custody tier at all times — and for tier 2, WHICH signer.**
"Bunker" is not a custody property. Amber on a phone in a pocket, `nsec.app` as a
web service, and a self-hosted daemon on a VPS are all NIP-46 and their properties
are not the same. Show what is known about the actual signer rather than a tier
number that flatters the weakest member of the category. A single connect button that
hides which of these the user landed in is the version of this product that does
not deserve to exist.

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

## 3. The ncryptsec download

NIP-49. Non-negotiable parameters:

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

Next to the passphrase field, not in a help page:

> This passphrase is the only thing protecting the file. scrypt buys time against
> guessing; it cannot rescue a weak passphrase. **This file is also your pocket** —
> the same key opens your money.

And: **never publish an `ncryptsec` to a relay.** One passphrase from being someone
else's key, permanently, with no recall.

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
non-canonical address · `bound_wallet_v1` naming the derived address · a proof
made for another mode or another campaign · **duplicate tags**, because two
`mode` tags means two readers can reach two conclusions about one signed object.

There is **no rule anywhere** saying a missing address means derive from the npub.

### Rebinding

A later valid enrollment supersedes an earlier one **only before the cohort root
containing the destination is finalised**. After finalisation the destination is
inside the leaf and inside the root, so it is frozen.

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
- [ ] A subscription with no address parses, and derives the pocket from the npub
- [ ] Slot assignment is identical with and without addresses present
- [ ] The X intent path publishes nothing by itself — existing `post` tests cover the shape
- [ ] No unencrypted secret key reaches `localStorage`, `sessionStorage` or any network request — asserted, not reviewed

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
