# NIP-39 amendment — PR-ready text

> Submit only after the discussion issue shows appetite **and** two independent
> clients implement it. Rule 1 of the NIPs README is not negotiable and a PR
> that arrives without it sits open.
>
> The text below is written to be appended to NIP-39. It changes nothing that
> exists. Do not include the rationale sections in the spec itself — they are
> here for the PR description.

---

## Proposed addition to NIP-39

### Durable claims

The `i` tag binds a pubkey to an external identity via a proof hosted on that
platform. Two properties of that binding weaken over time:

- for `github`, `twitter` and `mastodon` the identity is a **mutable handle**
  that can be released and re-registered by a different person, while `telegram`
  already binds to an immutable user ID;
- the proof is an artifact **the platform can delete**, which makes the claim
  unverifiable at precisely the moment the account is lost or suspended.

Two OPTIONAL tags address this. Both are additive. Clients that ignore them
behave exactly as before.

#### `i_id` — bind to the immutable account identifier

```
["i_id", "<platform>:<identity>", "<account-id>"]
```

The first element MUST exactly match the `i` tag it qualifies. `<account-id>` is
the platform's internal, immutable identifier for the account.

A verifier that resolves the proof SHOULD compare the proof author's account ID
to `<account-id>`.

- If they match, the claim is verified as normal.
- **If they differ, the claim MUST be treated as invalid, not merely
  unverified.** A mismatch is positive evidence that the handle changed hands;
  reporting it as "unverified" is indistinguishable from a network failure and
  would let a re-registered handle inherit the previous holder's badge.

For platforms whose identity is already immutable (`telegram`), `i_id` is
redundant and SHOULD be omitted.

#### `i_archive` — reference a third-party capture of the proof

```
["i_archive", "<platform>:<identity>", "<archive-url>", "<captured-at>"]
```

The first element MUST exactly match the `i` tag it qualifies. `<archive-url>`
points to a capture held by a party independent of both the claimant and the
platform. `<captured-at>` is the capture time in unix seconds **as reported by
the archive**, not as chosen by the event author.

Verifiers SHOULD prefer a live check. `i_archive` is consulted only when the
live proof cannot be retrieved.

**An archived proof demonstrates control at capture time. It does not
demonstrate control now.** These are different claims and clients MUST NOT
render them identically.

### Verification states

Clients that implement this SHOULD distinguish four states rather than two:

| State | Meaning | Suggested rendering |
|---|---|---|
| `unverified` | No proof retrieved | no badge |
| `verified` | Live proof retrieved and matched | badge |
| `expired` | Live proof unavailable; archived proof retrieved and matched | badge, visibly weaker, showing the capture date |
| `invalid` | `i_id` present and mismatched, or proof content does not match | no badge; SHOULD warn |

`invalid` MUST NOT be rendered as `unverified`.

### Event author responsibility

The `created_at` of a kind 0 event is chosen by its signer and is not evidence
of when a capture occurred. Verifiers MUST take `<captured-at>` from the archive
itself and SHOULD ignore it if the archive does not corroborate it.

### Example

```jsonc
{
  "kind": 0,
  "tags": [
    ["i", "twitter:alice", "1789456123456789012"],
    ["i_id", "twitter:alice", "1234567890"],
    ["i_archive", "twitter:alice",
      "https://web.archive.org/web/20260727224400/https://x.com/alice/status/1789456123456789012",
      "1785000240"],

    ["i", "github:alice", "e3ba5e1a4b2c..."],
    ["i_id", "github:alice", "583231"],

    ["i", "telegram:1087295163", "nostrdirectory/770"]
  ],
  "content": "{\"name\":\"alice\"}"
}
```

---

## Rationale (for the PR description, not the spec)

**Why not extend the `i` tag positionally.** Appending elements to `i` would
make the meaning of position 3 depend on the platform, and any client reading
`tag[2]` as the proof today would keep working only by accident. Separate tags
keyed by the same `<platform>:<identity>` string are unambiguous and trivially
ignorable.

**Why two tags rather than one.** They answer different questions — *is this
still the same account* and *can this still be checked* — and each is useful
without the other. A single combined tag would force claimants to supply both or
pad with empty elements.

**Why `invalid` is a distinct state.** This is the only part of the proposal
that lets a client say something new. Today a verifier that discovers a handle
changed hands has no way to express it, so a re-registered handle keeps the
badge until a human notices. Conflating that with a failed fetch is the bug.

**Why this generalises rather than invents.** NIP-39 already binds Telegram to
an immutable ID. This applies the same choice to the platforms where it was not
made, without breaking any existing claim.

**Scope deliberately excluded.** No archive service is mandated, no capture
mechanism is specified, and nothing requires a claimant to archive anything.
Both tags are optional and absence is not a signal.

---

## Rule 1 checklist

Do not open the PR until every box is ticked.

- [ ] Discussion issue posted and answered
- [ ] Client A implements verification with `i_id` and `i_archive`
- [ ] **Client B — a different project, different author — implements it**
- [ ] A relay is unaffected (no new kinds, no filter changes) — note this in the PR
- [ ] All four states render distinctly in both clients
- [ ] A test demonstrating the `invalid` case with a real re-registered handle
