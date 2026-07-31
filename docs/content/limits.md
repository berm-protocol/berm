---
d: docs/limits
title: Limits
summary: What this does not do. Read it before you build, not after.
t: [berm, limits]
nav: 9
x_article: full
---

# Limits

A developer who discovers a boundary in production will not build a second thing
with you. So here they are, up front.

## The default tier is not sovereign

The protocol is sovereign. **Tier 1 — the passkey signer, the path most of your
users will take — is not**, and this is the limit to read before any of the
others.

WebAuthn binds every credential to an RP ID derived from the signer origin. The
authenticator releases the secret to any page served under that name and cannot
tell one operator from another. So whoever controls the signer DNS name can
obtain the identity key of every tier-1 user who authenticates after that point.

No break-in is needed. A lapsed registration, a sale, a registrar action or a
court order produces the same outcome. CSP, SRI, reproducible builds and
published hashes all defend the *bytes served under a name*; this is an attack on
the *name*.

Tiers 0 and 2 carry no such dependency, which is why they are not optional
garnish — they are the exits, and the protocol keeps working with the tier-1
signer permanently gone.

What tier 1 does still give you, precisely: no key at rest anywhere, and no
retroactive exposure — a future name-holder can sign as the user *going forward*,
but cannot alter, delete or claim what the user already published. Enrollment
forces a key export, which guarantees the user can never be locked out. It does
not guarantee they stay the only signer. Those are different properties, and
today only the first one is solved.

The fix — a user-held NIP-06 root that the passkey merely wraps — is specified
and not built. See [Custody tiers](docs/custody#what-tier-1-costs).

## Sovereignty is not distribution

X cannot touch your users, your data, or your ability to sign. X absolutely
controls **whether anyone sees you**: deboosted links, a banned project account,
a domain that quietly stops rendering previews.

The honest claim is *you keep your users when a policy changes*. It is not *you
keep your reach*. Anyone selling you the second one is selling you something.

## Writing into X — borrowed for Articles, not for ordinary posts

This page used to say flatly that posting into X is not sovereign. That was too
pessimistic, and the distinction is worth having.

**X Articles are borrowed.** `/2/articles/draft` needs OAuth, a developer app and
the `tweet.write` scope — a permission that can be withdrawn on a Tuesday.

**Ordinary posts are not borrowed at all.** A share intent —
`https://x.com/intent/tweet?text=…` — is a plain URL. No API key, no developer
app, no OAuth, no rate limit, and no per-post cost. The user posts it themselves
in X's own composer, from their own session, so there is no automation to justify.
It is also the one X write path that is not realistically revocable: every share
button on the web is built on it. The protocol already relies on this for the
proof post, and `crypto/src/nip39.ts` has done so from the start.

| Direction | Sovereign? |
|---|---|
| Identity, signing, publishing to relays | yes — at tiers 0 and 2; see above for tier 1 |
| Rendering on your own node | yes |
| Reading public X content | mostly — subject to their access rules |
| Posting to X **via share intent** | not borrowed — no credential exists to revoke |
| Posting an X **Article** via the API | **no. Always revocable.** |

What the intent path cannot do, since these shape the design rather than being
footnotes:

- **No media upload.** There is no `media` parameter. An image reaches a post only
  as the `og:image` of the linked page, which X's crawler unfurls — so a post
  carrying a card necessarily carries a link, and links get deboosted.
- **No thread pre-fill.** One composer, one post.
- **No delivery confirmation.** Nothing comes back — no callback, no post id. An
  app can prove it *offered* you a composer and never that you posted. Any product
  showing "Posted to X ✓" after opening an intent is asserting something it cannot
  know.

Design accordingly: API-writing should be a feature that degrades, never a
dependency that breaks you. Intent-writing you can lean on.

## X Articles cannot express everything

Measured, not assumed. Pasting into the X Articles editor keeps headings, bold,
italic and links. It drops **images**, **tables**, and **monospace/code blocks**.

The workaround for tables and character art is to render them as PNGs with
positional markers and a downloadable image manifest. It works, and it has a
real cost: **a picture of code cannot be copied.** So reference documentation
does not belong in an X Article, and this documentation site links to X rather
than living there for exactly that reason.

## Premium and per-article costs are X's, not ours

X Articles requires a Premium subscription. That is between the user and X. We
cannot remove it, discount it, or work around it, and nothing in this project
should imply otherwise.

## The unrecoverable loss

If a user loses their key with no backup and no guardians named in advance, the
identity is gone. Permanently. There is no reset, no support queue, no
administrative override.

That is the cost of nobody being able to seize it, and it is the single most
important thing to communicate to a non-technical user *before* they need it. See
[Recovery](docs/recovery).

## Guardian rotation is social, not cryptographic

Guardians hold no fragment of a key. They attest; relying parties choose whether
to honour the attestation. Describing this as "key recovery" to users would be a
lie that only becomes visible at the worst moment.

## Not built yet

Stated so nobody plans around vapour:

- **The tier-1 signer origin.** The client is complete; the deployed origin is
  not. Tier 1 reports itself unavailable rather than auto-selecting and failing.
- **NIP-98 HTTP auth** — logging in to ordinary web services with this identity.
- **Server-side PNG rendering** for tables and character art. Client-side works.
- **Framework wrappers** for React and Vue. The surface is small enough that
  this is not urgent.

## Where the browser is doing the work

The guarantee that a passkey cannot be used from a second origin is enforced by
the browser's WebAuthn RP-ID handling, not by our code, and it cannot be tested
in Node. Our half — that derivation refuses to run outside the signer origin —
is tested. The other half is a per-platform manual checklist before release.

We call that coverage **partial**, because it is.
