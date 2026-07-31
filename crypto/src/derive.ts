/**
 * Berm v2 §3.2.2 — key derivation.
 *
 *   prf_out  := WebAuthn PRF eval.first    (32 bytes, hardware-bound, secret)
 *   sk_i     := HKDF-SHA256(prf_out, "xnsb/v2/identity",
 *                           "secp256k1|" || credential_id || "|" || i, 32)
 *   accept sk_i iff 0 < int(sk_i) < n
 *
 * The ONLY secret input is `prf_out`. It is computed inside the authenticator
 * and cannot be derived from any public value. Contrast v1, where the sole
 * input was the user's public X ID — see src/quarantine/v1-broken.ts.
 */

import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { getPublicKey, nip19 } from 'nostr-tools';

import {
  SECP256K1_ORDER,
  HKDF_SALT_IDENTITY,
  HKDF_INFO_PREFIX,
  MAX_SCALAR_ATTEMPTS,
} from './constants.js';
import { ScalarDerivationExhaustedError } from './errors.js';

const enc = new TextEncoder();

export interface Identity {
  /** 32-byte secret key. Never leaves the signer origin. */
  readonly secretKey: Uint8Array;
  /** 64-char lowercase hex x-only public key. */
  readonly pubkeyHex: string;
  /** NIP-19 bech32 public key. */
  readonly npub: string;
  /** NIP-19 bech32 secret key. Shown once, at enrolment, for backup. */
  readonly nsec: string;
  /** Counter value that produced a valid scalar. Almost always 0. */
  readonly attempt: number;
}

/** Pluggable KDF, so the counter-retry branch is reachable in tests without
 *  needing a ~2^-128 event. Production always uses `hkdfSha256`. */
export type Kdf = (
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
) => Uint8Array;

export const hkdfSha256: Kdf = (ikm, salt, info, length) =>
  hkdf(sha256, ikm, salt, info, length);

/**
 * Is `bytes` a valid secp256k1 secret key?
 * Valid iff 0 < int(bytes) < n. Note that both endpoints are excluded:
 * zero has no inverse, and n is congruent to zero.
 */
export function isValidScalar(bytes: Uint8Array): boolean {
  if (bytes.length !== 32) return false;
  const v = BigInt('0x' + bytesToHex(bytes));
  return v > 0n && v < SECP256K1_ORDER;
}

/** Build the HKDF info string for a given credential and counter. */
export function buildInfo(credentialId: Uint8Array, counter: number): Uint8Array {
  if (!Number.isInteger(counter) || counter < 0 || counter > 255) {
    throw new RangeError(`counter must be a uint8, got ${counter}`);
  }
  const prefix = enc.encode(HKDF_INFO_PREFIX);
  const sep = enc.encode('|');
  const out = new Uint8Array(prefix.length + credentialId.length + sep.length + 1);
  let o = 0;
  out.set(prefix, o); o += prefix.length;
  out.set(credentialId, o); o += credentialId.length;
  out.set(sep, o); o += sep.length;
  out[o] = counter;
  return out;
}

/**
 * Derive a validated secp256k1 secret key from PRF output.
 *
 * Deterministic: the same (prfOut, credentialId) always yields the same key,
 * on every device and in every browser. That determinism is what lets a user
 * log in from a new machine with nothing but their synced passkey.
 */
export function deriveSecretKey(
  prfOut: Uint8Array,
  credentialId: Uint8Array,
  kdf: Kdf = hkdfSha256,
): { secretKey: Uint8Array; attempt: number } {
  if (prfOut.length !== 32) {
    throw new RangeError(`PRF output must be 32 bytes, got ${prfOut.length}`);
  }
  if (credentialId.length === 0) {
    throw new RangeError('credentialId must not be empty');
  }

  const salt = enc.encode(HKDF_SALT_IDENTITY);

  for (let i = 0; i < MAX_SCALAR_ATTEMPTS; i++) {
    const sk = kdf(prfOut, salt, buildInfo(credentialId, i), 32);
    if (isValidScalar(sk)) return { secretKey: sk, attempt: i };
    // Invalid scalar: advance the counter and re-derive. MUST NOT clamp,
    // MUST NOT reduce mod n — either would bias the key distribution.
  }
  throw new ScalarDerivationExhaustedError(MAX_SCALAR_ATTEMPTS);
}

/**
 * Full identity from PRF output.
 *
 * nostr-tools v2 API asymmetry, which is a common source of runtime errors:
 *   getPublicKey(sk: Uint8Array)    -> hex string
 *   nip19.nsecEncode(sk: Uint8Array) -> takes BYTES
 *   nip19.npubEncode(pk: string)     -> takes HEX
 */
export function identityFromPrf(
  prfOut: Uint8Array,
  credentialId: Uint8Array,
  kdf: Kdf = hkdfSha256,
): Identity {
  const { secretKey, attempt } = deriveSecretKey(prfOut, credentialId, kdf);
  const pubkeyHex = getPublicKey(secretKey);
  return {
    secretKey,
    pubkeyHex,
    npub: nip19.npubEncode(pubkeyHex),
    nsec: nip19.nsecEncode(secretKey),
    attempt,
  };
}
