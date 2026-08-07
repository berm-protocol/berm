---
d: docs/custody
title: Custody tiers
summary: Where the key lives. Four answers, one interface, and the honest reason tier 1 is an on-ramp rather than a destination.
t: [berm, custody, security]
nav: 3
x_article: adapted
---

# Custody tiers

The tier number says **where the key lives**. On most axes it is not a quality
ranking — a tier 2 user is not a better user than a tier 0 one.

On exactly one axis it *is* a ranking, and that axis is the whole point of this
project, so it gets [its own section](#what-tier-1-costs) rather than a footnote:
**whether your key stays exclusively yours depends on nobody, or depends on
somebody.** Every tier depends on somebody. They differ in *who*, and in whether
the user gets to choose them.

| Tier | Key lives in | Exclusivity depends on | Status |
|---|---|---|---|
| 0 | A NIP-07 browser extension | your extension vendor's next update | works today |
| 1 | A passkey, at the Berm signer origin | **one DNS name staying in honest hands, indefinitely** | client complete, signer origin not yet deployed |
| 2 | A NIP-46 remote signer ("bunker") | **whatever that signer actually is** — see below | works today |
| — | Development key in `localStorage` | nothing — it has no security | localhost only |

**Correction, and it was ours.** This table used to say tier 2 depended on
"hardware you physically hold", and that tiers 0 and 2 depended on nobody. Both
were wrong. A NIP-46 signer is *remote*; what it runs on is a separate question
the protocol does not answer. Amber on a phone in your pocket is hardware you
hold. `nsec.app` is a web service. A self-hosted `nsecbunker` is a daemon on a
VPS, which is a machine and a domain and a hosting provider.

They are all tier 2 and their custody properties are not the same. So the
interface must show **which signer**, and what is known about it — not a tier
number that flatters the weakest member of the category. A label that overstates
safety is worse than no label, because the user stops asking.

Show the tier to the user. A single connect button that hides which of these
they landed in is the version of this project that does not deserve to exist.

## Tier 0 — browser extension

The user installed Alby or nos2x before they ever heard of us. We create no key,
store nothing, and leave nothing behind on disconnect.

`connect()` picks this **first when it is present**, and that ordering is
deliberate: a user with an extension already made a custody decision. Overriding
it to push our own signer would be exactly the behaviour we claim to be an
alternative to.

The SDK also adopts the user's own NIP-65 write relays over our defaults.
Publishing to relays a user does not read is a very quiet way to lose their data.

## Tier 1 — the Berm passkey signer

The one that works for people who have never heard of Nostr. The user taps Face
ID; a key is derived and lives at one origin.

```
prf_salt   := "xnsb/v2/prf/identity"
prf_out    := WebAuthn PRF eval.first        (32 bytes, secret, hardware-bound)
hkdf_salt  := "xnsb/v2/identity"
info(i)    := "secp256k1|" || credential_id || "|" || uint8(i)
sk_i       := HKDF-SHA256(prf_out, hkdf_salt, info(i), 32)
accept iff 0 < int(sk_i) < n
```

The only secret input is `prf_out`. It is computed inside the authenticator and
is not derivable from anything public — that one sentence is the entire
difference between this and the broken first design, which derived keys from a
public X user ID and was therefore reproducible by any observer.

**Why a separate origin.** WebAuthn credentials are bound to an RP ID derived
from the origin. If every app could invoke the passkey, every app would be a
phishing surface. So the key exists at exactly one origin, apps reach it through
a popup, and the SDK checks `event.origin` on every single message — the one
check whose absence turns this from a security boundary into decoration.

### What tier 1 costs

The same RP-ID binding that makes a single origin *necessary* is what makes
tier 1 **not sovereign**. It is worth stating plainly, because the rest of this
documentation would otherwise imply the opposite.

A passkey produces `prf_out` only for pages served under the RP ID it was
registered against. That is a guarantee about a **DNS name**, not about us.
Whoever serves that name gets `prf_out` on the user's next Face ID tap — and the
authenticator will cooperate, because from its side nothing has changed.

Domains change hands. They lapse, they get sold, they get seized, they get
handed over under a court order in a jurisdiction the user has never visited.
None of those is a break-in; the design simply does not distinguish "us" from
"whoever holds the name". So:

> **Tier 1 users are trusting a domain registration, indefinitely, for as long
> as they keep using tier 1.** Tier 0 and tier 2 users are not.

That is a real dependency, it is the flagship onboarding path, and no amount of
CSP, SRI or reproducible builds removes it — every one of those defends the
*bytes*, and this is an attack on the *name*.

### What it still buys, precisely

Not nothing, and the distinctions matter:

- **No key at rest, anywhere.** The key is derived per session inside the page
  from a secret only the authenticator can produce. There is no server-side
  database to steal, subpoena or leak.
- **Your published data stays yours regardless.** Events you already signed are
  on relays, signed by you. A compromise of the signer lets an attacker sign
  *new* events going forward. It does not hand them the past, it does not delete
  your record, and it does not revoke your claim to it.
- **Nodes running the [signer gate](docs/node) block a name-holder who cannot
  produce a valid attestation** under the pubkey they pinned. This is a genuine
  partial defence, with an equally genuine boundary: it protects users who arrive
  through a gated node, not users who navigate to the signer origin directly.

**Exporting your key protects access, not exclusivity.** Enrollment requires the
user to take their `nsec` away — encrypted keyfile or written backup. That is
what lets them walk to tier 0 or tier 2 whenever they like, and it is why tier 1
is an on-ramp rather than a trap. It does *not* stop a future name-holder from
signing as them. Being un-lockable-out and being the only signer are two
different properties, and only the first one is solved today.

The fix is a root the user holds that the passkey merely *wraps* — NIP-06
mnemonic derivation, with `prf_out` as a convenience layer over it rather than
the sole entropy source. That is designed and specified; it is **not built**. Until
it is, this section is the honest version and the tier table above ranks
correctly.

**Multi-device.** The first credential derives deterministically and stores
nothing. Every additional credential *wraps the same key*:

```
credential #1   sk = HKDF(prf_out₁, …)                 ← stores nothing
credential #2   wrapped₂ = AES-256-GCM(sk, kek₂)       kek₂ = HKDF(prf_out₂, wrap-salt)
```

Wrapped blobs are ciphertext and useless without an authenticator, so copy them
anywhere — the signer origin, your node, a download, a relay. The deterministic
path is robust to **data** loss; the wrapped path is robust to **device** loss.
You need both.

The registry deliberately **refuses** an unknown credential rather than deriving
a fresh identity. Silently forking a user into two npubs, neither aware of the
other, is the worst failure available here.

## Tier 2 — NIP-46 bunker

The key lives on hardware the user controls and never enters the browser. Every
operation is a relay round-trip to a device that may be asleep.

This tier is why the whole SDK is async, approvable and failable. An app written
against a fast local key needs rewriting the day a real signer arrives; written
against this shape, it does not.

## The dev signer — not a tier

A raw key in `localStorage`, which is precisely the thing this project exists to
stop doing. It exists because building against an instant, always-approving key
produces an app that breaks on contact with reality, so it deliberately
reproduces the annoying parts: latency, an approval prompt, real failures.

**It throws off localhost.** Not a console warning — `DevSignerMisuseError`,
before it returns an object. Every dev mode that merely warns eventually ships,
and this one leaks a private key when it does.

## Two rules for your app

**Show what could sign, and why the rest cannot.**

```js
Berm.detect({ signer: { signerOrigin: 'https://signer.xonly.ai' } });
// [
//   { tier: 0, available: false, label: 'Browser extension', reason: 'no NIP-07 extension found' },
//   { tier: 1, available: true,  label: 'Passkey' },
//   { tier: 2, available: false, label: 'Remote signer', reason: 'no bunker URI supplied' },
// ]
```

One connect button that fails for reasons the user cannot see is how you lose
someone at the first click.

**Never fall back between tiers after connecting.** If a user's signer breaks,
offer a retry. Do not quietly re-sign them into weaker custody they did not
choose. Their tier is a decision they made about their own risk, not an
implementation detail for you to optimise away.

**Treat tier 1 as an on-ramp, and say so.** A tier-1 user who has taken their key
away can leave for tier 0 or 2 at any point; one who has not is depending on a
domain registration they never agreed to depend on. Prompting them to export, and
telling them what the export is for, is the difference between onboarding
somebody and enrolling them.

## Next

- [SDK reference](docs/sdk) — the full `detect`, `setup` and `connect` surface
- [Recovery](docs/recovery) — what a user must hold, whichever tier they pick
- [Security model](docs/security) — why the first design was replaced entirely
