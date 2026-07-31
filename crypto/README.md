# @berm/crypto

Berm v2 identity primitives. Step 1 of the build sequence (spec §13).

Nothing else in the project is safe to build until `npm test` is green here, because everything downstream inherits these guarantees.

```bash
npm install
npm test          # 119 tests
npm run typecheck
npm run build
```

## What this module is

The derivation path from a WebAuthn PRF output to a Nostr identity, plus the conformance guards the rest of the codebase is checked against.

```
authenticator          ──► prf_out (32B, secret, hardware-bound)
  │                          │
  │ credential_id (public)   │
  └──────────┬───────────────┘
             ▼
   HKDF-SHA256(prf_out, "xnsb/v2/identity",
               "secp256k1|" || credential_id || "|" || counter, 32)
             │
             ▼  reject unless 0 < sk < n, else counter++
        secret key ──► pubkey ──► npub
```

The only secret input is `prf_out`. It is computed inside the authenticator and is not derivable from anything public. That single sentence is the entire difference between v2 and v1.

## What this module is not

It is not what mini-apps import. Mini-apps use `window.berm` (spec §5.4), which reaches the signer over NIP-46 and never exposes key material. This package is consumed by the signer origin only.

## Layout

| Path | Purpose |
|---|---|
| `src/derive.ts` | PRF → HKDF → validated scalar → identity |
| `src/webauthn.ts` | PRF enrolment and evaluation; backup-gated `enrol()` |
| `src/origin.ts` | Signer-origin guard, RP ID derivation |
| `src/event.ts` | NIP-01 serialization and IDs, kind register, `d`-tag guard |
| `src/nip39.ts` | X↔npub binding, three-state badge resolution |
| `src/quarantine/v1-broken.ts` | The v1 derivation, kept **only** so CI can prove it is broken |
| `vectors/test-vectors.json` | Frozen baseline |

## v2.1 — multi-device (`src/wrap.ts`)

v2.0 derived the identity key from PRF output, which is credential-bound — so a
second passkey produced a second **identity**, not a backup. Platform passkeys
sync within an ecosystem, which covers a broken phone but not an iPhone plus a
Windows PC.

The fix is additive:

```
credential #1   sk = HKDF(prf_out₁, …)                  <- unchanged, byte-identical
credential #2   wrapped₂ = AES-256-GCM(sk, kek₂)        kek₂ = HKDF(prf_out₂, wrap-salt)
```

Credential #1 still stores nothing, so "nothing to lose" survives. Every other
device unwraps the same key from a blob that is ciphertext — replicate it to the
signer origin, the node, a download, a relay. Losing a copy costs nothing.

The deterministic path is robust to **data** loss; the wrapped path is robust to
**device** loss. Together they cover both.

The registry deliberately **refuses** an unknown credential rather than deriving
a fresh identity, because silently forking a user into two npubs — neither aware
of the other — is the worst failure available here.

Note what removal does *not* do: the identity key is unchanged, so a kept copy
of a removed blob plus the removed authenticator still unwraps it. Genuine
revocation means rotating the key (v2.1 §3.2). The code says so rather than
implying a device was locked out.

## The vectors are frozen

`vectors/test-vectors.json` is a baseline, not a fixture. If a change makes `npm test` fail against it, the correct response is almost never to regenerate the file — a changed value means **every existing user's identity just changed**. Regenerate only as a deliberate, versioned migration.

All inputs are themselves SHA-256 of fixed strings, so anyone can rebuild the file from scratch and get identical bytes:

```bash
npm run vectors:generate && git diff --exit-code vectors/
```

## Vector coverage

| Vector | Asserts | Status |
|---|---|---|
| V1 | Derivation stability; distinct PRF and distinct credential each give distinct identities; purity | full |
| V2 | Scalar boundaries (0, 1, n−1, n, n+1, 0xff…, wrong length); counter-retry; no clamping; no mod-n reduction | full, with one documented substitution |
| V3 | NIP-01 canonical serialization and event ID for a kind 0 with two NIP-39 claims | full |
| V4 | NIP-44 v2 against the official cross-implementation vectors; round trip; tamper rejection; length padding | full |
| V5 | Origin guard rejects node origins and lookalikes; two origins → two RP IDs | partial — see below |
| V6 | The v1 derivation is reproducible by an attacker from public data; PIN falls to offline search; source-tree scans | full |
| V7 | Binding never renders `claimed` as `verified` | full |
| wrap | A second credential unwraps the SAME identity; wrong credential, tampered ciphertext, tampered nonce and swapped-npub blobs all rejected; unknown credentials refused rather than forked | full |

## Two honest gaps

**V2 substitution.** A natural counter-retry case cannot be constructed: `P(HKDF-SHA256 output ≥ n)` is below 2⁻¹²⁸. The retry branch is therefore exercised with an injected stub KDF, and that substitution is recorded in the vector file rather than left implicit. An untested branch that "can never happen" is how latent bugs survive.

**V5 is partial.** The real guarantee — that the same passkey cannot be used from a second origin — is enforced by the browser via the WebAuthn RP ID and cannot be tested in Node. What is unit-tested is our own half of the contract: the derivation path refuses to run anywhere except the configured signer origin. The browser half is in `scripts/e2e-checklist.md` and must be run manually on each target platform before release.

## The v1 quarantine

`src/quarantine/v1-broken.ts` contains the broken v1 derivation. It is not exported from `src/index.ts`, is excluded from the build via `tsconfig.json`, and is imported by exactly one file (`test/negative.test.ts`). CI asserts all three.

The tests there do not argue that v1 was broken — they compute it. `attackerRecoversV1Key('12345678')` takes nothing but a public integer and returns the same private key the victim would derive. A six-digit PIN falls to exhaustive offline search in about nine seconds on one CPU core, which is why that test is the slowest in the suite and worth every second of it.

## Dependency pinning

`nostr-tools ^2.24`, `@noble/hashes ^2.2`, `@noble/curves ^2.2`. A major bump to any of these invalidates the vectors and must re-run them before merge.

Two API details that bite:

- `@noble/hashes` v2 is ESM-only and **requires** the `.js` extension on subpath imports — `@noble/hashes/sha2.js`, not `@noble/hashes/sha2`. `sha256` was consolidated into `sha2`.
- `nostr-tools` v2 is asymmetric: `getPublicKey(sk: Uint8Array)` returns hex, `nip19.nsecEncode` takes **bytes**, `nip19.npubEncode` takes **hex**. Passing hex to `nsecEncode` throws at runtime.

The curve order is hardcoded rather than read from `@noble/curves`, because v2 of that library removed the `secp256k1.CURVE` property.

## License

MIT.
