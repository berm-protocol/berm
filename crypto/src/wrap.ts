/**
 * Berm v2.1 §1 — key wrapping for multi-device.
 *
 * THE PROBLEM THIS FIXES: v2.0 derives the identity key from PRF output, which
 * is credential-bound. So enrolling a second passkey produced a second
 * IDENTITY, not a backup — there was no way to add a device. Platform passkeys
 * sync within an ecosystem, which covers a broken phone but not the case most
 * people actually live in: an iPhone and a Windows PC.
 *
 * THE SHAPE: credential #1 stays deterministic and byte-identical to v2.0, so
 * the "nothing stored, nothing to lose" property survives and no existing
 * identity moves. Every ADDITIONAL credential wraps the same key.
 *
 *     credential #1   sk = HKDF(prf_out₁, …)          ← unchanged
 *     credential #2   wrapped₂ = AES-GCM(sk, kek₂)    kek₂ = HKDF(prf_out₂, wrap-salt)
 *
 * Wrapped blobs are ciphertext and useless without an authenticator, so they can
 * be replicated anywhere — signer origin, the user's node, a downloaded file,
 * even a relay. Copy them widely; losing one costs nothing. That is the whole
 * point: the deterministic path is robust to DATA loss, the wrapped path is
 * robust to DEVICE loss, and together they cover both.
 *
 * AES-256-GCM via WebCrypto: authenticated, no new dependency, and present in
 * every browser and in Node 18+.
 */

import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { getPublicKey, nip19 } from 'nostr-tools';
import { isValidScalar } from './derive.js';

/** Distinct from the identity salt, so a wrapping key can never collide with
 *  an identity key even if the same PRF output reached both. */
/** HKDF salt for key wrapping. Frozen with the identity salts — see
 *  constants.ts for why the rename to Berm deliberately did not touch these. */
export const HKDF_SALT_WRAP = 'xnsb/v2/wrap';
const KEK_INFO_PREFIX = 'kek|';

export const WRAP_ALG = 'AES-256-GCM';
const NONCE_BYTES = 12;

export interface WrappedKey {
  v: 1;
  /** Which credential can unwrap this blob. */
  credential_id: string;
  alg: typeof WRAP_ALG;
  nonce: string;
  /** 32-byte key plus 16-byte GCM tag. */
  ct: string;
  /** So a device can confirm it unwrapped the identity it expected, before
   *  using it. Public; leaks nothing. */
  npub: string;
  created_at: number;
}

export class WrapError extends Error {
  constructor(msg: string) { super(msg); this.name = 'WrapError'; }
}

/** The blob was not encrypted for this credential, or has been tampered with.
 *  GCM cannot distinguish the two, and neither should a caller. */
export class UnwrapFailedError extends WrapError {
  constructor() {
    super('Could not unwrap: wrong credential, or the blob has been altered');
  }
}

/* ------------------------------------------------------------------ */

const enc = new TextEncoder();

function hexToBytes(h: string): Uint8Array {
  const m = h.match(/../g);
  if (!m || m.length * 2 !== h.length) throw new WrapError(`malformed hex (${h.length} chars)`);
  return Uint8Array.from(m.map((b) => parseInt(b, 16)));
}

/** Fresh ArrayBuffer-backed view — WebCrypto's BufferSource will not accept
 *  a SharedArrayBuffer-backed one, and TS 5.7+ types plain Uint8Array as
 *  possibly shared. */
function buf(u8: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(u8.length));
  out.set(u8);
  return out;
}

/**
 * Derive the key-encryption key for a credential.
 *
 * Same construction as the identity derivation, different salt and info. Reusing
 * the identity salt here would mean a credential's KEK and its identity key were
 * related — harmless today, and exactly the kind of coupling that becomes a
 * finding in an audit.
 */
export function deriveKek(prfOut: Uint8Array, credentialId: Uint8Array): Uint8Array {
  if (prfOut.length !== 32) {
    throw new RangeError(`PRF output must be 32 bytes, got ${prfOut.length}`);
  }
  if (credentialId.length === 0) throw new RangeError('credentialId must not be empty');

  const info = new Uint8Array([...enc.encode(KEK_INFO_PREFIX), ...credentialId]);
  return hkdf(sha256, prfOut, enc.encode(HKDF_SALT_WRAP), info, 32);
}

async function importKek(kek: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', buf(kek), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/**
 * Wrap an identity key for an additional credential.
 *
 * @param secretKey  the identity key — the SAME one across every device
 * @param prfOut     PRF output from the credential being enrolled
 */
export async function wrapKey(
  secretKey: Uint8Array,
  prfOut: Uint8Array,
  credentialId: Uint8Array,
): Promise<WrappedKey> {
  if (secretKey.length !== 32) throw new RangeError('secret key must be 32 bytes');
  if (!isValidScalar(secretKey)) {
    // Wrapping an invalid scalar would produce a blob that unwraps cleanly and
    // then fails at signing time, which is a miserable thing to debug.
    throw new WrapError('refusing to wrap an invalid secp256k1 scalar');
  }

  const kek = await importKek(deriveKek(prfOut, credentialId));
  const nonce = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(NONCE_BYTES)));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, kek, buf(secretKey)),
  );

  return {
    v: 1,
    credential_id: bytesToHex(credentialId),
    alg: WRAP_ALG,
    nonce: bytesToHex(nonce),
    ct: bytesToHex(ct),
    npub: nip19.npubEncode(getPublicKey(secretKey)),
    created_at: Math.floor(Date.now() / 1000),
  };
}

/**
 * Unwrap an identity key with a credential's PRF output.
 *
 * Throws UnwrapFailedError when the blob was encrypted for a different
 * credential OR has been altered — GCM cannot tell those apart, and reporting
 * them separately would leak which one it was.
 */
export async function unwrapKey(blob: WrappedKey, prfOut: Uint8Array): Promise<Uint8Array> {
  if (blob.v !== 1) throw new WrapError(`unsupported blob version ${blob.v}`);
  if (blob.alg !== WRAP_ALG) throw new WrapError(`unsupported algorithm ${blob.alg}`);

  const credentialId = hexToBytes(blob.credential_id);
  const kek = await importKek(deriveKek(prfOut, credentialId));

  let plain: Uint8Array;
  try {
    plain = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: buf(hexToBytes(blob.nonce)) },
        kek,
        buf(hexToBytes(blob.ct)),
      ),
    );
  } catch {
    throw new UnwrapFailedError();
  }

  if (plain.length !== 32 || !isValidScalar(plain)) {
    throw new WrapError('unwrapped bytes are not a valid secp256k1 scalar');
  }

  // The blob names the identity it holds. If the key inside does not match, the
  // blob has been swapped for another user's — authentic, but not ours.
  const actual = nip19.npubEncode(getPublicKey(plain));
  if (blob.npub && actual !== blob.npub) {
    throw new WrapError(`blob claims ${blob.npub} but contains ${actual}`);
  }

  return plain;
}

/* ------------------------------------------------------------------ */
/* Credential registry                                                 */
/* ------------------------------------------------------------------ */

export interface RegisteredCredential {
  credential_id: string;
  /** The first credential derives deterministically and stores no blob. */
  kind: 'primary' | 'wrapped';
  label?: string;
  added_at: number;
}

export interface IdentityRegistry {
  npub: string;
  credentials: RegisteredCredential[];
  wrapped: WrappedKey[];
}

/**
 * Resolve an identity from whichever credential is present.
 *
 * `derivePrimary` is supplied by the caller so this module stays free of the
 * WebAuthn plumbing and remains testable.
 */
export async function unlock(
  registry: IdentityRegistry,
  credentialId: Uint8Array,
  prfOut: Uint8Array,
  derivePrimary: (prf: Uint8Array, cred: Uint8Array) => Uint8Array,
): Promise<Uint8Array> {
  const idHex = bytesToHex(credentialId);
  const record = registry.credentials.find((c) => c.credential_id === idHex);

  if (!record) {
    // Deriving a fresh identity here would silently fork the user in two:
    // same person, two npubs, neither aware of the other. Enrol instead.
    throw new WrapError(
      'Unknown credential. Enrol it as an additional device rather than creating a new identity.',
    );
  }

  if (record.kind === 'primary') {
    const sk = derivePrimary(prfOut, credentialId);
    const actual = nip19.npubEncode(getPublicKey(sk));
    if (actual !== registry.npub) {
      throw new WrapError(`primary credential derived ${actual}, expected ${registry.npub}`);
    }
    return sk;
  }

  const blob = registry.wrapped.find((w) => w.credential_id === idHex);
  if (!blob) throw new WrapError('credential is registered but its wrapped key is missing');
  return unwrapKey(blob, prfOut);
}

/** Enrol an additional credential against an already-unlocked identity. */
export async function addCredential(
  registry: IdentityRegistry,
  secretKey: Uint8Array,
  credentialId: Uint8Array,
  prfOut: Uint8Array,
  label?: string,
): Promise<IdentityRegistry> {
  const idHex = bytesToHex(credentialId);
  if (registry.credentials.some((c) => c.credential_id === idHex)) {
    throw new WrapError('credential is already enrolled');
  }

  const blob = await wrapKey(secretKey, prfOut, credentialId);
  if (blob.npub !== registry.npub) {
    throw new WrapError('refusing to enrol: key does not match this identity');
  }

  return {
    npub: registry.npub,
    credentials: [
      ...registry.credentials,
      { credential_id: idHex, kind: 'wrapped', label, added_at: blob.created_at },
    ],
    wrapped: [...registry.wrapped, blob],
  };
}

/**
 * Remove a credential.
 *
 * Note what this does NOT do: the identity key is unchanged, so a copy of the
 * removed blob plus the removed authenticator still unwraps it. Genuine
 * revocation requires rotating to a new key (v2.1 §3.2). Say so plainly rather
 * than implying a device has been locked out.
 */
export function removeCredential(registry: IdentityRegistry, credentialId: string): IdentityRegistry {
  const remaining = registry.credentials.filter((c) => c.credential_id !== credentialId);
  if (!remaining.some((c) => c.kind === 'primary') && remaining.length === 0) {
    throw new WrapError('refusing to remove the last credential — the identity would be unreachable');
  }
  return {
    npub: registry.npub,
    credentials: remaining,
    wrapped: registry.wrapped.filter((w) => w.credential_id !== credentialId),
  };
}
