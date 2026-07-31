# Manual e2e checklist — WebAuthn PRF

Node cannot exercise WebAuthn. Everything below has to be run by a human on real hardware, and it must pass on every target platform before a release ships. Unit tests cover everything downstream of `prf_out`; this file covers the part only a browser can prove.

Record results in the release PR. An unrecorded platform is an untested platform.

## Platform matrix

| Platform | Authenticator | PRF expected | Result |
|---|---|---|---|
| Chrome / Android | Google Password Manager | yes | |
| Chrome / macOS | iCloud Keychain | yes (Chrome 132+) | |
| Safari / macOS 15+ | iCloud Keychain | yes (Safari 18+) | |
| Safari / iOS 18.4+ | iCloud Keychain | yes | |
| Firefox / Windows 11 25H2 | Windows Hello | yes (Firefox 148+) | |
| Firefox / Android | — | **no** — must route to Tier 0/2 | |
| Chrome / Windows 11 | Windows Hello | yes (Chrome 147+) | |
| Any / hardware security key | FIDO2 with hmac-secret | varies | |

## E2E-1 — PRF availability is detected honestly

1. Enrol on a platform expected to support PRF. Confirm `prf.enabled === true` at `create()`.
2. Enrol on Firefox/Android. Confirm enrolment **aborts** with `PrfUnsupportedError` and the UI offers Tier 0 (NIP-07) or Tier 2 (NIP-46).
3. Confirm no code path produces an identity after a PRF failure. **A silent downgrade here is a release blocker.**

## E2E-2 — Determinism across devices

1. Enrol on device A. Record the `npub`.
2. Sign in on device B, same platform account, same synced passkey.
3. The `npub` **MUST** be byte-identical.
4. Repeat across browsers on the same OS where the passkey is shared.

This is the property that lets a user sign in on a new machine with nothing but their passkey. If it fails, the product promise fails.

## E2E-3 — RP-ID scoping (negative vector V5, browser half)

1. Serve the signer at `https://signer.<domain>`. Enrol. Record the `npub`.
2. Serve identical code at `https://other.<domain>`.
3. Attempt to use the credential from step 1 there.
4. The browser **MUST** refuse — the credential is not offered and `get()` finds no match.
5. Confirm our own guard fires first: `assertSignerOrigin` throws `WrongOriginError` before any WebAuthn call is made.

Step 4 is the browser's guarantee. Step 5 is ours. Both must hold; neither substitutes for the other.

## E2E-4 — Backup gate

1. Begin enrolment. At the backup step, dismiss/cancel.
2. Confirm enrolment does **not** complete and no credential record is persisted.
3. Complete enrolment properly with a downloaded encrypted keyfile.
4. Delete the passkey from the platform authenticator.
5. Recover the identity from the keyfile alone. The `npub` **MUST** match.

Step 5 is the one people skip. It is the difference between "sovereign" and "sovereign until you change phone vendors."

## E2E-5 — No key egress

1. Open devtools, Network tab, before enrolment.
2. Enrol and sign an event.
3. Confirm **zero** requests carry `prf_out`, the secret key, or the nsec.
4. Confirm the CSP `connect-src` allowlist contains only relay WSS endpoints.
5. Confirm a CSP violation is reported if the page attempts any other connection.

This is the check a suspicious user will run themselves. It has to survive that.

## E2E-6 — Tier fallback

1. With a NIP-07 extension installed, confirm Tier 0 is selected and the signer origin is never contacted.
2. With the signer origin blocked at DNS, confirm the app routes to Tier 2 and remains fully functional.
3. Confirm no operation anywhere in the product requires Tier 1.

If any feature breaks in step 3, the "the protocol survives if Berm disappears" claim is false and must be corrected in the docs or in the code — not left ambiguous.

## E2E-7 — Multiple credentials

1. Enrol twice on the same device. Confirm two distinct `npub`s.
2. Confirm the UI forces an explicit choice of active identity and never picks silently.
3. Confirm the credential registry survives a page reload.
