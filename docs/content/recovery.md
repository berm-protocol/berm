---
d: docs/recovery
title: Recovery
summary: What you must hold, what each loss actually costs, and the one loss that cannot be undone.
t: [berm, recovery]
nav: 6
x_article: adapted
---

# Recovery

Read this before you need it. A recovery page that only helps *after* a loss is
half a page — by the time you open it in anger, your options were already fixed
by what you did or did not set up months earlier.

## Berm Recovery Module 0.1

**Berm Recovery Module (BRM)** is an encrypted, user-owned portable recovery file.
The `.brm` plus its recovery password restores the same Berm/Nostr identity and
the same BRM-derived default EVM destination on another device. It contains
NIP-49 encrypted secret material and public identity/address metadata. One
secp256k1 root produces both; the EVM address is not an unrelated second key.
Keep the file private and its password separately. There is no server reset
that recreates a lost root or password.

Recovery decrypts the file, rederives npub, public key and EVM address, and checks
each against the public metadata. Bad password or mismatched metadata fails
closed. JSON shape validation alone does not prove cryptographic root equality.

Created/exported and `BRM_RECOVERY_CONFIRMED` are different. Confirmation checks
that the supplied BRM decrypts and matches the current vault's identity and EVM
destination. The existing flow accepts supplied file text or in-memory BRM text.
It does **not** prove that a file was saved or reopened, and this documentation
adds no upload or mandatory file-reselection step. Confirmation remains local
session state, never another `.brm` field. Existing generated-destination and
session checks remain unchanged.

An existing unlocked NIP-49 identity can be wrapped/re-encrypted into BRM without
changing its root or npub: preservation, not identity rotation. An independently
chosen BYO EVM destination remains available; the BRM does not hold its key or
prove ownership of that external wallet.

The private BRM is separate from public identity evidence. BRM does not prove X
identity and does not contain X proof archives, campaign positions, financial
claims, balances or application receipts. Recover application state separately
from its authenticated records. The current X method remains
`berm.external_account_binding.x/2`.

Launch Edition 0.1 is not a generic wallet or signer. It includes no Solana/Zcash
keys, passkeys, cloud sync, external-wallet seeds or OAuth credentials. The
existing local Advanced EVM export exposes the same root controlling the Berm
identity: explicit warning/confirmation is required, and the key must never be
logged, sent to a server or placed in receipts.

Read the [exact BRM profile](https://github.com/berm-protocol/berm/blob/main/recovery/brm-0.1/PROFILE.md),
[closed schema](https://github.com/berm-protocol/berm/blob/main/recovery/brm-0.1/schema.json)
and [synthetic shape vectors](https://github.com/berm-protocol/berm/blob/main/recovery/brm-0.1/shape-vectors.json).
The schema checks the parser's exact shape, including its custom Date.parse
format; prefix-only npub checking is not complete identity validation. See
[Developer current](docs/developer-current) for offline commands.

The remaining guidance below describes broader ecosystem custody and recovery.
It does not add passkeys, guardians or synced credentials to the BRM file.

## The only question that matters

> **If you lost this device right now, what would happen?**

| Your setup | The honest answer |
|---|---|
| One device, no backup | Your identity would be gone permanently. |
| Two devices, no backup | You could recover from the other device, but losing your ecosystem account would end it. |
| One device, backup | You could recover from the backup file. Everything depends on that one file existing. |
| Two devices, backup | Nothing here is a single point of failure. |

There is no reset, no support queue, and nobody who can help. A readiness check
that softens that answer is worse than no check, because it converts a warning
into reassurance.

## What to hold

**1. A second enrolled device.** Ideally on a different ecosystem. Platform
passkeys sync within an ecosystem, so a broken phone is survivable — but an
iPhone plus a Windows PC is the case most people actually live in, and sync does
not cover it.

**2. An encrypted keyfile, stored off-device.** Passphrase of at least 12
characters. This is the only thing that survives losing every device *and* the
ecosystem account behind them.

**3. Guardians, named in advance.** Two or three people you trust, published as
one signed event. They cannot restore your key; they can attest that a new one
is you.

**4. An archived proof post.** So that if your X account dies, you can still
demonstrate it was yours — see [Identity and X](docs/identity).

## What each loss costs

**Your X account is gone.** Recoverable, and barely an inconvenience. Sign in
with your key, post a fresh proof from the new account, archive it, and publish
an updated profile with the dead claim removed. You lose a badge.

**One device lost.** Recoverable. Sign in on another device — platform passkeys
sync within an ecosystem. If it was a separate ecosystem, use the other enrolled
device. If your passkey did not sync, restore from the backup. Then enrol a
replacement so you are back to two.

**Every device gone.** Recoverable *if* you have the backup keyfile and its
passphrase. Import it, restore, enrol a new device immediately, download a fresh
backup. Without the file: check everywhere it might be, then fall through to
guardians.

**Key gone, no backup, no guardians.** Not recoverable. This is the honest
answer rather than a hopeful one. Your published work still exists on relays
under the old key — readable forever — but you can no longer sign as its author.
Create a new identity and link your handle to it afresh.

## Guardians: what they can and cannot do

They can sign a **rotation attestation** saying a new key belongs to the same
person. Resolvers that honour guardian rotations will follow you.

They cannot decrypt anything, cannot sign on your behalf, and hold no fragment
of your key. This is social consensus, not key recovery, and it works only
because relying parties choose to honour it.

The pre-commitment must be **anchored before the loss**. That is not a design
wart, it is the entire security property — a rotation that could be arranged
after the fact would be a way for an attacker to take your identity by
convincing two of your contacts.

```
kind 30078, d = berm:recovery:v1
  ["guardian",  "npub1…"]
  ["guardian",  "npub1…"]
  ["guardian",  "npub1…"]
  ["threshold", "2"]
```

The approval prompt for this event says what it does:

> *Publish your recovery guardians — 3 named publicly, 2 needed to vouch for a new key*

Note what that reveals: this event is public and permanent, and it names your
contacts. That is the trade, and you should make it knowingly.

## Removing a device is not revocation

Removing a credential drops it from the registry. It does **not** invalidate the
identity key, so a kept copy of the removed blob plus the removed authenticator
still unwraps it.

Genuine revocation means rotating to a new key. We say this plainly rather than
implying a device has been locked out, because a user who believes a stolen
laptop has been cut off when it has not is worse off than one who knows the truth.

## The asymmetry worth internalising

Everything in this system comes back from relays: your articles, your follows,
your pages, your comments. Lose a node, lose a relay, lose your X account — it
all comes back.

The key does not. It is the one irreplaceable thing, and it is the only thing
you are actually being asked to look after.
