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
