# /who — identity lookup

Type an X handle, find out which Nostr identity legitimately claims it, and see
the evidence.

```bash
npm install
npm run build      # -> dist/who.html   (one self-contained file)
npm run serve      # -> http://localhost:8104
npm run verify     # seeds a conflict on local relays and checks the ranking
```

`?handle=dorian` preloads a lookup. `?relays=ws://…` overrides the relay set.

## Why it exists

The anti-impersonation claim is worthless without somewhere to check it.
Etherscan's real product was never the data — it was being *the place everyone
looks*.

## The rule it enforces

**`created_at` proves nothing.** Any key can sign an event dated 2009. Most
Nostr tooling renders that field as if it were a fact, which is exactly how a
squatter wins an argument they should lose.

So priority comes from an **external anchor** — an OpenTimestamps proof placing
the claim at a Bitcoin block height nobody can backdate. Unanchored claims are
still shown, but they can never outrank an anchored one. And if *nothing* is
anchored, the page refuses to name a winner rather than guessing.

**Handles recycle; numeric X ids never do.** A claim bound only to a handle
cannot tell the original owner from whoever registered it after the account was
deleted. Missing account id is called out as a caveat on every row.

## Three things that make it a lens rather than an authority

1. **It verifies.** Every signature is re-checked in the browser before a pixel
   is drawn. A relay serving a forged event cannot get it onto the page — and
   the relay list shows which relay tried.
2. **It shows conflicts.** Competing claims appear side by side with their
   anchors and their caveats. Hiding a conflict is how an explorer becomes a
   trusted single point of failure.
3. **It admits what it hasn't checked.** Full OpenTimestamps verification needs
   a Bitcoin chain source, and pulling one from a public API would quietly
   reintroduce a trusted third party into the one place that must not have one.
   So anchors are marked `anchor present, not checked here` and linked out.
   Saying "unverified" is not a weakness; claiming otherwise would be.

## Layering

| Where | What | Why |
|---|---|---|
| kind 0, NIP-39 `i` tag | the interoperable claim | Damus and Amethyst render it without knowing XOnly exists |
| kind 30078, `d=berm:identity:v1` | account id, anchor, snapshot, witness | XOnly-specific evidence, kept out of the standard event |

Standards where standards exist, extensions where they don't, and no pollution
of the former by the latter.

## The test

`npm run verify` seeds two identities claiming `@dorian` on two local relays:

- **the owner** — anchored, account id recorded, proof post archived to Wayback
- **the squatter** — profile back-dated six years to 2019, no anchor, no id,
  no snapshot

The back-dating buys nothing. The owner ranks first, the squatter is demoted
with three explicit caveats, and the page says why. That is the whole product in
one screenshot.

The test relay in `local-relay.mjs` implements real NIP-01 filter matching —
kinds, authors, since/until, limit and `#<single-letter>` tags. A relay that
ignored unknown filter keys would return everything and make a broken `#i` query
look like a working one.

## Next: campaigns

[`CAMPAIGN-EXPLORER-SPEC.md`](CAMPAIGN-EXPLORER-SPEC.md) extends the same rule
from identity to cohort rosters — every committed payout destination shown with
whether control of it was actually proven, and the campaign root recomputed in
the browser rather than asserted.

## Not built yet

- Full OTS verification (needs a chain source; currently linked out)
- The aggregating indexer for network-wide lookups — relay `#i` indexing
  coverage is uneven, so a real deployment needs one
- `/p/npub…`, `/e/<id>`, `/a/<naddr>` — the rest of the explorer
- Live proof-post fetching (needs API or a human clicking through)
