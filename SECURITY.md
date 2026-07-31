# Security

## Reporting

**Do not open a public issue for an unpublished vulnerability.**

Email `security@xonly.ai` — PGP key at `https://xonly.ai/.well-known/pgp-key.txt`.
Include what you did, what happened, and what you expected. A proof of concept
helps enormously; a working exploit is not required.

You will get an acknowledgement within 72 hours. If you do not, assume the email
failed and reach the maintainers any way you can rather than staying quiet.

Anything already public — a broken link, a failing test, a design disagreement —
belongs in a normal issue.

## What we will do

Publish the finding and the fix, including when the finding is ours. The v1
derivation in `crypto/src/quarantine/` is a design we shipped, discovered was
catastrophically broken, and killed — it is still in the repository, still
tested, and documented in `docs/content/security.md`. That is the standard.

Credit is given unless you ask us not to.

## Scope

**In scope, and taken seriously:**

- Any path by which a private key leaves the signer origin
- Any way a `claimed` external identity can render as `verified`
- Forged or replayed events accepted as valid
- Key derivation reproducible from public data
- Node code that receives, derives, or persists key material
- The dev signer loading on a non-local origin
- A follow list leaking members a user believed were private
- An article page whose bytes differ per reader

**Explicitly out of scope**, and stated so nobody wastes their time:

- Malware on the user's device with DOM access at the signer origin
- A compromised authenticator
- A global passive adversary correlating traffic across relays
- Relay operators seeing published events — that is what publishing means
- The fact that lost keys are unrecoverable. That is the design.

## The domain is a security control, not an administrative detail

**T9 — loss or transfer of `xonly.ai`.**

WebAuthn binds every credential to an RP ID derived from the signer origin. If
`xonly.ai` ever lapses and is re-registered, whoever holds it can serve a page at
`signer.xonly.ai`, and browsers will offer users' existing passkeys to it. That
yields the PRF output, and therefore **the identity key of every tier-1 user**.

An expired domain is not an outage here. It is a complete compromise of every
identity derived at that origin, executed by someone who only had to pay a
registration fee.

Consequences, treated as security requirements rather than office admin:

- The domain is registered **as many years forward as the registry permits**,
  with auto-renew on. A lapse must not be possible through inattention.
- The registrar account carries **hardware 2FA**, and registrar lock stays on.
  Registry lock is enabled where offered.
- Expiry is **monitored and alerted on**, independently of registrar email —
  registrar renewal notices go to an address that may itself have moved.
- The registrar account is as critical as the GitHub org and the npm scope. All
  three are single points of total compromise, and none of them are code.

There is no cryptographic mitigation. The signer origin cannot be changed after
users enrol without invalidating every credential, so the only defence is not
losing the name.

## Known limitations

Documented rather than discovered:

**WebAuthn origin binding is enforced by the browser, not by us.** That a passkey
cannot be invoked from a second origin is the RP-ID guarantee, and it cannot be
unit-tested in Node. Our half — that derivation refuses to run outside the
configured signer origin — is tested. The browser half is a manual per-platform
checklist run before each release. We call that coverage **partial** because it is.

**Guardian rotation is social consensus, not key recovery.** Compromising the
threshold number of guardians is a real attack on identity continuity. It is why
the mechanism must never gate anything of value.

**Removing a credential is not revocation.** The identity key is unchanged, so a
retained wrapped blob plus the removed authenticator still unwraps it. Genuine
revocation means rotating the key.

## Supply chain

The published security model reduces to one question: *was this artifact built
from the code you read?*

- No CDN. Nothing loads from an origin the project does not serve.
- Dependencies are pinned. A major bump to `nostr-tools`, `@noble/hashes` or
  `@noble/curves` invalidates the test vectors and must re-run them before merge.
- Every browser build publishes a SHA-256 and an SRI hash.
- npm releases carry [provenance attestations](https://docs.npmjs.com/generating-provenance-statements)
  binding each package to the commit and workflow that built it.
- `scripts/check-supply-chain.mjs` runs in CI and fails the build on an external
  origin, a NIP-04 reference, a committed key, or the v1 quarantine reaching a
  path that could produce a real identity.

**If you find a published artifact whose hash does not match this repository,
treat it as a compromise and report it immediately.**

## Cryptography

- **secp256k1 / BIP-340 Schnorr** for signatures
- **HKDF-SHA256** with domain-separated salts for derivation
- **NIP-44 v2** for encryption. **NIP-04 is prohibited repo-wide, including in
  tests**, and CI enforces it
- **AES-256-GCM** via WebCrypto for key wrapping
- **WebAuthn PRF** as the only secret entropy source for tier-1 identities

We have not commissioned a third-party audit. When we do, the report will be
published in full, including anything it finds.
