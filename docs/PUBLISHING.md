# How these docs are published

The documentation is published through the protocol it documents. That is not a
stunt. It means the docs going down **is** the protocol going down, so nobody
has to take the architecture on trust — every developer reading a page is
watching a live demonstration, and any regression is publicly visible before it
reaches a user.

It also means we cannot quietly special-case ourselves. If long-form publishing
is awkward, we feel it first.

## The contract

Each page is one **kind 30023** event (NIP-23 long-form), signed by the project
identity, addressed by a `d` tag:

```
kind        30023
d           docs/<slug>              e.g. docs/start
title       <title>
summary     <one line, used for cards and search results>
published_at <unix seconds, first publication — NOT updated on edit>
t           berm                     (topic tags, repeatable)
content     markdown
```

`created_at` moves on every edit; `published_at` does not. NIP-23 replaceable
events mean the newest `created_at` for a given `(pubkey, kind, d)` wins, so an
edit is a re-publish rather than a mutation — and every prior version stays
resolvable by event id.

The canonical address for any page is therefore:

```
30023:<project-pubkey>:docs/<slug>
```

which resolves in **any** Nostr client, not only ours. That is the test: if a
page only renders on xonly.ai, we have built a website, not a protocol.

## Source of truth vs. delivery

The signed event is the source of truth. The node is a **renderer with a cache**,
and the distinction matters in exactly one direction:

```
                  ┌──────────────┐
   sign & publish │   relays     │  ← source of truth, verifiable by anyone
        ▲         └──────┬───────┘
        │                │ fetch on publish + periodic reconcile
   author machine        ▼
                  ┌──────────────┐
                  │  docs node   │  ← pre-renders to disk, serves from disk
                  └──────┬───────┘
                         ▼
                  docs.xonly.ai
```

The node **pre-renders on publish and serves from disk**. It does not fetch from
relays at request time. A relay outage must never take the documentation down on
the morning somebody important visits — and a docs site that is slow because it
is doing relay round-trips per page view is an argument *against* the
architecture, made by us, in public.

The reconciliation job is what keeps this honest: it re-fetches every `docs/*`
address on a schedule, re-verifies the signature, and diffs against what is on
disk. A mismatch is a loud failure, not a silent fallback to the stale copy.

## Verifiability affordances the renderer MUST provide

Serving from cache is only defensible if the reader can check the cache. Every
rendered page carries:

- the **event id** and the `naddr` for the page
- the **relays** it was fetched from, and the timestamp of the last successful
  reconcile
- a **"verify this page"** link that resolves the event elsewhere, so the check
  does not depend on us

A cache with no way to audit it is just a website making claims.

## X Articles: three states, not two

Publishing to X Articles is a genuine showcase for **prose**. It is a bad fit for
**reference** material, because X Articles strips code blocks and monospace — and
while the image escape hatch can render code as a PNG, **a picture of code cannot
be copied**. Forcing it would be choosing the demo over the reader.

A binary flag forced a false choice, so `x_article` has three values:

| Value | Meaning | Pages |
|---|---|---|
| `full` | Paste as-is. Contains nothing X damages. | limits |
| `adapted` | An X variant is generated (below). | concepts, custody, identity, recovery, security |
| `none` | Node only. The page *is* its code. | start, sdk, node, verify |

### The adaptation

For an `adapted` page, the X variant is generated mechanically — never
hand-written, because two hand-maintained copies diverge and the public one is
the one that goes stale:

1. Each fenced code block is replaced by a link to its anchor on
   docs.xonly.ai — *"→ the derivation, in full"* rather than an unreadable,
   uncopyable screenshot.
2. Tables go through the PNG escape hatch with positional markers, since a table
   degrades to an image legibly and code does not.
3. A footer links back to the canonical page and to the `naddr`.

`check.mjs` enforces the invariants: a `full` page may not contain code or
images; an `adapted` page must actually have something to adapt (a wrong flag is
how a page silently stops being published); and an `adapted` page with code must
carry at least one internal link, or the generated X variant would dead-end.

The current warning — `limits` has tables but is marked `full` — is deliberate
and visible rather than silently downgraded.

## Editing workflow

1. Edit the markdown in `content/`.
2. Sign and publish the 30023 event (the author approves each one — the prompt
   names the page).
3. The node's publish webhook pre-renders and writes to disk.
4. Reconcile confirms disk matches relays.

Contributors who do not hold the project key open a pull request against
`content/`; a maintainer publishes. The event is the artifact, the repo is the
review surface, and the two are kept in sync by the reconcile job rather than by
good intentions.
