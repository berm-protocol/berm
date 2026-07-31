# @berm/graph

Import an X follow graph without an X API, and show social proof without
learning who reads what.

```bash
npm install
npm test          # 24 unit assertions
npm run build     # dist/import.html — sealed, single file
npm run verify    # 24 browser assertions against a real server
npm run serve     # http://127.0.0.1:8120
```

## The four claims, and what "provable" means for each

| Claim | Enforced by | How you check it |
|---|---|---|
| The archive never leaves your device | **The browser** — `connect-src 'none'` | Read the header; watch a `fetch` fail |
| Your follow list leaks no member | **Cryptography** — NIP-44 v2 | Decrypt with the wrong key; grep the wire |
| The node cannot personalise | **Structure** — identical bytes | Diff two readers' responses |
| The code you ran is the code we published | Audit — SRI, pinned deps | Compare the script hash in the CSP |

Only the first three are guarantees. The fourth proves *"the code I audited is
the code I ran"*, which is not the same as *"the code is correct"*, and
conflating them is how projects overstate.

## Why the archive and not the API

Reading a following list from X needs a paid developer app plus the user's OAuth
token — a revocable permission that stops working at precisely the moment it
matters most, which is after a ban. The archive is the user's own data, already
in their hands, and nobody can take it back.

**What is actually in `following.js`:** numeric account IDs. No handles, no
display names. So it cannot be matched against handle-based NIP-39 claims
directly. The bridge is an `x_uid` tag on the identity attestation, **verified in
the same server-side fetch that upgrades `claimed` → `verified`** — the proof
post page carries the author's numeric id, so one fetch confirms both.

Only verified entries match. A self-asserted `x_uid` would let someone claim the
id of a popular account and be auto-followed by everyone who imports an archive.

Two verified claims on one account is a **dispute**, not a tie-break: both are
refused, because picking either silently auto-follows an impersonator.

## The cold start is arithmetic

```
expected matches ≈ followed × (claimants / active X accounts)
```

500 follows against 1,000 claimants gives **less than one**. The page says so, in
those words, rather than showing an empty box that reads as broken.

This works through **density** — adoption inside a community that already follows
each other — not through scale. That is a launch decision, not an engineering one.

## Private by default

A kind 3 contact list is public, permanent and plaintext. "Import my X follows"
published as kind 3 republishes a slice of the user's X social graph to open
relays forever. That is what kind 3 *is* — but nobody clicking an import button
is thinking it.

So the default is a **NIP-51 follow set (kind 30000) encrypted to yourself**. The
relay stores ciphertext. The widget still works, because decryption happens in
the reader's browser.

The two approval prompts are deliberately not symmetrical:

> Save a private follow list — encrypted so only you can read it. Relays store
> ciphertext; nobody else can see who you follow.

> **PUBLISH your follow list publicly and permanently — 7 new, 0 kept, 0 removed.**
> Anyone will be able to see who you follow.

The private one contains no publishing verb at all, and a test enforces that. A
user skimming two similar sentences acts on the first familiar word.

Publishing publicly also **merges** rather than replaces — kind 3 is replaceable,
and a naive publish silently destroys the existing Nostr graph of exactly the
early adopter you least want to annoy.

## The widget: why the node stays blind

Personalised social proof needs someone who knows both what you are reading and
who you follow. There are only three candidates, and two are bad:

```
relay knows    query {kinds:[7], authors:[...follows]} → it learns your graph
node knows     render per-reader → it learns both
your browser   already knew both
```

So the node embeds the article's **public reaction set** — identical for every
reader, fully cacheable — and the intersection runs client-side. The node already
knew you requested the page, so this adds **zero** information.

`renderArticle(article, reactions)` takes no reader argument. A test asserts
`renderArticle.length === 2`, so adding one to "improve" the widget fails loudly
instead of quietly killing the property.

## What is public regardless

Reactions, comments, reposts and bookmarks are **deliberate public acts**. There
is no read event, and there will not be one — a silent read-tracker inside a
data-sovereignty protocol is the one contradiction nobody would need to look for.

## Two bugs the tests caught

**The CSP blocked our own script.** `script-src 'self'` forbids inline scripts,
and this page is a single self-contained file. The fix is stricter, not looser:
the policy now names the script by SHA-256 hash. `'self'` permits any script from
the origin; a hash permits exactly one byte sequence.

**The direct-message guard was bypassable.** It lived inside the parsers, so a
filename the router did not recognise reached a "not used" branch and was never
checked. Intake is now the choke point, and a regression test covers it. A guard
that only runs on the paths you thought of is not a guard.
