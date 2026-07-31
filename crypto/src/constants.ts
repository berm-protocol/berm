/**
 * Berm v2 — fixed protocol constants.
 *
 * Every value here is PUBLIC by design. None of them is a secret, and the
 * security of the system does not depend on any of them being unknown.
 * That is the whole point of the v2 redesign: in v1 a public salt was combined
 * with a public X user ID and the result was treated as a private key. Here,
 * public constants are combined with hardware-bound PRF output that is NOT
 * public and NOT derivable from anything public.
 */

/** secp256k1 group order.
 *
 *  Hardcoded deliberately rather than read from @noble/curves: v2 of that
 *  library removed the `secp256k1.CURVE` property (the v2 equivalent is
 *  `secp256k1.Point.Fn.ORDER`). Pinning the literal keeps this module
 *  version-proof and makes the boundary test vectors exact.
 */
export const SECP256K1_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/**
 * WHY THESE STILL SAY `xnsb`.
 *
 * The protocol was renamed from XNSB to Berm. These three strings were NOT
 * renamed with it, deliberately.
 *
 * They are **derivation inputs**, not labels. Every identity key is
 * `HKDF(prf_out, salt, info)`, so changing a salt by one byte produces an
 * entirely different key for every existing user — a silent, total, unrecoverable
 * migration. That is the whole reason the vectors in `crypto/vectors/` are frozen.
 *
 * They are also invisible: no user, and no other implementer reading an event,
 * ever sees them. They are opaque domain separators whose only job is to be
 * globally unique and never change. `xnsb/v2/…` does that job perfectly well, and
 * renaming them would be churn against the one property they exist to have.
 *
 * The `berm:` d-tag namespaces DID move, because those appear in published event
 * JSON that other implementers read. Visible strings follow the name; invisible
 * ones stay put. If a future v3 changes derivation for a real reason, that is the
 * moment to also change these — as a versioned migration, never as tidying.
 */

/** Salt passed to the WebAuthn PRF extension (`eval.first`).
 *  Scopes the authenticator's PRF output to identity use. Changing this
 *  string changes every user's identity — frozen for the life of v2. See above. */
export const PRF_SALT_IDENTITY = 'xnsb/v2/prf/identity';

/** HKDF salt for the identity key. Frozen for the life of v2. See above. */
export const HKDF_SALT_IDENTITY = 'xnsb/v2/identity';

/** HKDF info prefix. The full info string is
 *  `secp256k1|` || credentialId || `|` || counter  — see derive.ts */
export const HKDF_INFO_PREFIX = 'secp256k1|';

/** Maximum counter increments while searching for a valid secp256k1 scalar.
 *  P(single draw invalid) < 2^-128, so exhausting 256 draws has probability
 *  below 2^-32768. Reaching the limit means the KDF is broken, not unlucky. */
export const MAX_SCALAR_ATTEMPTS = 256;

/** Addressable-event `d` tag namespace form: berm:<namespace>:<version> */
export const D_TAG_PATTERN = /^berm:[a-z0-9-]+(?::[a-z0-9-]+)*:v?\d+$/;

/** NIP-39 proof text that must appear verbatim in the user's post.
 *  Defined by NIP-39; Berm does not get to choose it. */
export function nip39ProofText(npub: string): string {
  return `Verifying my account on nostr My Public Key: "${npub}"`;
}

/* NOTE: the list of forbidden source literals (the v1 salt, the deprecated
 * NIP-04 module) deliberately lives in test/negative.test.ts, not here.
 * Defining it in src/ would plant the very strings the scanner searches for. */
