# The pocket — sign once, yours forever

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
| Mobile | Bunker — Amber, Damus, nsec.app | scan a QR, approve | tier 2 — **key never leaves the device** |
| Nothing yet | Passkey at the signer origin | tap Face ID | tier 1 — depends on one DNS name |

Order them by what the user already has, not by what we prefer. Someone arriving
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
