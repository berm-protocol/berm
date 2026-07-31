# PRF hardware check

The one layer in Berm that unit tests cannot reach. Everything else is covered
by the 97 tests in `crypto/`; this needs a human and a real authenticator.

```bash
npm install
npm run build
npm run serve
```

Then open **http://localhost:8102** and press *Run the checks*.

## What it runs

| Check | Proves |
|---|---|
| Environment | Secure context, WebAuthn present, platform authenticator available |
| E2E-1 | The authenticator reports `prf.enabled === true` at registration |
| E2E-1b | PRF actually returns 32 bytes at assertion, and the **production** derivation turns them into a valid identity |
| E2E-2 | Two evaluations produce the identical npub |
| E2E-2b | Same npub after a full page reload |
| E2E-3 | A credential from one RP ID is **refused** at another |
| E2E-5 | Manual: no request carries key material |

It imports `@berm/crypto` directly, so what runs here is the shipping code path,
not a re-implementation.

## The RP-ID scoping trick

A WebAuthn RP ID is the **hostname**, so `localhost` and `127.0.0.1` are
different relying parties even on the same port. `npm run serve` binds `0.0.0.0`
so the page is reachable at both, which reproduces the cross-origin case with no
deployment.

localStorage is origin-scoped too — the same principle under test — so the
credential id travels in the link's URL fragment. Fragments are never sent to a
server, so this stays entirely local.

Create a credential at one hostname, follow the link at the top of the page, and
press *Test RP-ID scoping* at the other. **The browser must refuse.** That
refusal is the empirical basis for Berm v2 §3.2.1: a per-site passkey would mean
a per-site identity, which is why custody has to live at a single signer origin.

## A failure is a result

If PRF is unsupported, that is a legitimate finding, not a broken run. The
correct product behaviour is to route the user to a NIP-07 extension or a NIP-46
signer — never to a weaker derivation. Record the platform and move on.

Export the JSON and attach it to the release record. An unrecorded platform is
an untested platform.

## Verified headlessly

`node verify.mjs` runs the whole harness against a Chromium virtual
authenticator with `hasPrf: true` via CDP. All checks pass there, including the
cross-origin refusal (`SecurityError: This is an invalid domain.`). That proves
the harness works; it does **not** substitute for real hardware, because the
point of the exercise is the authenticators people actually own.
