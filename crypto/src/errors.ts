/**
 * Typed errors. Callers branch on these to route between custody tiers
 * (Berm v2 §3.1). A conforming client MUST NOT downgrade tiers silently,
 * so every downgrade path starts with an explicit error type here.
 */

export class XnsbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The authenticator or browser does not support the WebAuthn PRF extension.
 *  Caller MUST route to Tier 0 (NIP-07) or Tier 2 (NIP-46). It MUST NOT fall
 *  back to any weaker derivation. */
export class PrfUnsupportedError extends XnsbError {
  constructor(detail = 'WebAuthn PRF extension unavailable') {
    super(detail);
  }
}

/** PRF was advertised at registration but returned no value at assertion.
 *  Observed on some authenticators. Treated exactly like PrfUnsupportedError
 *  by callers, but distinguished so it can be reported separately. */
export class PrfAdvertisedButAbsentError extends PrfUnsupportedError {
  constructor() {
    super('Authenticator advertised PRF at create() but returned no value at get()');
  }
}

/** Code that must run only at the dedicated signer origin was loaded
 *  somewhere else. See Berm v2 §3.2.1 — key material must never be derivable
 *  at a node origin. */
export class WrongOriginError extends XnsbError {
  constructor(actual: string, expected: string) {
    super(
      `Key derivation attempted at origin "${actual}" but is permitted only at ` +
        `"${expected}". Nodes must request signatures over NIP-46, never derive keys.`,
    );
  }
}

/** HKDF produced no valid secp256k1 scalar within MAX_SCALAR_ATTEMPTS.
 *  Indicates a broken KDF, not bad luck. */
export class ScalarDerivationExhaustedError extends XnsbError {
  constructor(attempts: number) {
    super(`No valid secp256k1 scalar after ${attempts} attempts — KDF is faulty`);
  }
}

/** Enrolment cannot complete because the user has not secured a backup.
 *  PRF output is credential-bound: lose the passkey, lose the identity. */
export class BackupNotConfirmedError extends XnsbError {
  constructor() {
    super('Enrolment blocked: identity backup has not been confirmed (Berm v2 §3.2.3)');
  }
}

/** A NIP-39 identity claim was malformed or failed verification. */
export class BindingVerificationError extends XnsbError {}
