/**
 * v2.1 §1 — key wrapping.
 *
 * The property that matters: a second credential unwraps the SAME identity.
 * v2.0 gave you a second identity instead, which is the bug this closes.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes, bytesToHex } from '@noble/hashes/utils.js';
import { getPublicKey, nip19 } from 'nostr-tools';

import { identityFromPrf, deriveSecretKey, isValidScalar } from '../src/derive.js';
import {
  wrapKey, unwrapKey, deriveKek, unlock, addCredential, removeCredential,
  WrapError, UnwrapFailedError, HKDF_SALT_WRAP,
  type IdentityRegistry,
} from '../src/wrap.js';
import { HKDF_SALT_IDENTITY } from '../src/constants.js';

const fixed = (l: string) => sha256(utf8ToBytes(l));
// Seeds stay `xnsb/…` after the rename to Berm — same rule as the generator and
// the salts. These determine every key asserted below; renaming them moves the
// expected values under an unchanged function, which is a test rewriting itself
// rather than a test.
const PRF_A = fixed('xnsb/test/prf/A');
const PRF_B = fixed('xnsb/test/prf/B');
const PRF_C = fixed('xnsb/test/prf/C');
const CRED_A = fixed('xnsb/test/cred/A').slice(0, 16);
const CRED_B = fixed('xnsb/test/cred/B').slice(0, 16);
const CRED_C = fixed('xnsb/test/cred/C').slice(0, 16);

const primary = (prf: Uint8Array, cred: Uint8Array) => deriveSecretKey(prf, cred).secretKey;

describe('the bug v2.1 closes', () => {
  it('v2.0 behaviour: a second credential produced a DIFFERENT identity', () => {
    const one = identityFromPrf(PRF_A, CRED_A);
    const two = identityFromPrf(PRF_B, CRED_B);
    expect(one.npub).not.toBe(two.npub);
    // Correct for what it does, and useless as a backup — hence wrapping.
  });

  it('v2.1: a wrapped second credential unwraps the SAME identity', async () => {
    const id = identityFromPrf(PRF_A, CRED_A);
    const blob = await wrapKey(id.secretKey, PRF_B, CRED_B);
    const recovered = await unwrapKey(blob, PRF_B);
    expect(bytesToHex(recovered)).toBe(bytesToHex(id.secretKey));
    expect(nip19.npubEncode(getPublicKey(recovered))).toBe(id.npub);
  });
});

describe('key separation', () => {
  it('the wrap salt differs from the identity salt', () => {
    expect(HKDF_SALT_WRAP).not.toBe(HKDF_SALT_IDENTITY);
  });

  it('a KEK is never equal to the identity key from the same PRF', () => {
    const kek = deriveKek(PRF_A, CRED_A);
    const sk = primary(PRF_A, CRED_A);
    expect(bytesToHex(kek)).not.toBe(bytesToHex(sk));
  });

  it('different credentials give different KEKs', () => {
    expect(bytesToHex(deriveKek(PRF_A, CRED_A))).not.toBe(bytesToHex(deriveKek(PRF_A, CRED_B)));
  });

  it('different PRF outputs give different KEKs', () => {
    expect(bytesToHex(deriveKek(PRF_A, CRED_A))).not.toBe(bytesToHex(deriveKek(PRF_B, CRED_A)));
  });
});

describe('wrapping', () => {
  it('is non-deterministic — a fresh nonce every time', async () => {
    const id = identityFromPrf(PRF_A, CRED_A);
    const a = await wrapKey(id.secretKey, PRF_B, CRED_B);
    const b = await wrapKey(id.secretKey, PRF_B, CRED_B);
    expect(a.ct).not.toBe(b.ct);
    expect(a.nonce).not.toBe(b.nonce);
    // ...and both still unwrap to the same key.
    expect(bytesToHex(await unwrapKey(a, PRF_B))).toBe(bytesToHex(await unwrapKey(b, PRF_B)));
  });

  it('records the identity it holds', async () => {
    const id = identityFromPrf(PRF_A, CRED_A);
    const blob = await wrapKey(id.secretKey, PRF_B, CRED_B);
    expect(blob.npub).toBe(id.npub);
    expect(blob.alg).toBe('AES-256-GCM');
    expect(blob.nonce).toMatch(/^[0-9a-f]{24}$/);      // 12 bytes
    expect(blob.ct).toMatch(/^[0-9a-f]{96}$/);          // 32-byte key + 16-byte tag
  });

  it('refuses to wrap an invalid scalar', async () => {
    await expect(wrapKey(new Uint8Array(32), PRF_B, CRED_B)).rejects.toThrow(WrapError);
  });
});

describe('unwrapping — negative cases', () => {
  it('rejects the WRONG credential', async () => {
    const id = identityFromPrf(PRF_A, CRED_A);
    const blob = await wrapKey(id.secretKey, PRF_B, CRED_B);
    await expect(unwrapKey(blob, PRF_C)).rejects.toThrow(UnwrapFailedError);
  });

  it('rejects a tampered ciphertext — GCM is authenticated', async () => {
    const id = identityFromPrf(PRF_A, CRED_A);
    const blob = await wrapKey(id.secretKey, PRF_B, CRED_B);
    const flipped = blob.ct.slice(0, -2) + (blob.ct.slice(-2) === '00' ? '11' : '00');
    await expect(unwrapKey({ ...blob, ct: flipped }, PRF_B)).rejects.toThrow(UnwrapFailedError);
  });

  it('rejects a tampered nonce', async () => {
    const id = identityFromPrf(PRF_A, CRED_A);
    const blob = await wrapKey(id.secretKey, PRF_B, CRED_B);
    const bad = blob.nonce.slice(0, -2) + (blob.nonce.slice(-2) === '00' ? '11' : '00');
    await expect(unwrapKey({ ...blob, nonce: bad }, PRF_B)).rejects.toThrow(UnwrapFailedError);
  });

  it('rejects a blob whose npub does not match its contents', async () => {
    const id = identityFromPrf(PRF_A, CRED_A);
    const other = identityFromPrf(PRF_C, CRED_C);
    const blob = await wrapKey(id.secretKey, PRF_B, CRED_B);
    await expect(unwrapKey({ ...blob, npub: other.npub }, PRF_B)).rejects.toThrow(/claims/);
  });

  it('rejects an unknown version and algorithm', async () => {
    const id = identityFromPrf(PRF_A, CRED_A);
    const blob = await wrapKey(id.secretKey, PRF_B, CRED_B);
    await expect(unwrapKey({ ...blob, v: 2 as any }, PRF_B)).rejects.toThrow(/version/);
    await expect(unwrapKey({ ...blob, alg: 'AES-128-CBC' as any }, PRF_B)).rejects.toThrow(/algorithm/);
  });
});

describe('registry', () => {
  const base = (): IdentityRegistry => {
    const id = identityFromPrf(PRF_A, CRED_A);
    return {
      npub: id.npub,
      credentials: [{ credential_id: bytesToHex(CRED_A), kind: 'primary', added_at: 0 }],
      wrapped: [],
    };
  };

  it('unlocks from the primary credential with no stored blob', async () => {
    const reg = base();
    const sk = await unlock(reg, CRED_A, PRF_A, primary);
    expect(nip19.npubEncode(getPublicKey(sk))).toBe(reg.npub);
    expect(reg.wrapped).toHaveLength(0);   // nothing stored, nothing to lose
  });

  it('unlocks the SAME identity from an added device', async () => {
    let reg = base();
    const sk = await unlock(reg, CRED_A, PRF_A, primary);
    reg = await addCredential(reg, sk, CRED_B, PRF_B, 'work laptop');

    const fromB = await unlock(reg, CRED_B, PRF_B, primary);
    expect(bytesToHex(fromB)).toBe(bytesToHex(sk));
    expect(nip19.npubEncode(getPublicKey(fromB))).toBe(reg.npub);
  });

  it('supports three devices, all resolving to one identity', async () => {
    let reg = base();
    const sk = await unlock(reg, CRED_A, PRF_A, primary);
    reg = await addCredential(reg, sk, CRED_B, PRF_B, 'laptop');
    reg = await addCredential(reg, sk, CRED_C, PRF_C, 'yubikey');

    for (const [cred, prf] of [[CRED_A, PRF_A], [CRED_B, PRF_B], [CRED_C, PRF_C]] as const) {
      expect(bytesToHex(await unlock(reg, cred, prf, primary))).toBe(bytesToHex(sk));
    }
  });

  it('REFUSES an unknown credential instead of silently forking the user', async () => {
    const reg = base();
    await expect(unlock(reg, CRED_C, PRF_C, primary)).rejects.toThrow(/Enrol it/);
  });

  it('refuses to enrol the same credential twice', async () => {
    let reg = base();
    const sk = await unlock(reg, CRED_A, PRF_A, primary);
    reg = await addCredential(reg, sk, CRED_B, PRF_B);
    await expect(addCredential(reg, sk, CRED_B, PRF_B)).rejects.toThrow(/already enrolled/);
  });

  it('refuses to enrol a key belonging to a different identity', async () => {
    const reg = base();
    const other = identityFromPrf(PRF_C, CRED_C);
    await expect(addCredential(reg, other.secretKey, CRED_B, PRF_B)).rejects.toThrow(/does not match/);
  });

  it('removing a credential drops its blob', async () => {
    let reg = base();
    const sk = await unlock(reg, CRED_A, PRF_A, primary);
    reg = await addCredential(reg, sk, CRED_B, PRF_B);
    expect(reg.wrapped).toHaveLength(1);

    reg = removeCredential(reg, bytesToHex(CRED_B));
    expect(reg.wrapped).toHaveLength(0);
    await expect(unlock(reg, CRED_B, PRF_B, primary)).rejects.toThrow(/Enrol it/);
  });
});

describe('the frozen path is untouched', () => {
  it('primary derivation still matches v2.0 exactly', () => {
    // Same inputs as the frozen V1 vector. If this moves, every existing
    // identity moved with it.
    const here = dirname(fileURLToPath(import.meta.url));
    const V = JSON.parse(readFileSync(resolvePath(here, '..', 'vectors', 'test-vectors.json'), 'utf8'));
    const frozen = V.V1_derivation_stability.cases[0];

    const id = identityFromPrf(PRF_A, CRED_A);
    expect(id.npub).toBe(frozen.npub);
    expect(id.attempt).toBe(frozen.attempt);
    expect(isValidScalar(id.secretKey)).toBe(true);
  });
});
