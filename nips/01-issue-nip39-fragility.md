# Discussion issue — post to nostr-protocol/nips

> Title: **NIP-39 claims break in the one case they exist for**
>
> Post as an issue, not a PR. Nothing below names a project. If nobody else
> feels this pain, the right outcome is that no NIP gets written.

---

NIP-39 lets a profile claim an external identity, and clients render a badge
from it. That badge is doing real work — it is how a reader decides that an
npub is the person they already follow somewhere else.

There are two failure modes that I think make the badge unsafe in exactly the
situation it exists to handle, and I would like to know whether others have hit
them.

## 1. Most platforms are identified by a mutable handle

NIP-39 already treats this inconsistently:

| Platform | Identity is | Mutable? |
|---|---|---|
| GitHub | username | yes |
| Twitter | username | yes |
| Mastodon | `<instance>/@<username>` | yes |
| **Telegram** | **user ID** | **no** |

Telegram binds to the immutable numeric ID. The other three bind to a name that
can be released and re-registered by someone else.

So: I claim `twitter:alice`, prove it, get a badge. I abandon the account. Three
months later somebody else registers `alice`. My profile — unchanged, still
signed by me, still rendering a green badge in every client — now asserts a link
to a stranger's account.

Nothing in the protocol detects this, and the stale claim is most dangerous
precisely when it is most likely: after someone leaves or loses a platform.

## 2. The proof is a platform artifact, so the platform can delete it

The proof is a gist, a tweet, a toot. If the account is suspended, deleted, or
the post is removed, verification stops being possible.

Note when that happens: at the exact moment somebody else may be holding the
name and claiming to be you. The evidence evaporates when it is needed, and
there is no way to distinguish "this was never true" from "this was true and the
platform removed the receipt."

Right now a verifier can only return *verified* or *unverified*, so a claim that
was genuinely proven for years silently degrades to the same state as one that
was never proven at all.

## What I think would fix it

Two optional tags, both additive, neither changing the `i` tag:

- an **immutable account ID** alongside the handle, so a verifier can detect
  that the handle now belongs to someone else — generalising what NIP-39
  already does for Telegram;
- an **archive reference** to a third-party capture of the proof, so a claim can
  still be evaluated after the platform artifact is gone — as a *distinct and
  weaker* state, never as equivalent to a live check.

The second point is the one I would most like input on. An archived proof
demonstrates control **at capture time**, not now. That is genuinely useful and
genuinely not the same claim, and I do not think clients should be free to
collapse the two.

## Questions before anyone writes a spec

1. Has this bitten you? Handle recycling on GitHub and Mastodon should hit the
   same way — I have only measured it on one platform.
2. Is the ID/handle split worth generalising, or is Telegram's treatment
   deliberately special?
3. Should a verifier that finds an ID mismatch report **invalid**, or merely
   *unverified*? I lean invalid — a mismatch is positive evidence of a broken
   binding, not absence of evidence — but that is a stronger claim than NIP-39
   currently allows anyone to make.
4. Does an archived proof deserve a distinct badge state, or is that a client
   concern that does not belong in a NIP at all?

Happy to write this up and implement it if there is appetite. Equally happy to
be told the handle problem is rarer than I think.
