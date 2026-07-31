# @berm/node-pages

A Berm node you can fork. Relays in, static site out, deployed by GitHub Pages.
No server, no database, no PHP.

```bash
cp node.config.example.json node.config.json   # set your npub and relays
npm ci
npm run build      # → dist/
npm test           # 18 assertions
npm run verify     # 17 end-to-end checks against real relays, one of them hostile
```

## What a node is for

Two things at once, and the second is the one people miss.

**A mirror.** Your posts live on relays; this renders them as web pages on a host
you chose. If the relay set changes, or a host disappears, the work does not.

**A witness.** Every page it serves re-checks itself against relays *in the
visitor's browser* and reports `verified`, `unverified` or `mismatch`. So a
discrepancy between what a site shows and what its author signed becomes visible
in public rather than only to whoever runs the server.

That second property gets stronger with every independent node. It is the same
argument the signer gate makes: detection improves with the number of parties who
have no incentive to cover for each other. Which is why this is a thing you
**fork** rather than a thing you install from us.

## What it refuses to do

**Publish anything it did not verify.** Relays are untrusted. Every signature is
checked locally, every event that fails is dropped and counted per relay, and
events by another author are discarded — a relay returning those is answering a
different question, not lying.

The end-to-end suite runs a deliberately hostile relay serving a tampered post
and a stranger's post alongside the real ones, and asserts neither reaches the
site.

**Silently shrink your archive.** If a build fetches fewer posts than the last
one did, it stops:

```
REFUSING TO PUBLISH — fetched 3 events but the previous build had 10.
Relays may be down. Publishing would silently truncate the archive;
pass --allow-shrink if the loss is intentional.
```

Two relays being down should not quietly replace a complete archive with a
partial one, because **a visitor cannot tell a short site from a censored one.**
The override exists and is deliberate.

**Publish an empty site.** All relays down means no build, not a blank page where
your work used to be.

## Transparency

`manifest.json` carries a SHA-256 of every file. Anyone can hash what they were
served and compare against a build produced from a public commit. A deploy that
lies is detectable rather than merely unlikely — the same reason the docs site
does it.

The pages themselves ship no external origins. No CDN, no fonts, no analytics.
`prepare.mjs` fails the build if any leak in.

## Set-up

1. Fork this directory into its own repo.
2. `cp node.config.example.json node.config.json`, set `npub`, `handle`, `origin`
   and at least **two** relays. One relay is a single point of failure wearing the
   costume of a source, so the build refuses fewer.
3. Repo → Settings → Pages → Source: **GitHub Actions**.
4. Push. `.github/workflows/publish.yml` rebuilds four times a day and on demand.

The schedule matters: a mirror that only updates when you remember to run it is
not a mirror.

## What this is not

It is **not** a signer, and it must never become one. It holds no key material
and signs nothing — it reads public events and renders them. The one hard rule
from the spec applies here unchanged: a node never touches key material.

It is also not a claim that you trust us. Forking means you run this build, from
source you can read, on infrastructure you picked. If it required trusting the
project, the whole exercise would be pointless.

## Honest limits

- **Card images are not mirrored.** The pages reference them by hash and fall back
  across hosts (NIP-B7), but this build does not copy blobs into your repo — that
  would grow it without bound. If the image hosts all vanish, pages render without
  cards and say the image is unverifiable rather than pretending.
- **GitHub sees your build.** Pages is a different trust set from a VPS, not
  automatically a smaller one. It is more auditable — public commit, public build
  log — and it is still a third party who could serve different bytes. Stated
  rather than glossed.
- **The verifying script comes from the same origin as the page.** Browser-delivered
  cryptography cannot verify itself. `prepare.mjs` prints the script's SHA-256 so
  it can be compared against a build from source.
