---
d: docs/identity
title: Identity and X
summary: How a handle becomes a claim, why the proof must be archived, and what happens the day the account dies.
t: [berm, identity, x]
nav: 5
x_article: adapted
---

# Identity and X

X is on the **authentication** path and never on the **correctness** path. Every
design decision here follows from that sentence, and the test for any proposed
feature is whether it survives X saying no.

## The two-way binding

A link between an npub and an X handle is only meaningful if it is asserted from
both sides. One side alone is a claim about someone else.

**Nostr → X.** A NIP-39 `i` tag in the user's kind 0 profile:

```json
["i", "twitter:dorian", "https://x.com/dorian/status/1789456123456789012"]
```

**X → Nostr.** A post from that account naming the npub:

```
Verifying my Nostr identity:
npub1fn27skur6m05z747px3epnlclf8etedhahky9zxrwxad8gll2lmstnpsey
```

Neither half is sufficient. Anyone can put any handle in their own profile;
anyone can post any npub. Together, and only together, they demonstrate that the
same person controls both.

## Three states, never two

| State | Means | Render as |
|---|---|---|
| `unlinked` | No claim | nothing |
| `claimed` | Asserted, unchecked | "claimed" — visibly weaker |
| `verified` | Proof post fetched and matched | a badge |

Collapsing `claimed` into `verified` is the single most damaging bug this
project could ship, because it converts "anyone can say anything" into "the
system says so". The codebase is built so it cannot happen by accident:

- The **SDK cannot produce `verified`**. A browser has no CORS-open way to fetch
  a post from X, so the optimistic value is unconstructible client-side.
- Only a **node** upgrades the state, server-side, after actually fetching and
  matching the proof.
- A test asserts a signed, valid, well-formed profile claiming `@elonmusk`
  still resolves to `claimed`.

## Archive the proof, or you have nothing

This is the part people skip, and it is the part that matters.

Your proof post lives on X. If the account is suspended, deleted, or renamed,
the post disappears — **at exactly the moment somebody else holds that handle
and is claiming to be you**. The evidence evaporates precisely when it is needed.

So the flow includes a third step: capture the proof post to a third-party
archive with no stake in any future dispute, and publish an attestation
recording it.

```
kind 30078, d = berm:archive:v1
  ["u",       "https://x.com/dorian/status/1789456123456789012"]
  ["archive", "https://web.archive.org/web/20260727224400/https://x.com/…"]
  ["ts",      "1785000240"]
```

It takes about a minute and needs no credentials. It is the difference between
"I used to have that account" and a timestamped snapshot held by a neutral party.

**A caution about timestamps.** An event's `created_at` is chosen by whoever
signs it and is not evidence of when anything happened. For priority claims that
have to withstand a hostile reading, anchor to something you do not control —
the archive capture time, or an OpenTimestamps proof.

## When the X account dies

The whole architecture exists for this paragraph.

1. **Sign in with your key.** It never depended on X. Your content, your
   followers, your app access and your published work are all untouched.
2. **Post a fresh proof** from the new account, and archive it.
3. **Publish an updated profile: new claim in, dead claim OUT.**

Step 3 matters more than step 2. Abandoned handles get re-registered, and a
stale claim leaves your profile pointing at a stranger who now holds that name.
Removing the old claim is the security-relevant action; adding the new one is
merely convenient.

What you lose is a badge. What you keep is everything else.

## NIP-05 as an anchor

A NIP-05 address (`_@xonly.ai` via `/.well-known/nostr.json`) is a second,
independent anchor — useful because it is controlled by DNS rather than by X.
It requires CORS to be open on that endpoint, and it fails safe: an unreachable
NIP-05 means "unverified", never "verified".

## Rotation, and its honest limit

If a key is lost, no cryptography can move an identity to a new one. What can
work is **social consensus**: guardians named in advance who attest that a new
key is the same person.

Two constraints, stated plainly because a guarantee that gets overstated is a
liability:

- The pre-commitment must be **anchored before the loss**. It cannot be added at
  the moment you would want it.
- It works only because relying parties **choose** to honour it. Nobody holds a
  share of your key. This is a social mechanism wearing cryptographic clothes,
  and it should be described that way to users.

See [Recovery](docs/recovery).
