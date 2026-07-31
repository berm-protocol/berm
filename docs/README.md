# docs.xonly.ai — content

Ten pages, written to be published as signed Nostr events. See
[PUBLISHING.md](PUBLISHING.md) for how a page becomes an event and what the node
is allowed to cache.

```bash
node check.mjs      # frontmatter, unique d tags, dead links, X Article rules
```

## Pages

| # | Slug | For | X Article |
|---|---|---|---|
| 1 | `docs/start` | Ship something in ten minutes | none |
| 2 | `docs/concepts` | The inversion, in five minutes | adapted |
| 3 | `docs/custody` | Where the key lives | adapted |
| 4 | `docs/sdk` | Full API reference | none |
| 5 | `docs/identity` | Handle → claim → archived proof | adapted |
| 6 | `docs/recovery` | What to hold, before you need it | adapted |
| 7 | `docs/node` | Running one, and its trust boundary | none |
| 8 | `docs/security` | Threat model, and the design we killed | adapted |
| 9 | `docs/limits` | What this does not do | full |
| 10 | `docs/verify` | Every claim, and the command that checks it | none |

Roughly 7,000 words. Short on purpose — a developer decides in the first
screen, and pages nobody finishes are pages nobody acts on.

## Editorial rules

These are not style preferences. They are the reason the docs are worth
publishing at all.

**Name the limit in the same breath as the claim.** "Sovereignty keeps your
users after a policy change; it does not get you the audience." A developer who
finds a boundary in production does not build a second thing with you.

**Never let a guarantee inflate.** Guardian rotation is social consensus, not key
recovery. WebAuthn origin binding is enforced by the browser, and our coverage of
it is *partial*. Both are said plainly, in the docs, where it costs us something.

**Show the failure, do not describe it.** The security page does not argue the
first design was broken; it points at a test that recovers the key and a PIN
search that finishes in nine seconds.

**Every claim has a command.** `docs/verify` exists so that nothing on this site
has to be taken on trust — including the part where we say the docs themselves
are published through the protocol.

## Not written yet

The **pitch site** (xonly.ai) is separate from this and is the other audience:
a senior X manager and a data-sovereignty organisation, not a developer. Some
material here transfers — the inversion, the failure cases, the limits — but the
framing does not. That page argues; these pages instruct.
