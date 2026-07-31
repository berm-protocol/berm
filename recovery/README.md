# xonly — recovery

Berm v2.1 §2. One page, two halves, and the order matters.

```bash
npm install
npm run build     # → dist/recovery.html, single file
npm run verify    # headless walkthrough, local relay, no network
npm run serve     # http://127.0.0.1:8106
```

## Why the readiness check comes first

A recovery page that only helps *after* a loss is half a page. By the time
someone opens it in anger, their options were already fixed by what they did or
did not set up months earlier — usually nothing.

So the top of the page answers one question:

> **If you lost this device right now, what would happen?**

and then lets you close each gap. The loss walkthroughs below it are the
fallback for people who arrive too late.

## The verdict is deliberately blunt

| State | Verdict |
|---|---|
| One device, no backup | *"If you lost this device today, your identity would be gone permanently."* |
| Two devices, no backup | *"You could recover from another device, but losing your ecosystem account would end it."* |
| One device, backup | *"You could recover from your backup file. Everything depends on that one file existing."* |
| Two devices, backup | *"Nothing here is a single point of failure."* |

A readiness check that softens the answer is worse than no check, because it
converts a warning into reassurance. There is no reset here, no support queue,
and nobody who can help — the page says so in those words.

## The four checks

| Check | Critical when | Fix |
|---|---|---|
| Devices | fewer than 2 and no backup | enrol a second credential (v2.1 §1 key wrapping) |
| Offline backup | absent | encrypted keyfile, passphrase ≥ 12 chars, stored off-device |
| Guardians | never critical, always warned | one signed kind 30078, `d = berm:recovery:v1` |
| X claim | never critical | link the handle, archive the proof |

Note the asymmetry. Losing an X account is a **warning**, not a critical: you
lose a badge, not a login, not a key, not one byte of content. Losing the key
with no backup is the only genuinely unrecoverable event in the system — and
that is the whole argument for the architecture, stated where a user will
actually read it.

## Guardians are a pre-commitment, not a recovery mechanism

Guardian rotation is **social consensus**, not key recovery. Nobody holds a
share of your key; guardians attest that a *new* key is you, and it works only
because relying parties choose to honour that attestation.

It is therefore only valid if it was anchored **before** the loss — which is
exactly why it cannot be added at the moment you would want it, and why the page
nags about it while everything is still fine.

## The approval prompt names the consequence

Publishing guardians asks:

> *Publish your recovery guardians — 3 named publicly, 2 needed to vouch for a new key*

not "save application data (berm:recovery:v1)". This event puts a list of your
contacts on public relays permanently. A signer that says "sign this?" without
saying what "this" is has trained the user to click yes.

## What is simulated

This is a clickable prototype on the dev signer, not the shipped Tier-1 signer.

- **Add device** increments the registry rather than enrolling a real passkey.
  The wrapping mechanics it stands in for are real and tested — see
  `crypto/src/wrap.ts` and its vectors.
- **Download backup** writes the envelope *shape* (`kdf: argon2id`) so the file
  is inspectable; it does not yet encrypt.
- **Guardians** is fully real: signed, verified, published to relays, and
  `verify.mjs` re-checks the signatures on the way back out.

## Verification

`verify.mjs` runs headless against a local NIP-01 relay with no network access.
It asserts the verdict transitions across all four states, that the short
passphrase is rejected, that both relays store a signature-valid event, that
every loss path renders, and that the console stays clean throughout.
