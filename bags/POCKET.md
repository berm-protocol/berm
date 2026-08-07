# The pocket — sign once, yours forever

> ## ⚠ SUPERSEDED IN PART — read `ENROLLMENT-SPEC.md` first
>
> Adjudicated by `GPT_BERM_HANDOFF_R2_REVIEW_20260807_R1`, decisions D-01…D-10.
>
> **What still stands:** the derivation, the vectors, the NIP-49 backup, and the
> reasoning about custody cost.
>
> **What changed:** this file describes the pocket as if every user gets one.
> They do not. It is **Path A only** — users arriving with no Nostr identity.
> A user with an existing npub (NIP-07, NIP-46, any signer) supplies an
> **ordinary EVM wallet**, dual-signed against their npub. Never derived
> silently. (D-02, D-03, D-04)
>
> **And "pocket" means something narrower than this file implies.** In
> BermLaunch the pocket is the **cumulative virtual WETH entitlement inside the
> immutable Distributor**. The EVM address is the *authority* that spends it and
> the *destination* the launched token is delivered to — it is not somewhere the
> WETH gets pushed to first. The lifecycle is preserved intact (D-09):
>
> ```
> Bags fees → Distributor → cumulative WETH pocket → verified graduation
>           → supporter-authorized full-pocket fixed-route buyback
>           → launched token to the committed EVM destination
> ```
>
> **And the parity handling here is out of date.** This file kept the raw key and
> a separate spending key. The secret is now normalised **at generation**, so the
> exported secret directly controls the displayed address. `vectors/` is v2.

> **You sign. Your pocket is yours. Forever. Your share of the pool never moves,
> and only your key can open it.**

That is the promise. This file is how it is kept, and what it costs.

## The construction

A Nostr key is a secp256k1 keypair. So is an Ethereum key. **They are the same
kind of key**, and a single one can be both.

```
npub  (x-only 32 bytes, BIP-340 even-y)
  │
  │  pub = 0x02 ‖ x   →  uncompressed  →  keccak256(x ‖ y)[12:]
  ▼
0xeb88…  — a canonical EVM address, derived from the npub and nothing else
```

Verified over 300 random keys: the address derives deterministically, and the same
Nostr key produces an ECDSA signature that recovers to it. One subtlety, and it is
the only one — BIP-340 negates a key whose point has odd y, so the spending key is
`d` when `y(dG)` is even and `n − d` when it is odd. Mechanical, testable, and it
must be in the vectors.

## What that buys

**Enrollment asks for nothing but a signature.** No address field. No wallet. No
"connect". The destination in your leaf is *computed from your npub*, so there is
nothing to type and nothing to get wrong.

**The pocket is push, not pull.** The money is sent to an address only your key
controls, by anyone willing to pay the gas. You do not have to be present,
online, or even aware. There is no claim window, no deadline, and no way to be
excluded by forgetting — the failure mode that made the earlier design bad.

**No new cryptography in the contract.** The leaf commits an ordinary address, so
`claim()` stays exactly as specified: verify proof, pay the committed destination.
No BIP-340 verifier, no `ecrecover` gymnastics, nothing clever in immutable code.

**And your share is fixed at the moment you sign.** Your range is written into the
root. It does not shrink because someone else was slow, and it does not require
you to do anything to keep it.

## What it costs, stated plainly

**To spend, your key has to reach a wallet.** The money is already yours and
already at your address; moving it means getting that key into something that
signs Ethereum transactions. For a nsec you hold, that is an import. For a key
inside Amber or nsec.app, it is a deliberate export.

That is the step your incentive pays for: it happens when there is money worth
collecting, not at the moment of enrollment when the user has no reason to care.

**Importing an identity key into a wallet extension is a custody downgrade**, and
the interface must say so rather than letting it pass. The identity key that
signs your subscriptions, your handle claims and everything else would then sit
in a wallet with a large surface. Two honest mitigations, both cheap to say:

1. sweep the pocket to a normal wallet and stop using the imported key, or
2. import into a browser profile you use for nothing else.

Neither is perfect. Both are better than silence.

**One key, two roles.** Losing it loses the identity and the money together. That
is exactly what `recovery/` and guardians exist for, and this design raises their
priority from "eventually" to "before the first pocket has real value in it".

## The enrollment ladder

Three ways in. All produce the same kind of npub and the same kind of pocket. The
only difference is where the key lives — which is the one thing the interface must
never hide.

| | Path | What the user does | Custody |
|---|---|---|---|
| Already equipped | NIP-07 extension — Alby, nos2x | one click | tier 0 — depends on the extension vendor |
| Mobile | Bunker — Amber, Damus, nsec.app | scan a QR, approve | tier 2 — **depends on what that signer actually is**; Amber is a phone, nsec.app is a web service |
| Nothing yet | Passkey at the signer origin | tap Face ID | tier 1 — depends on one DNS name |

**Order superseded — see `ENROLLMENT-SPEC.md` §1.** Paths are now ranked by how
little the user ends up depending on us, with create-and-download as the default.
The principle below still holds and is why option 0 exists at all: Someone arriving
with Alby installed has already made a custody decision, and overriding it to push
our own signer would be the exact behaviour this project claims to be an
alternative to.

## What the screen says after they sign

This is the part that matters, and it is where most projects say nothing.

```
  You are Founder #12 of 50.

  Your key       npub1abc…             ← this is you, everywhere, forever
  Your pocket    0xeb88…               ← derived from your key. Only you open it.
  Your share     1/50 of the Founders pool, which is 20% of all trading fees

  Right now your key lives in:  the Alby extension
  That means: your key stays exclusively yours as long as your extension
  vendor stays honest. That is a real dependency, and here is how to remove it.

                        [ Make it permanent → ]
```

Three things are true on that screen and all three are said out loud: what they
now hold, where it lives, and what that costs. A launch page that shows a
percentage and a confetti animation is not doing this.

**"Make it permanent"** is the guard step: back up the key, or move to a bunker.
Offered, never forced, and never with a modal that punishes closing it.

## The backup is a standard, not a file we invented

Amber does not need a proprietary file. What it needs is the key, and there is a
standard portable form for it: **NIP-49 `ncryptsec`** — the secret key encrypted
under a passphrase with scrypt and XChaCha20-Poly1305, bech32-encoded as
`ncryptsec1…`.

That matters here because it is the *exit*, and we can hand it over at the moment
they enroll:

```
  Download your key                              berm-founder-12.ncryptsec

  Encrypted with a passphrase only you know. Import it into Amber, Damus,
  Alby, nsec.app — or any Nostr signer that exists later.

  This file is also your pocket. The same key opens 0xeb88…
```

They do not need Amber installed. They do not need to have decided anything. They
leave with a file that works with whatever they choose, whenever they choose it —
including nothing, forever.

Four things this design has to get right, and say:

**The key-security byte must be honest.** NIP-49 carries a byte recording whether
the key was ever handled insecurely: `0x00` insecure, `0x01` secure, `0x02`
unknown. A key generated in a browser tab **was** handled insecurely, so it is
`0x00`, and clients that warn the user about it are doing the right thing. Writing
`0x01` because it looks better would be lying in a field that exists specifically
to prevent that.

**`log_n` is a real trade-off in a browser.** The parameter runs 16 to 22 — 64 MiB
to 4 GiB of scrypt memory. A phone browser cannot do the high end. 16 is the
practical floor and what a mobile tab will survive; anything more must be measured
on real devices, not chosen because a bigger number reads as safer.

**The passphrase is the entire security.** scrypt buys time against guessing; it
does not rescue a weak passphrase. Say that on the screen, next to the field, not
in a help page.

**And never publish it.** NIP-49 says so explicitly, and it is worth repeating
where a user could be tempted: an `ncryptsec` posted to a relay is a passphrase
away from being someone else's key, forever, with no way to recall it.

**This is also the escape hatch from tier 1.** A passkey-derived key is bound to
the signer origin, which is the honest weakness of that tier. Exporting an
`ncryptsec` is how a user *leaves* — takes the key somewhere we do not control and
stops depending on one DNS name staying in honest hands. Offering the exit at
enrollment, before anyone has a reason to distrust us, is the strongest version of
the claim this project makes.

One consequence to state plainly: because the pocket address derives from the same
key, **that file is their money as well as their identity.** A passphrase good
enough for a social identity may not be one they would choose for a wallet.

## Why they should care beyond the token

The pocket is the hook. It should not be the only thing on the page.

The same npub they just created is not a launch artefact. It is an identity that
already works elsewhere in this project — the editor, the handle claim and its
archived proof, the graph, the node. Someone who signs for a fee share and leaves
with a working Nostr identity has got the better half of the deal, and telling
them so is both true and the most persuasive thing available.

So the page carries a second door: **what this key is for, besides money.** Short,
concrete, linked to things that exist and can be used today — not a roadmap.

The subtext being: you did not just join a memecoin. You took custody of an
identity that outlives X, outlives this token, and outlives us.

## Open items before this ships

1. **Vectors.** npub → address, including odd-y normalisation, cross-checked
   between the TypeScript and the Solidity, committed and frozen.
2. **Address display.** An EVM address derived from an npub looks like any other
   address. The interface must show *why* it is theirs, or it reads as an address
   we chose for them.
3. **Solana.** This construction is secp256k1 and therefore EVM-only. Solana keys
   are ed25519, so a Solana pocket cannot be derived from an npub the same way and
   needs its own answer. Do not let the EVM elegance imply a Solana capability
   that does not exist.
4. **Recovery, sooner.** One key now guards identity *and* funds.
