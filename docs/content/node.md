---
d: docs/node
title: Running a node
summary: What a node does, the short list of things it may do, and why it has nothing worth stealing.
t: [berm, node, wordpress]
nav: 7
x_article: none
---

# Running a node

A node turns published events into web pages. Any WordPress site can be one.

## The trust boundary

**The node never receives key material. The node never signs.**

That is not a guideline. It is the reason a node can be run by someone you have
no reason to trust, and the reason a compromised node is an inconvenience rather
than a catastrophe.

### What a node may do (exhaustive — anything else is a bug)

1. Verify signatures on events it receives
2. Render content to HTML, and generate card images
3. Serve `/.well-known/nostr.json` for NIP-05
4. Fetch a proof post from X server-side to upgrade `claimed` → `verified`
5. Cache what it has rendered
6. Store a **pseudonymous** mapping for routing

### What a node must never do

- Hold, derive, wrap, unwrap or transmit a private key
- Sign an event on a user's behalf
- Persist a raw X user ID (HMAC pseudonym only — the one exception is an
  attestation the *user* published, which is public by their own choice)
- Import `direct-messages.js` from an X archive export, in any form, ever
- Accept an ingest request authorised only by an X session

The last two are worth dwelling on. A user uploading their X archive is handing
over their entire private message history without thinking about it; the safe
design is to never read that file. And authorising writes with an X session
means X's auth state controls your data — which is the dependency this whole
project exists to remove.

## Verification without dependencies

The WordPress plugin verifies BIP-340 Schnorr signatures in **pure PHP** — 16
limbs of 16 bits, no GMP, no BCMath, no extensions. Roughly 130 ms per
verification, and all 15 official BIP-340 test vectors pass.

That started as a constraint and became the point: verification that needs a
compiled extension is verification most shared hosts cannot do, and a protocol
whose correctness check only runs on privileged infrastructure has quietly
recreated the thing it replaced.

Base 2^16 was chosen because 2^256 lands exactly on limb 16, which makes fast
reduction a clean split rather than a bit-shuffle.

## What a WordPress owner gets

- Long-form content that lives on relays and renders on their domain, under
  their design
- Pages that survive their host, because the content is not stored there
- An identity layer for readers that does not depend on X staying friendly
- Card metadata and image generation, so links look right when shared

And what they take on: rendering and hosting. Nothing that requires them to be
trustworthy, because nothing valuable passes through them.

## Serialization: one rule that will bite you

NIP-01 event IDs are the SHA-256 of a canonical JSON array. In PHP:

```php
json_encode($arr, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
```

Omit either flag and your ids differ from every other implementation, silently,
for content containing a slash or a non-ASCII character. Which is most content.

## If a node disappears

Nothing is lost. The content is on relays; another node renders it. Users keep
their identity because it was never issued by the node.

This is the property to test when someone claims to have built something
sovereign: turn off their server and see what survives.
