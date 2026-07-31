# @berm/sdk

The `window.berm` surface. User-held identity for apps that on-ramp users from X.

```bash
npm install          # deps
npm test             # 34 tests
npm run bundle       # dist/berm-sdk.global.js + .esm.js (+ .min)
npm run example      # http://127.0.0.1:8110
```

## The pitch, and its limits

Building on X today means holding a **revocable permission**: an API key, a
developer app, a rate limit, a policy page that can change on a Tuesday. Every
dead Twitter client died that way.

An app built on this SDK holds **no X credential at all**. The identity is a key
the user holds; the X handle is a claim the user published and archived. There
is nothing for a policy change to take away, because nothing was issued.

Three things this does **not** give you, stated here rather than discovered later:

- **Distribution.** X still decides who sees your links. Sovereignty keeps your
  users after a policy change; it does not get you the audience.
- **Writing into X.** Posting to X — Articles included — needs X's API and stays
  revocable. Read and identity are sovereign; writes to X are borrowed.
- **A sovereign tier 1.** The protocol is sovereign. The passkey tier — the
  default onboarding path — is not: WebAuthn binds each credential to an RP ID
  derived from the signer origin, so whoever controls that DNS name can obtain
  the identity key of every tier-1 user who authenticates afterwards. No break-in
  required; a lapse or a transfer does it. Tiers 0 and 2 have no such dependency.
  Details and the fix in [Custody tiers](../docs/content/custody.md#what-tier-1-costs).

All three belong in your pitch. A developer who discovers any of them in
production will not build a second thing with you.

## Ten minutes

```html
<script src="berm-sdk.global.js"></script>
<script>
  const sdk = Berm.install({ dev: true });          // tier 0/1/2; dev on localhost only

  connect.onclick = async () => {
    const s = await sdk.connect();                  // may prompt, may be declined
    console.log(s.npub, s.tier, s.custody);
  };

  publish.onclick = async () => {
    const ev = await sdk.signEvent({
      kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'hello',
    });
    const receipt = await sdk.publish(ev);          // ≥2 relays, or it did not publish
    console.log(receipt.success, receipt.accepted);
  };
</script>
```

That is the whole integration. `examples/hello.html` is this plus styling, and
`npm run example:verify` drives it in a real browser against two local relays.

## Custody tiers

`connect()` picks the first available, in this order:

| Tier | What holds the key | Exclusivity depends on | Status |
|---|---|---|---|
| 0 | A NIP-07 browser extension the user already had | the extension vendor | works today |
| 1 | Berm passkey signer at a dedicated origin | **the signer DNS name, indefinitely** | client done, signer origin not deployed |
| 2 | A NIP-46 bunker the user runs | hardware the user holds | works today |
| — | Development key in `localStorage` | nothing | localhost only, refuses elsewhere |

**Tier 0 comes first on purpose.** A user with an extension already made a
custody decision before they met us. Overriding it to push our own signer is the
behaviour we claim to be an alternative to.

**Tier 1 is an on-ramp, not a destination.** Prompt the user to export their key
and tell them what the export is for. Export means they can never be locked out;
it does not mean they stay the only signer. Those are different properties and
only the first is solved today.

**Never fall back between tiers after connecting.** If a signer breaks, offer a
retry. Do not quietly re-sign the user into weaker custody they did not choose.

`detect()` returns what is available and *why* the rest are not — show that on a
connect screen instead of one button that fails invisibly.

## Four decisions worth knowing about

**One relay is not published.** `receipt.success` is true only at two or more
acceptances (Berm v2 §4.4). A single relay is a single point of failure wearing
the costume of a success message. The full per-relay breakdown is in the
receipt; publishing is not atomic and the API refuses to pretend it is.

**Relay responses are verified here, not by you.** A relay is an untrusted party
that can return whatever it likes. `query()` checks every signature and drops
what fails. The test suite proves it against a relay that deliberately serves a
forgery — otherwise the check is an assumption, not a fact.

**A claim is never rendered as verified.** A NIP-39 `i` tag is a self-assertion;
anyone can write one. `profile.ts` therefore *cannot* produce `verified` — a
browser has no CORS-open way to check a proof post against X, and the upgrade is
a node's job (v2 §3.5). Making the optimistic value impossible to construct is
the cheapest way to never ship an impersonation bug.

**The dev signer refuses to run in production.** It keeps a raw key in
`localStorage`. Off localhost it throws `DevSignerMisuseError` rather than
warning — every dev mode that merely warns eventually ships, and this one leaks a
private key when it does.

## Errors you must handle

| Error | What it means | What to do |
|---|---|---|
| `UserDeclinedError` | The user said no | Return to the previous state, silently. Not a red banner. |
| `SignerUnavailableError` | Signer offline, asleep, or popup-blocked | Offer a retry |
| `NoSignerError` | Nothing can sign in this browser | Show onboarding — every new user starts here |
| `DevSignerMisuseError` | Dev signer outside localhost | You shipped it. Remove it. |

Extension and bunker declines are normalised into `UserDeclinedError`, so you
branch on a type instead of on somebody else's copywriting.

## Approval prompts

`describeForApproval()` turns an event into a sentence naming its consequence:

```
Publish your recovery guardians — 3 named publicly, 2 needed to vouch for a new key
```

not `Save application data (berm:recovery:v1)`. A signer that says "sign this?"
without saying what "this" is has trained the user to click yes. Adding a kind?
Add a line there rather than inventing your own vocabulary.

## Verifying the build

`npm run bundle` prints a SHA-256 and an SRI hash for every artifact and writes
`.sha256` files alongside them. The project's claim is that everything is public
and verifiable; a script tag nobody can check is not that.

```html
<script src="berm-sdk.global.min.js"
        integrity="sha256-…" crossorigin="anonymous"></script>
```

| Build | Raw | Gzip |
|---|---|---|
| `berm-sdk.global.js` | 299 KB | 73 KB |
| `berm-sdk.global.min.js` | 144 KB | 51 KB |

Most of that is `nostr-tools` and `@noble/*`. The unminified build is shipped
deliberately — someone about to grant a script a signing surface should be able
to read it.

## What is not here yet

- The tier-1 **signer origin** itself. The client half is complete
  (`backends/berm-signer.ts`); the deployed origin is not.
- **NIP-98** HTTP auth, for logging in to services with this identity.
- A **React/Vue** wrapper. The surface is small enough that one is not urgent.

## License

MIT.
