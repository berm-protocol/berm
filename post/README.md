# @berm/post

Post tables, code and diagrams to X without them turning into mush — and keep the
original signed on a network X does not control.

```bash
npm install
npm test          # 68 assertions, offline
npm run build     # dist/xonly-post.html — one file
npm run verify    # 44 browser checks, two local relays
npm run serve     # http://localhost:8112
```

## The claim

X's composer is optimised for speed and disposability, and you will never beat it
there. This does not try. It competes on **artifacts** — the thing someone spends
twenty minutes on — and on the fact that X destroys exactly those on paste.

Since X strips headlines and descriptions from link cards, the 1200×630 image *is*
the card. That makes it a canvas you fully control and that nobody typing into X's
box can produce: a real table, aligned code, a character diagram, a pull quote.
The card carries the picture; the permalink carries the copyable original.

## Order of operations is the product

```
1. write            prose, plus at most one artifact X would ruin
2. sign  →  relays  unconditional, independent of X, permanent
3. offer  →  X       a pre-filled composer the user submits themselves
```

Step 2 completing is success. Step 3 may never happen, and the UI never implies it
did.

## No API. Not a fallback — better.

`https://x.com/intent/tweet?text=…` needs no developer app, no OAuth, no API key,
no rate limit, and costs nothing per post. The user posts it in X's own composer
from their own session, so there is no automation to justify and no "posted via"
attribution. It is also the one X write path that is not realistically revocable:
every share button on the web is built on it.

The protocol already relied on this for the proof post (`crypto/src/nip39.ts`).
This package generalises it and adds the part that was missing — knowing whether
what we hand X will actually fit.

## Two budgets, because one is not enough

X does not count characters. It counts weighted units.

| Input | Characters | X units |
|---|---|---|
| `hello world` | 11 | 11 |
| `これは日本語です` | 8 | **16** |
| one family emoji | 3+ code points | **2** |
| `https://x.ai` | 12 | **23** |
| `xonly.ai` | 8 | **23** |

The second budget is the encoded length of the intent URL, and it catches what a
character counter cannot: one emoji becomes twelve characters once
percent-encoded, so a post can pass X's counter and still be cut in the URL.

**Both are checked before the button is enabled, and `buildIntent` refuses rather
than truncating.** A truncating share button publishes two thirds of an argument
and the author finds out in public.

Which budget binds first is pinned by a test: at the standard 280-unit limit the
character budget always wins, and the URL cap only becomes live above ~333 units —
that is, for premium accounts. It looks like dead code and is not.

## The rule this package exists to keep

**Nothing here may claim a post reached X.** Opening an intent returns nothing —
no callback, no post id, no confirmation. So:

| State | Means |
|---|---|
| `draft` | nothing signed |
| `signed` | published to ≥2 relays, permanent, independent of X |
| `offered` | X's composer was opened. Whether you posted is unknown and always will be |

There is no `posted` state. `test/nostr.test.ts` walks every event this module can
produce against a tag allow-list, so a future `x_posted` tag added in good faith
breaks the build rather than shipping a lie.

## Terms of service, since this draws inside X

- No X badge, logo, tick or chrome is ever drawn. A card imitating X's own UI is
  passing itself off as X.
- **No cloaking.** One function generates the permalink page for the crawler and
  for a person; there is no user-agent branch and no place to add one. A test
  asserts the generator's source contains no such thing.
- The card URL is content-addressed, so a card cannot be swapped after it has
  been shared.

## Tests worth reading

The ones that caught real bugs rather than confirming intentions:

- **`og:image:width` declared 1200×630 while the file was 2400×1260.** Metadata
  that contradicts the asset. Invisible to unit tests; the browser check found it.
- **The over-limit warning was hidden behind "sign first."** Someone 20 units over
  would have discovered it after signing.
- **The approval sheet showed the app's wording while the panel promised
  different wording.** Two descriptions of one signature. Fixed by showing the
  *signer's* description verbatim — it is authoritative about what is being
  signed — with our line about the non-consequence underneath.
- A declined signature publishes nothing, and is not styled as an error.
- One relay accepting is not reported as published.

## Reused, not re-implemented

- Table, code and diagram rasterisers: `editor/src/render/block-png.ts`
- Signing surface and the ≥2-relay quorum: `sdk/` — publishing goes through
  `sdk.publish()` so the rule under test is the one apps ship with
- Test relay: `link/local-relay.mjs`

**Known cleanup:** three near-identical copies of that test relay exist (`editor`,
`link`, `recovery`). This package imports rather than adding a fourth, but
hoisting all of them to one shared module is owed and recorded here rather than
silently carried.

## Unverified by machine

Needs a real X account, and cannot be settled from a test suite:

- Where the intent endpoint actually truncates. `MAX_INTENT_URL = 2000` is
  **chosen, not measured** — deliberately well below any plausible ceiling.
- Whether a card-bearing post's deboost for containing a link outweighs the
  card's stopping power. That is an A/B test, and I would not assume the answer
  in either direction.
- Whether X's weighted-counting configuration still matches twitter-text v3.
