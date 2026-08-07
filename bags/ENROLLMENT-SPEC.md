# Enrollment — implementation specification

**For an implementer.** Design is settled; this is what to build, in what order, and
what must not be built. Where this disagrees with `POCKET.md`, this file wins —
the ladder order changed.

Companion artefacts:
- `vectors/pocket-address.json` — frozen, 10 vectors, both y-parity branches
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

### 1. Create a key and download it — the default

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

### 3. Bring your own — extension or bunker

For a user who wants to install something first. Amber and Damus via
`nostrconnect://` QR (see §5), Alby and nos2x via NIP-07.

**Every path shows the custody tier at all times.** A single connect button that
hides which of these the user landed in is the version of this product that does
not deserve to exist.

---

## 2. The pocket

```
xonly  = x-coordinate of d·G, 32 bytes
point  = 0x02 ‖ xonly                    (BIP-340: x-only means EVEN y)
addr   = keccak256(x ‖ y)[12:]           (uncompressed point, 0x04 stripped)
spend  = d if y(d·G) is even else (n − d)
```

**The negation is the whole trap.** A secret key whose point has odd y must be
negated to obtain the key that controls the derived address. Ignore it and you
produce a plausible address nobody can spend from — silent, permanent, and only
discovered when someone tries to move money.

`vectors/pocket-address.json` is frozen, covers both branches, and includes an
external anchor: secret key `1` derives to
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

## 4. The subscription

Existing format in `src/subscribe.ts`, kind 30078, `d = berm:subscribe:v1:<campaign>`.

**Change:** the `address` tag becomes optional. When absent, the pocket address is
derived from the npub. `buildSubscription` and `parseSubscription` currently reject
a missing address; both must accept it, and `Subscription.solanaAddress` becomes
optional.

Slot assignment is unchanged and stays npub-only — `assignBatches` reads
`observed: string[]` and never touches an address. **Say so in the interface:** the
slot is bound to the npub at signature time and nothing can take it.

Optional, and worth doing: a wallet signature over the npub when a user *does* name
an explicit address, proving they control it. Today that tag is unverified.

---

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
