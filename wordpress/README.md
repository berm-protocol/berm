# XOnly Node — WordPress plugin

Turns any self-hosted WordPress site into a sovereign node: sign in with X,
publish articles the author owns to Nostr, and serve canonical pages with
correct card metadata.

**It never touches a private key.**

## Install

Copy `xonly-node/` into `wp-content/plugins/`, activate, then
**Settings → XOnly Node**. Paste the OAuth redirect URI shown there into your X
app settings.

## What it may do, exhaustively (Berm v2 §5.2)

1. Run the X OAuth 2.0 + PKCE handshake
2. Call `/2/users/me` once, keep the handle, discard the token
3. Verify NIP-39 claims (Channel B)
4. Hold node configuration
5. Verify and store signed articles, and render them

## What it must never do

- Touch a private key, in any form, ever
- Persist a raw X user ID — only a per-site HMAC pseudonym is stored
- Sign anything
- Treat `wp_posts` as the source of truth for user content

If any of those stops being true, it is a bug, not a feature.

## The part worth reviewing first

The node accepts signed events over HTTP rather than opening relay websockets,
because PHP hosting and long-lived connections get along badly. **That makes
self-verification mandatory** — an ingest endpoint that trusts its input is an
open forgery gate.

So the plugin carries a complete BIP-340 Schnorr verifier:

- **GMP fast path** when the host has the extension
- **Pure-PHP fallback** otherwise — 16 limbs of 16 bits, with the secp256k1
  fast reduction. Base 2^16 is slower than a wider limb, but 2^256 lands
  exactly on limb 16, which makes reduction a clean split. In verification
  code, obviously-correct beats fast.

Measured: **~130 ms per article** on the pure path, once, at publish time.
Plenty of WordPress hosts ship without GMP *and* without BCMath, and "any host
can be a verifying node" is a claim the project actually makes — so the
fallback is the point, not a consolation.

There are two independent gates on ingest: an X session (authorisation) and the
signature check (verification). Either alone would be weaker than both.

## Tests

```bash
php tests/test-schnorr.php   # 15 official BIP-340 vectors, all negatives included
node tests/gen-events.mjs    # sign with nostr-tools, the editor's own library
php tests/test-events.php    # the node verifies what the editor signs
php tests/test-xss.php       # escaping, checked in real attribute contexts
php tests/test-render.php    # markdown, card metadata, GD card image
```

All pass on PHP 8.4 with no GMP and no BCMath.

The cross-language test is the one that matters: events signed by the same
library the editor uses, verified by the node — including a case with forward
slashes, accents, CJK and emoji, which is exactly where a naive PHP
`json_encode` silently changes the bytes, changes the id, and makes every
signature look invalid.

### A footgun found while writing these

`nostr-tools` memoises `verifyEvent` on the event object via a `Symbol`, and
JavaScript object spread **copies symbol properties**. So a spread clone of a
verified event still reports valid after you tamper with it. Anything building
on nostr-tools should clone through JSON before mutating. The PHP verifier
catches what the cached JS check missed.

## URLs it serves

| Path | Purpose |
|---|---|
| `/@handle/slug` | The canonical article page |
| `/xonly-og/handle/slug.png` | Card image, generated server-side with GD |
| `/.well-known/nostr.json` | NIP-05, with `_` and permissive CORS |
| `/wp-json/xonly/v1/publish` | Signed-event ingest |
| `/wp-json/xonly/v1/session` | Sign-in state for the editor |

Card images have to be generated server-side because X's crawler does not
execute JavaScript. The crawler is also anonymous — no cookies, no session — so
a card can never be personalised per *viewer*. It is personalised per *URL*,
which is all that's needed.

## Known gaps

- The editor bundle is not yet wired in as `assets/editor.js`; the shortcode
  expects it. Ship the editor build there.
- No admin list of stored articles yet.
- Channel B verification is computed but not yet displayed on article pages.
- Not tested inside a live WordPress install — the WordPress-facing code is
  lint-clean and follows the documented APIs, but the crypto, rendering,
  escaping and card layers are the parts covered by actual tests.
