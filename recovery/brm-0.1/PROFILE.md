# Berm Recovery Module — Launch Edition 0.1

Profile/file identifier: `berm.recovery_module/0.1`. This is a public description
of the existing Xonly implementation, not a new file generation or signing API.
Its exact read-only source identities are in [IMPLEMENTATION.json](IMPLEMENTATION.json).
The current external-account method remains `berm.external_account_binding.x/2`.

## Meaning and custody

A **Berm Recovery Module (BRM)** is an encrypted, user-owned portable recovery
file. The `.brm` plus its recovery password restores the same Berm/Nostr identity
and the same BRM-derived default EVM destination on another device. The private
root is NIP-49 encrypted; the npub, public key and EVM address are public metadata,
not encrypted fields. Keep the recovery file private and its password separately.
Berm, Xonly and BermLaunch do not need plaintext-root server custody for recovery.
There is no server reset that recreates a lost sovereign root or its password.

One secp256k1 root controls the Nostr identity and the default EVM account; there
is no unrelated second EVM private key. The Nostr key is the BIP-340 x-only public
key encoded as npub. The EVM address is the final 20 bytes of Keccak-256 of the
uncompressed secp256k1 public key without its 04 prefix, rendered lowercase 0x hex.
Recover the exact encrypted root; do not substitute a differently normalized
scalar based only on the x-only public key. Such a substitution can change the
EVM address even when an x-only identity appears equivalent.

## Closed file grammar

[schema.json](schema.json) uses JSON Schema draft 07. All five object levels are
closed: top-level, identity, recovery, derived and derived.evm. Required keys:

- Top-level: schema, created_at, identity, recovery, derived.
- identity: npub, pubkey_hex.
- recovery: format, ncryptsec.
- derived: evm; derived.evm: address.

`schema` is exactly `berm.recovery_module/0.1`; `recovery.format` is exactly
`nip49`. `pubkey_hex` is 64 lowercase hex characters; address is 0x followed by 40
lowercase hex characters. The accepted parser's initial npub test is only the
string prefix `npub1`. Its ncryptsec syntax is exactly
`^ncryptsec1[023456789acdefghjklmnpqrstuvwxyz]+$`. These are structural checks,
not bech32 checksum or successful decryption checks. Patterns retain the accepted
JavaScript regular-expression semantics; cryptographic recovery remains mandatory.

`created_at` must be a string accepted by `Number.isFinite(Date.parse(value))`.
The schema's custom format `brm-js-date` MUST be registered with that predicate
and format assertions enabled. Standard `format: date-time` is not equivalent:
the existing parser accepts strings such as `2026`. An engine that ignores the
custom format has performed only incomplete structural checking, not profile
conformance. Non-JavaScript implementations must match the accepted Date.parse
semantics or report that conformance is unavailable; do not silently tighten or
broaden the file contract. Writers should use the existing ISO timestamp output.

[shape-example.json](shape-example.json) and [shape-vectors.json](shape-vectors.json)
contain synthetic non-decryptable data. A structural PASS is never a usable BRM
or recovered identity. JSON/schema validation alone does not prove root/public-
metadata equality. Do not add confirmation, balances or application fields.

## Actual recovery and confirmation

Recovery parses the closed file, decrypts ncryptsec with the password, derives
npub, public-key hex and EVM address from the recovered root, and compares all
three exactly with the stored public metadata. Bad password, malformed encrypted
payload or mismatched metadata refuses. The file's public metadata is not trusted
merely because it is valid JSON.

Created/exported and recovery-confirmed are distinct states.
`BRM_RECOVERY_CONFIRMED` means the supplied BRM decrypted successfully and
rederived the same identity and EVM destination as the current live vault. The
existing UI accepts either supplied file text or the in-memory BRM text; this
state does NOT prove the user saved a file or reopened a downloaded copy. It adds
no upload, mandatory file-reselection or new step to the accepted user flow.
The confirmation is local/session state, not a new portable `.brm` field. The
generated-destination enrollment path retains its existing explicit destination
confirmation and matching session/recovery-confirmation checks.

An existing unlocked Berm/NIP-49 identity can be wrapped/re-encrypted into BRM
without changing its root or npub. This is identity preservation, not rotation.
Session invalidation continues to cancel stale pending enrollment authority.

## Application and destination boundaries

The BRM is private recovery material. Public X binding evidence is a separate
export of signed claims, observations, authorizations, policies and receipts.
BRM does not prove X identity, application membership, a campaign position or
financial entitlement. It does not store X proof archives, application receipts,
campaign history, balances or financial claims. Those must be rediscovered or
reconstructed from their own authenticated records after identity recovery.

BRM is optional for destination choice. BermLaunch's existing BYO flow lets a
user declare another EVM destination; this is not proof of control and the
external wallet's secret is not put into BRM. No WalletConnect, EIP-191 wallet
ownership proof or new enrollment version is introduced by this profile.

The existing local Advanced action, “Export generated EVM account”, exposes the
same secret controlling the Berm identity. It requires explicit warning and
confirmation and must remain local-only, never logged, uploaded or included in
receipts. It is not a generic signing API.

## Launch Edition limits

BRM 0.1 is not a generic wallet, token browser, swap UI, WalletConnect replacement,
generic Nostr/EVM signer, passkey system or controller graph. It contains no
Solana/Zcash keys, external-wallet seeds, OAuth or cloud-provider credentials.
Automatic cloud sync is not part of this profile. Broader ecosystem recovery,
passkey and guardian descriptions are separate capabilities, not BRM 0.1 fields.
Future recovery modules must not be advertised as implemented here.

No `/3`, R14 or “Berm Protocol v8” is created. The existing 97 vectors, five-minute
half-open observation window, signature/canonicalization rules, identity
cardinality and application-policy semantics remain unchanged.

## Run conformance locally

From the repository root with Node 22.6+:

```sh
npm ci --prefix recovery/brm-0.1 --no-audit --no-fund
node --test recovery/brm-0.1/test.mjs
node docs/build.mjs
node scripts/check-brm-docs.mjs
node scripts/verify-all.mjs
```

The first installs the locked development-only schema validator. Subsequent BRM
checks use synthetic data with no network, keys or signatures. The full existing
repository gate additionally uses its locked packages, Chromium and PHP; it must
not be replaced by a partial BRM-only run. Generated public docs must state the
same boundaries and must not imply a structural example proves decryption.
