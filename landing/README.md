# @berm/landing

The page a card leads to. Content first, checked in the visitor's own browser, and
it hands them a way to leave it.

```bash
npm install
npm test          # 89 assertions, offline
npm run build     # dist/hydrate.js + dist/render.mjs, with SRI
npm run verify    # 31 browser checks against honest, lying, forging and silent relays
```

## What it inverts

Every platform renders content and asks to be believed. This page declares which
signed event it claims to be rendering, and the visitor's browser fetches that
event from relays, re-verifies the signature locally, and compares.

So the claim is not *"this server says the content is real."* It is *"this server
handed you a rendering and your own browser checked it."* The page ships with the
means to refute itself.

That also resolves the hosting worry: even when the page and the card both sit on
a convenience host, that is only a **presentation** dependency — the host cannot
lie without the page reporting the lie. A centralised layer structurally unable to
become an authority is a better outcome than asking people to trust one.

## Three states, and the middle one is the point

| State | Means | Shown as |
|---|---|---|
| `verified` | ≥2 relays returned the event, signatures check, the rendering matches | the count, in green |
| `unverified` | nothing to compare against — silence, one relay, or every copy forged | amber. **Never a tick.** |
| `mismatch` | a validly signed copy exists and disagrees with this page | red, and it says to trust the signed copy |

**Mismatch outranks everything.** One valid copy that disagrees proves the page is
wrong, and no number of agreeing relays makes that untrue — this is not a vote.

**A forged copy is evidence of nothing.** It says something about the relay and
nothing about the rendering, so it is counted separately, named in the detail line,
and can never satisfy the quorum. Twenty relays serving forgeries still produces
`unverified`.

**The worst state wins.** A page whose text verifies but whose image was swapped is
not a verified page. Showing a tick because most checks passed is how a partial
failure gets read as a pass.

## Why the event id makes the comparison strong

A Nostr event id is a hash over its content, so an event fetched by id cannot have
content other than what that id commits to. `mismatch` therefore has exactly one
meaning: the page rendered something the signed event does not say. Stale, or
lying. There is no innocent third explanation, which is why it is never softened.

## The card is checked too

The card is the entire visual payload of the post on X, served by a host that may
not be the author. Without a commitment, whoever holds that host can substitute the
picture and the signed event will not contradict them.

So the author commits to `x <sha256>` in the `imeta` tag, and the browser hashes
the bytes it was served. Blossom addresses blobs by hash, so the same card has the
same path on every server — which is what makes the host a **cache** rather than an
authority, and what lets a client fall back via the author's `kind:10063` server
list (NIP-B7).

A displayed image with **no** committed hash reads as `unverified`, not `verified`.
That distinction was originally collapsed, and the browser suite caught it
reporting such a page as fully verified.

## Content first — a structural rule, not a preference

A visitor clicked a table, so they get the table: above the fold, ungated, no modal
on load, no interstitial. The risk of putting a link on X is not marketing, it is
**destination mismatch** — a page that leads with a pitch is a bait-and-switch
reached from a post, and that is what gets a domain flagged.

`test/render.test.ts` asserts the document order and the absence of any overlay,
and the browser suite measures the rendered geometry, so this stays a property
rather than an intention.

## It hands them a way to leave

The `nevent`, the author's npub, and their write relays are printed on the page.
If the same content does not resolve anywhere else, "sovereign" is a sticker on a
hosted page — so the exit is part of the deliverable.

## The honest ceiling

The verifying script is served by the same origin as the page. A hostile origin
could ship a version that paints `verified` unconditionally. **Browser-delivered
cryptography cannot verify itself** — the same limit as the signer, mitigated the
same way: published SHA-256, SRI, and a build attestation a third party can check.
`build.mjs` prints the SRI hash for exactly this reason.

What the design does guarantee is that it **fails closed**. The markup ships as
`data-state="checking"` with neutral copy, never a pre-set pass. If the script is
blocked, or throws, the visitor is left with an unresolved check rather than a tick
nothing computed — proved by a browser case that injects `throw new Error()`.

## Tests worth reading

The relays in `relays.mjs` behave four ways, because a relay that only tells the
truth cannot demonstrate that the page catches one that does not:

- **honest** → serves the event as signed
- **liar** → a validly signed event for a *different* post. Real cryptography,
  wrong id. Only the id check catches this one.
- **forger** → right id, tampered content, so the signature fails
- **silent** → EOSE with nothing

Two bugs these caught, both of which would have shipped:

1. **A displayed image with no committed hash reported the page as verified**,
   because the card check was skipped when no hash existed rather than treated as
   unverifiable.
2. The test harness itself used `opts.cardSha ?? default`, so passing `undefined`
   silently restored the default and the case was never exercised. A test that
   cannot fail is worse than no test.

## URL shape

`/@handle/slug`, matching the node. The composer previously emitted `/p/<16 hex>`,
which was two shapes for one concept — and the wrong one: X deboosts posts
containing links, so the link that does get through has to survive a human's
split-second spam judgement. `xonly.ai/p/a1b2c3d4` reads as a tracking redirect;
`their-site.com/@dorin/custody-honestly` reads as a page somebody owns.

The shape is identical on the author's own domain and on a convenience host, so
moving between them keeps the path and old links can be redirected rather than
broken.

## Unverified by machine

- Whether X's crawler accepts `og:image` dimensions that differ from 1200×630
  (the file is a 2× render at 2400×1260, and the declared size describes the bytes).
- Whether a card-bearing post's link deboost outweighs the card's stopping power.
  That is an A/B test with a real account, and I would not assume the answer.
- Blossom retention in practice. `DELETE /<sha256>` exists (BUD-12) and nothing
  obliges a server to keep anything, so mirrors are not paranoia.
