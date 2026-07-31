---
d: docs/concepts
title: Concepts
summary: X is the on-ramp, not the custodian. The one inversion that everything else follows from.
t: [berm, concepts]
nav: 2
x_article: adapted
---

# Concepts

## The inversion

Almost every app that uses X as a login treats X as the **custodian**: the
account is the identity, so when the account dies, the user dies with it. People
who signed up to a service years ago with an X account they have since lost are
simply gone — not locked out, gone, with no path back that anyone can offer.

Berm inverts that.

```
  conventional          the identity IS the X account
                        X can revoke it, therefore X owns your users

  Berm                  the identity is a key the user holds
                        the X handle is a CLAIM attached to it
                        X can revoke the claim; the identity is untouched
```

That single change is where every other property comes from. It is worth
being precise about what each piece is.

## Identity

A secp256k1 keypair. The public half is an `npub`; the private half never leaves
the user's signer. This is the account. Nothing about it depends on X, and
nothing about it depends on any server staying online.

For most users the key is derived from a **passkey** — specifically, from the
WebAuthn PRF extension, which returns 32 bytes of secret that exist only inside
the authenticator and cannot be computed from anything public. The user
experiences it as Face ID. What they get is a cryptographic identity.

One qualifier, and it belongs here rather than three pages later: that passkey
path — tier 1 — **does** depend on us, because WebAuthn ties the credential to
our DNS name and the authenticator cannot tell us apart from whoever holds that
name next. A user on a browser extension (tier 0) or their own bunker (tier 2)
has no such dependency. The protocol is sovereign; its easiest on-ramp is not
yet. [Custody tiers](docs/custody#what-tier-1-costs) is the full statement, and
it is the one page to read before believing anything else here.

## Claim

A statement, published by the user and signed with their key, that says *"I
control @handle on X"* — a NIP-39 `i` tag in their profile, pointing at a proof
post on X that names their `npub`.

It is a claim, not a fact, until something checks it. Which brings us to the
distinction the whole binding model rests on:

| State | Means |
|---|---|
| `unlinked` | No claim at all |
| `claimed` | The user asserted a handle. **Nothing has been checked.** Anyone can assert anything. |
| `verified` | Something fetched the proof post and matched it |

Rendering `claimed` as `verified` is an impersonation vector, not a cosmetic
bug. The SDK's profile parser is structurally incapable of producing `verified` —
a browser has no CORS-open way to check a post on X, so the optimistic value
cannot be constructed there at all. The upgrade is a node's job, server-side.

See [Identity and X](docs/identity) for the full flow, including why an archived
proof matters more than a live one.

## Relay

A dumb, replaceable server that stores signed events and hands them out. Relays
do not authenticate anyone and cannot forge anything, because every event
carries its author's signature.

Two rules fall out of that:

- **Publish to at least two.** One relay is a single point of failure. The SDK
  reports `success: false` at one acceptance, on purpose.
- **Verify everything they return.** A relay is an untrusted party that can send
  whatever it likes. The SDK checks every signature and drops what fails — and
  the test suite proves it against a relay that deliberately serves a forgery,
  because otherwise that check is an assumption rather than a fact.

## Node

A server that renders published events into web pages — the WordPress plugin is
one implementation. Its trust boundary is narrow and worth memorising:

**The node never touches key material. The node never signs. Ever.**

It verifies signatures, renders content, serves pages, and makes the server-side
checks a browser cannot (like fetching a proof post from X to upgrade `claimed`
to `verified`). If a node disappears, nothing is lost: the content is on relays,
and another node renders it.

That is why a node can be run by anyone, including people you have no reason to
trust. It has nothing worth stealing.

## App

Anything built on `window.berm`. It asks the signer for signatures and gets
back events. It never sees a key, and it holds no credential from X.

This is the part that matters for a developer deciding whether to build here:
**there is nothing for a policy change to revoke, because nothing was issued.**
No API key, no developer app, no rate limit, no review queue.

## Putting it together

```
   passkey ──► signer ──► signs events ──► relays ──► node ──► the web
   (key)       (origin)                    (data)     (view)
                                              │
   X handle ──► proof post ──► archived ──────┘
   (claim)                     (evidence)
```

Read it once more with the failure cases in mind, because that is the actual
argument:

- **X bans the user.** The claim goes stale. The identity, the content, the
  followers and the app access are untouched. The user posts a new proof from a
  new handle and updates their profile.
- **A relay dies.** Another one has the same events. Nothing was unique to it.
- **The node dies.** Someone else renders the same events. Nothing was unique to it.
- **xonly.ai dies.** Every published event still resolves in every other Nostr
  client. This is the test that separates a protocol from a website.
- **The user loses their key with no backup.** This one is real, and it is the
  only unrecoverable loss in the system. See [Recovery](docs/recovery) — it is
  the page we would most like you to read before you need it.
