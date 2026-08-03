<div align="center">

# Berm

**X as the on-ramp. Not the custodian.**

User-held identity for apps that welcome users from X — with no API key, no
developer app, and nothing anyone can revoke.

*The protocol is sovereign. The default passkey tier is
[not, and we say why](https://docs.xonly.ai/custody#what-tier-1-costs).*

[The story](https://docs.xonly.ai/why) · [Docs](https://docs.xonly.ai) ·
[Quickstart](https://docs.xonly.ai/start) · [Security](SECURITY.md) ·
[Limits](https://docs.xonly.ai/limits)

</div>

---

In fortification, a **berm** is the strip of level ground at the foot of a wall —
not inside it, not out in the open field. Close enough to the wall to matter, and
outside it enough to be yours. That is the whole idea;
[why](https://docs.xonly.ai/why) is the long version.

> **Berm** is the protocol. **XOnly** (`xonly.ai`) is where it is hosted,
> documented and improved. Anyone can implement Berm without touching either.

## The inversion

Almost every app that uses X as a login treats X as the **custodian**: the
account *is* the identity, so when the account dies the user dies with it.
People who signed up to something years ago with an X account they have since
lost are simply gone — not locked out, gone, with no path back anyone can offer.

```
conventional        the identity IS the X account
                    X can revoke it, therefore X owns your users

Berm                the identity is a key the user holds
                    the X handle is a CLAIM attached to it
                    X can revoke the claim; the identity is untouched
```

An app built on this holds **no X credential at all**. There is nothing for a
policy change to take away, because nothing was issued.

## Ten minutes

```html
<script src="berm-sdk.global.min.js" integrity="sha256-…" crossorigin></script>
<script>
  const sdk = Berm.install({ signer: { signerOrigin: 'https://signer.xonly.ai' } });

  const session = await sdk.connect();            // may prompt, may be declined
  const event   = await sdk.signEvent({ kind: 1, created_at: now(), tags: [], content: 'hello' });
  const receipt = await sdk.publish(event);       // ≥2 relays, or it did not publish
</script>
```

That is the whole integration. No registration, no key to obtain, no quota.

## What is here

**The protocol**

| Directory | | Checked by |
|---|---|---|
| [`crypto/`](crypto) | Identity derivation from WebAuthn PRF, frozen vectors, the v1 quarantine | 119 tests |
| [`sdk/`](sdk) | `window.berm` — four backends, one interface | 34 tests + browser E2E |
| [`spec/`](spec) | The normative document. MUST / SHOULD / MUST NOT | — |
| [`nips/`](nips) | Drafts for `nostr-protocol/nips` | discussion stage |
| [`chain/`](chain) | Optional anchor that makes hosts disposable — and never a required lookup | 23 tests + 32 EVM checks |

**Things a user touches**

| Directory | | Checked by |
|---|---|---|
| [`post/`](post) | Composer for X — weighted counting, refuses rather than truncates, hash-committed cards | 68 tests + 44 browser checks |
| [`editor/`](editor) | Long-form editor, three publish targets, tables and art X cannot render | browser E2E |
| [`landing/`](landing) | Where a card click lands. Verified / unverified / mismatch, fetched live | 89 tests + 31 browser checks |
| [`link/`](link) | Handle claim → proof post → third-party archive | browser E2E |
| [`recovery/`](recovery) | *"If you lost this device right now, what would happen?"* | browser E2E |
| [`explorer/`](explorer) | `/who` — resolve any identity, see what is actually proven | browser E2E |
| [`graph/`](graph) | X archive import, encrypted follow sets, reader-blind social proof | 24 tests + 24 browser assertions |

**Things an operator runs**

| Directory | | Checked by |
|---|---|---|
| [`wordpress/`](wordpress) | The node. Pure-PHP BIP-340 — no GMP, no BCMath, any shared host | 15 official vectors |
| [`node-pages/`](node-pages) | A node publishes only what it verified, and refuses to truncate | 18 tests + 17 relay checks |
| [`signer-log/`](signer-log) | Build attestations, so a swapped signer is detectable | 20 tests |
| [`bags/`](bags) | Fee continuity for Bags launches, and the dispute screen that is the point of it | 83 tests + 26 browser checks |
| [`docs/`](docs) | Published as signed Nostr events, through the protocol it documents | conformance-checked |

## Verify it yourself

```bash
node scripts/verify-all.mjs --fast    # unit suites, ~1 min
node scripts/verify-all.mjs           # everything, needs Chromium
```

Twenty-two groups, one entry point. CI calls exactly this command — a pipeline
with its own command list goes green while the repo is broken.

Every claim on the docs site has a command behind it. A few worth running:

```bash
cd crypto && npm run vectors:generate && git diff --exit-code vectors/
```
Rebuilds the frozen identity vectors from scratch. Every input is itself the
SHA-256 of a fixed public string, so anyone gets identical bytes. A non-empty
diff means a derivation changed — which means every existing identity changed.

```bash
cd crypto && npm test -- negative
```
Computes a victim's private key from public data using the **v1** derivation we
shipped and then killed, and brute-forces a six-digit PIN in about nine seconds.
It does not argue that v1 was broken. It computes it.

```bash
cd chain && npm run verify
```
Compiles the anchor contract, disassembles the **bytecode** — not the source — to
prove there is no owner, no upgrade path and no `SELFDESTRUCT`, then deploys it
into a real EVM and tries to take it over.

## Four decisions worth knowing about

**One relay is not published.** `receipt.success` is true only at two or more
acceptances. A single relay is a single point of failure wearing the costume of
a success message.

**Relay responses are verified in the SDK, not by you.** A relay is an untrusted
party that can return anything. The test proving forged events are dropped first
proves the hostile relay really sent one — otherwise it would pass because
nothing happened.

**A claim can never render as verified.** A NIP-39 `i` tag is a self-assertion.
`profile.ts` is structurally incapable of producing `verified`, because a
browser has no CORS-open way to check a proof post. Only a node can upgrade it.

**The dev signer refuses to run in production.** It throws off localhost rather
than warning. Every dev mode that merely warns eventually ships, and this one
leaks a private key when it does.

## What this does not do

- **The default tier is not sovereign.** WebAuthn binds credentials to an RP ID
  derived from the signer origin, so whoever controls that DNS name can obtain the
  identity key of every tier-1 user who authenticates afterwards — no break-in
  required. Tiers 0 and 2 have no such dependency, and the protocol runs with the
  tier-1 signer permanently gone. Full statement in
  [custody](https://docs.xonly.ai/custody#what-tier-1-costs).
- **Sovereignty is not distribution.** X cannot touch your users or your data.
  X absolutely controls whether anyone sees you.
- **Writing into X is still borrowed.** Publishing an X Article needs X's API and
  stays revocable. Design it as a feature that degrades, not a dependency.
- **The anchor is deployed nowhere.** `chain/` compiles, executes and is
  adversarially tested, but no chain has been chosen and no address exists.
- **A lost key with no backup is gone.** Permanently. No reset, no support queue.
  That is the cost of nobody being able to seize it.

Full list: [docs/limits](https://docs.xonly.ai/limits).

## License

MIT. See [CONTRIBUTING.md](CONTRIBUTING.md) to get started and
[SECURITY.md](SECURITY.md) before reporting anything sensitive.
