# Berm v2 — live proof page

One self-contained HTML file. No CDN, no backend, no build step to view it.

```bash
npm install
npm run build     # -> dist/berm-live-proof.html
npm run serve     # -> http://localhost:8099  (passkey flow enabled here)
npm run verify    # headless end-to-end against two local verifying relays
```

Opening `dist/berm-live-proof.html` directly from disk works for everything
except the passkey flow — WebAuthn requires a secure context, and `file://`
is not one. The page detects this and says so rather than failing quietly.

## What it proves, in order

| Act | Claim | How a visitor checks it |
|---|---|---|
| I | The obvious design (hash the X ID into a key) is publicly forgeable | Type any X user ID. The "attacker" column is computed from that number alone. |
| II | An identity needs no seed phrase and no custodian | Create a passkey, sign in again, reload, sign in again. Same npub every time. |
| III | Content lands on infrastructure nobody here controls | Publish. Requires ≥2 acceptances from ≥2 relays, then fetches the event back over a fresh connection. |
| — | X is an attestation, not a credential | The NIP-39 proof is a post the visitor makes themselves. Three badge states, never conflated. |
| — | Nothing is hidden | Audit panel lists every input, recomputes the identity from the displayed values, and reports whether it matches. |

## Relay override

`?relays=ws://localhost:7447,ws://localhost:7448` points the page at your own
relays. Used by `npm run verify`; also useful for self-hosters.

## Honest notes

- **Software-key mode** exists so the tour runs over `file://` and on browsers
  without PRF. It is labelled amber wherever it appears. Production has no such
  fallback: a missing PRF routes the user to a NIP-07 extension or a NIP-46
  signer, never to a weaker key.
- **`npm run verify` uses local relays**, not public ones, so the test suite does
  not depend on third-party infrastructure or publish noise to the network. Each
  local relay verifies signatures independently with `nostr-tools`, and the run
  includes a negative control: a tampered event is rejected.
