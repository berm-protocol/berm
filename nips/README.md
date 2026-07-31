# Contributions to nostr-protocol/nips

Three documents, in the order they should be used. Nothing here is ready to
submit today, and the reason is rule 1.

| # | File | What it is | Status |
|---|---|---|---|
| 1 | `01-issue-nip39-fragility.md` | Discussion issue — post first | ready to post |
| 2 | `02-nip39-amendment.md` | PR-ready spec + rationale | **blocked on rule 1** |
| 3 | `03-nip-guardians-draft.md` | Second proposal, later | blocked on #2 landing |

## The five rules, from the NIPs README

1. **Fully implemented in at least two clients and one relay**
2. They should make sense
3. Optional and backwards-compatible
4. **No more than one way of doing the same thing**
5. Other rules will be made up when necessary

Rule 1 is the gate. Rule 4 is what kills proposals that look like a project
trying to standardise itself.

## Where we actually stand on rule 1

Honestly: **not met, and not close.**

The editor, the link flow and the recovery page are three clients on paper and
one project in practice. That satisfies the letter and not the spirit, and a
reviewer will say so. What is needed is a *different author* implementing it —
which makes the real work a conversation with another client developer, not more
writing.

The good news is that neither proposal touches relay behaviour. No new filters,
and for the NIP-39 amendment no new kinds at all — so "one relay" is satisfied
by any relay, and the PR should say that plainly rather than leaving a reviewer
to work it out.

## Why the NIP-39 amendment goes first

It is the only proposal here that **is not about us.**

It fixes a weakness every NIP-39 implementer already has: handles are mutable
and proofs are deletable, so a badge can silently come to point at a stranger
who re-registered an abandoned name. The fix generalises a choice NIP-39 already
made for Telegram — which binds to an immutable user ID while GitHub, Twitter
and Mastodon bind to a mutable handle.

That framing matters more than the content. A first contribution that
generalises an existing decision reads as participation; one that introduces a
project's architecture reads as a vendor spec.

## What we should never propose

Everything the project stores under kind 30078 with a `d` namespace —
`berm:identity:v1`, `berm:archive:v1`, `berm:recovery:v1`, `berm:graph:v1`.

NIP-78 exists precisely so applications can define their own data without asking
anyone. Those namespaces are already correct. Proposing them as NIPs would be
asking permission we do not need and advertising that we do not understand the
mechanism we are using.

## Tone

Terse. Normative language. No project name in any spec text. Working code linked
rather than described. If a sentence explains why the project is good rather
than what an implementer must do, cut it.

The payoff for getting this right is out of proportion to the work: a merged NIP
is third-party evidence that the ecosystem wanted something we built, and it is
the first thing a data-sovereignty organisation will look for.
