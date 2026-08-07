---
d: spec/signer-broker
title: The signer broker
summary: How a third-party app gets a signature from a Berm user without ever touching their key — and what an API key does and does not buy.
t: [berm, signer, custody, protocol]
nav: 6
x_article: skip
---

# The signer broker

Tier 1 exists so someone with no extension and no bunker can still hold a real
key. This document is how **other people's applications** use that, without any of
them being able to take it.

The rule the whole design serves:

> **Only the signer origin ever sees a key. Clients receive signatures.**

Everything below is a consequence of refusing to weaken that.

## Why not the obvious thing

The tempting design is to let every client share the RP ID — give each one a
`*.xonly.ai` subdomain, let each call WebAuthn itself, done. It is one line of
configuration and it is unshippable.

Clients sharing an RP ID share the **credential**. Client B's JavaScript would
receive the same `prf_out` as client A's, derive the same identity key, and sign
as any of A's users. One compromised client would burn every user of every client.
There is no disclosure that makes that acceptable, because the failure is not
partial.

So clients do not call WebAuthn. The signer does.

## Shape

```
   client origin                              signer.xonly.ai
   (bermlaunch.com, anything)                 (top-level popup)
        │
        │  window.open() on a user gesture
        │─────────────────────────────────────────────▶
        │                                        user sees the REAL url bar
        │  postMessage: request                  ┌──────────────────────────┐
        │─────────────────────────────────────▶  │ bermlaunch.com asks you  │
        │                                        │ to sign:                 │
        │                                        │   "Subscribe to genesis  │
        │                                        │    as Founder"           │
        │                                        │   [ Approve ] [ Decline ]│
        │                                        └──────────────────────────┘
        │  postMessage: signed event                    Face ID → derive → sign
        │◀─────────────────────────────────────
        │
   never sees prf_out, never sees the secret key
```

**A popup, not an iframe.** An iframe is inside the client's page, so the client
controls its position, size and what sits on top of it — the approval UI could be
covered, resized to a sliver, or framed by convincing surrounding chrome. A
top-level popup shows the browser's own URL bar reading `signer.xonly.ai`, and
that address is the entire anti-phishing story. Giving it up for a smoother
transition would be trading the only thing the user can check.

Popups need a user gesture. That is a real constraint on client authors and it is
written into the API rather than worked around.

## The protocol is NIP-46's, over a different wire

Method names, parameters and semantics are NIP-46's. Not for elegance — so that a
developer writes **one integration** that works against Amber, nsec.app, a
self-hosted bunker, or us. We are a transport, not a new vocabulary.

| Method | Returns |
|---|---|
| `get_public_key` | the user's hex pubkey |
| `sign_event` | the signed event |
| `nip44_encrypt` / `nip44_decrypt` | ciphertext / plaintext |
| `get_relays` | the user's NIP-65 relays, if they published any |

`connect` and `ping` exist for parity. **`nip04_encrypt` and `nip04_decrypt` are
not implemented and will not be** — NIP-04 is prohibited repo-wide, and a signer
that offers a broken primitive because clients ask for it is how broken primitives
survive.

### Request

```json
{
  "berm": "signer/1",
  "id": "01J8…",
  "method": "sign_event",
  "params": { "event": { "kind": 30078, "created_at": 0, "tags": [], "content": "" } },
  "human": "Subscribe to berm-genesis as a Founder"
}
```

`human` is **required** and is what the user reads. If it is missing, absent, or
disagrees with what the request actually does, the signer shows the raw event
instead and says the application did not explain itself. A prompt nobody can
understand is not consent.

### Response

```json
{ "berm": "signer/1", "id": "01J8…", "result": { "…signed event…" } }
{ "berm": "signer/1", "id": "01J8…", "error": { "code": "declined" } }
```

Errors are typed: `declined`, `no_session`, `unsupported_method`,
`rejected_origin`, `timeout`. A client must be able to distinguish *the user said
no* from *something broke*, because those deserve different interfaces and
conflating them is how "try again" loops get built on top of a refusal.

`postMessage` is always sent with an explicit `targetOrigin`. Never `*`.

## What an API key actually buys

**Presentation, not permission.**

A registered client gets a display name and an icon, so the approval reads
*"bermlaunch wants you to sign"* rather than *"an unregistered site at
https://… wants you to sign"*. That is the whole difference.

**An unregistered origin is not blocked.** It is *named*, loudly, with a warning
that we have never seen it before. Blocking unknown origins would make us the
gatekeeper of who may ask a user for a signature, and we would then be a
permission system pretending to be infrastructure. The user is the authority. We
are furniture that tells the truth.

So the honest sentence for a developer page:

> An API key does not unlock anything. It lets your users see your name instead
> of your URL. Your application can do exactly as much without one — it will just
> look like a stranger, because to them it is one.

That also means a leaked key is a **branding** incident, not a security one, which
is the correct blast radius for a credential a developer will inevitably paste
into a repository.

## Sessions and grants

Per-request approval is safest and unusable at any volume. So a user may grant a
client a **session**, and every dimension of it is bounded and visible:

```
  bermlaunch.com
  may request        sign_event, kind 30078 only
  until              1 hour from now
  approvals so far   3
                                             [ Revoke ]
```

Rules:

- **A grant is always scoped to methods and event kinds.** "Sign anything" is not
  an option the interface offers. A client that needs a kind outside its grant
  asks again, in front of the user.
- **Grants expire.** No permanent grant exists, and there is no checkbox that
  creates one.
- **Every active grant is listed at the signer origin**, revocable individually,
  with a count of what it has been used for. A user who cannot see what they have
  agreed to has not agreed to it.
- Grants are per-origin and never transfer. A redirect does not carry one.

## The key in memory

Signing requires the secret key in memory. There is no arrangement in which it is
not, so the only honest question is *for how long*.

The key is derived on a WebAuthn tap, held in a closure for the session, and
zeroed when the popup closes or the grant expires — whichever is first. It is
never written to `localStorage`, `sessionStorage`, `IndexedDB`, or any network
request, and a test asserts that rather than a reviewer promising it.

A fresh tap is required for the first request of a session, and again after any
grant expiry. Convenience is bounded by the grant, not by how long the tab
happened to stay open.

## Attestation is the product

Everything above is worth nothing if the JavaScript in the user's browser is not
the JavaScript we published. Whoever controls the signer origin can serve a
version that keeps `prf_out`. That is T9, it is disclosed in
[custody tiers](../docs/content/custody.md), and it does not go away.

What can be done is make it **detectable**:

- Every signer release is reproducibly built, and its bundle hash is published as
  a signed event on relays we do not control
- The signer serves its own hash and the build metadata at a fixed path
- `signer-log` compares what was served against what was attested and reports a
  mismatch
- **The approval UI is inside the attested bundle**, because it is the
  anti-phishing surface and an unattested prompt is an unattested prompt

The claim this supports, and the only one it supports:

> Every other web signer asks you to trust that the code you received is the code
> they wrote. This one publishes the hash, and you can check.

Detectable, not impossible. Say it that way.

## Limits, stated so nobody has to discover them

- **The signer origin remains a single point of failure.** Attestation makes a
  substitution catchable, not preventable. Tier 1 is an on-ramp, not a
  destination, and the interface says so on every screen.
- **Popup blockers break the flow.** A request must originate from a user
  gesture; there is no way around it and clients must be told at integration time
  rather than in a support thread.
- **A client can spam requests.** The defence is that each one costs a visible
  prompt, so the failure mode is an annoyed user rather than a silent signature.
- **A grant is trust in a client's judgement, not in its code.** Within its scope,
  a compromised client can obtain signatures. It cannot obtain the key, cannot
  exceed the scope, and cannot outlive the expiry — but within those bounds it can
  act. Scope narrowly and say why.

## Must not be built

```
an iframe transport
postMessage with targetOrigin '*'
a grant with no expiry
a grant that covers all kinds
blocking unregistered origins
an API key that gates capability rather than naming
nip04_encrypt / nip04_decrypt
a key persisted anywhere at all
an approval prompt outside the attested bundle
a "don't ask again" that survives the session
```

## Why this order

The request protocol is the thing every future client depends on and the thing
that is expensive to change once anyone is live on it. bermlaunch will be the
first client, and a first client is how a temporary shape becomes permanent.

So this is specified before deployment, and deliberately in someone else's
vocabulary, so that being replaced is cheap for the people who depend on us.
