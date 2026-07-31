# XOnly editor — prototype

Write once. Publish to three places. Own the canonical copy.

```bash
npm install
npm run build      # -> dist/xonly-editor.html   (one self-contained file)
npm run serve      # -> http://localhost:8100
npm run verify     # headless run against two signature-verifying relays
```

## What it does

```
        [ you write once, in a real editor ]
                        |
     +------------------+------------------+
     v                  v                  v
 Nostr kind 30023   your node page     X Article (API)
 (NIP-23 long-form) (canonical URL,    (native, in-feed,
  renders in Habla,  dynamic card,      ranks in-algorithm)
  YakiHonne, njump)  survives a ban)
```

One document model, three serializers. The author's document is canonical;
every destination is a rendering of it. Nothing is derived from an X-shaped
source, so losing X loses a rendering, not the work.

## The image escape hatch

X Articles support headings, bold/italic/strike, lists, quotes, links and
images. That's the whole set — no tables, no monospace, no layout. But images
are unrestricted, so **anything X cannot render structurally, we render as a
picture**.

| You write | Node page | X Article | Nostr |
|---|---|---|---|
| Table | real `<table>` | rendered PNG | markdown table |
| Character art | `<pre>` monospace | rendered PNG | ``` fence |

Character art is the clearest case. As *text* on X it is unusable — alignment
depends on a fixed-width font, X renders proportional, and every row shears. As
an image it is exact.

Two costs, stated plainly: text inside an image isn't selectable or searchable
on X, and screen readers get only the alt text. Both are solved on the node
page, where it stays real HTML — another argument for the node page being the
canonical copy.

## The editor

Notion-style blocks. Markdown shortcuts as you type: `# `, `## `, `### `,
`> `, `- `, `1. `, ```` ``` ````, `---`. Cmd/Ctrl+B / I / U / K for inline
formatting and links. Enter on an empty list item exits the list. Backspace in
an empty heading demotes it to a paragraph rather than deleting, so one
keystroke undoes an accidental shortcut.

Paste is stripped to plain text — pasted markup is the fastest way to poison a
clean model, and nobody wants the source styling anyway.

**Tables** edit in place; Tab walks the grid. **Diagram** blocks are a monospace
textarea where Tab inserts spaces rather than stealing focus.

## Templates

Essay, Product launch, Announcement, Link hub, How-to. Each is a skeleton to
overwrite, not a wizard — the fastest route to a good page is a good page with
the wrong words in it. X has no template system at all.

## Why the signer feels slow on purpose

`src/sdk/local-signer.ts` holds a key locally, but reproduces what the real
NIP-46 signer will do: ~450ms latency, an explicit approval prompt, and real
failure modes. An editor written against instant local signing needs reworking
the day a remote signer arrives. Written against this shape, it does not.

Decline the prompt and **nothing publishes** — that path is covered in
`npm run verify`.

## The FOR X panel

Measured against the real X editor, not the docs:

- **survives** — h1, h2, bold, italic, strike, links, lists, blockquote, long
  paragraphs, all unicode
- **lost** — h3 (demoted to body text), inline code, code blocks, and **every
  image**, hosted URL and data URL alike
- **also** — a body paste leaves X's title field empty

So "copy for X" is a transform, not a copy. It drops the h1 (that's the title,
copied separately), demotes h3 to bold so it still *reads* as a heading, and
replaces every image with a numbered marker — then lists those images with
thumbnails and download buttons so the author can drop them in at the markers.

Losing things loudly beats losing them silently.

## X Articles

`POST /2/articles/draft` then `POST /2/articles/{id}/publish`, OAuth 2.0 PKCE,
scopes `tweet.read` `tweet.write` `users.read`, content as DraftJS ContentState.

Leave the token field empty and the step is skipped — but the exact request is
still built and displayed, so the path works unchanged the moment developer
access clears. Paste a user token and it publishes for real.

**Compliance boundary.** This is the one place XOnly writes to X, and publishing
is always initiated by a human pressing Publish with their own OAuth consent —
which is what the endpoint is for. What stays prohibited is unattended, bulk, or
scheduled posting with no human in the loop, and anything resembling paid
engagement. The line is human-in-the-loop, not "never touch the write endpoint".

## Cards

1200x630, rendered live on canvas. In production the same layout runs
server-side at the node, because X's crawler does not execute JavaScript.

The crawler is also anonymous — no cookies, no session — so a card can never be
personalised per *viewer*. It is personalised per *URL*, which is all that's
needed: a unique path renders a unique image. That is the mechanism behind every
"share your stats" card in a feed.

## Known gaps

- No image upload — image blocks take a URL. Real uploads need the node's media
  endpoint and X's media upload for cover images.
- No drag-to-reorder blocks.
- No autosave or draft recovery.
- The X path has never run against the live API; only the payload is verified.
- Local signer is development only. Production derives from WebAuthn PRF at a
  dedicated origin and never exposes key material to page code.
