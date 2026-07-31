/**
 * V2 — scalar validation and the counter-retry branch.
 *
 * A natural retry case cannot be constructed: P(HKDF-SHA256 output >= n) is
 * below 2^-128, so no amount of searching will find one. The branch is
 * therefore exercised with an injected stub KDF. That substitution is
 * deliberate and is recorded in the vector file rather than left implicit —
 * an untested branch that "can never happen" is how latent bugs survive.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
  isValidScalar,
  deriveSecretKey,
  identityFromPrf,
  buildInfo,
  type Kdf,
} from '../src/derive.js';
import { SECP256K1_ORDER, MAX_SCALAR_ATTEMPTS } from '../src/constants.js';
import { ScalarDerivationExhaustedError } from '../src/errors.js';

const here = dirname(fileURLToPath(import.meta.url));
const V = JSON.parse(
  readFileSync(resolve(here, '..', 'vectors', 'test-vectors.json'), 'utf8'),
);
const hexToBytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));

describe('V2 — scalar boundaries', () => {
  it('curve order constant matches the frozen vector', () => {
    expect(SECP256K1_ORDER.toString(16)).toBe(V.V2_scalar_validation.curveOrderHex);
  });

  it('curve order is the canonical secp256k1 value', () => {
    expect(SECP256K1_ORDER).toBe(
      0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n,
    );
  });

  for (const b of V.V2_scalar_validation.boundary) {
    it(`${b.label} -> ${b.valid ? 'valid' : 'INVALID'}`, () => {
      expect(isValidScalar(hexToBytes(b.hex))).toBe(b.valid);
    });
  }

  it('rejects zero — it has no multiplicative inverse', () => {
    expect(isValidScalar(new Uint8Array(32))).toBe(false);
  });

  it('rejects n exactly — congruent to zero', () => {
    const n = hexToBytes(SECP256K1_ORDER.toString(16).padStart(64, '0'));
    expect(isValidScalar(n)).toBe(false);
  });

  it('rejects anything that is not 32 bytes', () => {
    expect(isValidScalar(new Uint8Array(31).fill(1))).toBe(false);
    expect(isValidScalar(new Uint8Array(33).fill(1))).toBe(false);
  });
});

describe('V2 — counter retry branch', () => {
  const r = V.V2_scalar_validation.retry;

  /** Stub KDF: returns an invalid scalar at counter 0, a valid one at 1. */
  const stubKdf: Kdf = (_ikm, _salt, info) => {
    const counter = info[info.length - 1];
    return counter === 0 ? hexToBytes(r.counter0Hex) : hexToBytes(r.counter1Hex);
  };

  it('advances the counter instead of clamping or reducing mod n', () => {
    const out = deriveSecretKey(new Uint8Array(32).fill(7), new Uint8Array([1, 2, 3]), stubKdf);
    expect(out.attempt).toBe(r.expectedAttempt);
    expect(bytesToHex(out.secretKey)).toBe(r.counter1Hex);
  });

  it('the rejected counter-0 value is genuinely invalid', () => {
    expect(isValidScalar(hexToBytes(r.counter0Hex))).toBe(false);
  });

  it('does NOT reduce the invalid value mod n (which would bias the distribution)', () => {
    const out = deriveSecretKey(new Uint8Array(32).fill(7), new Uint8Array([1, 2, 3]), stubKdf);
    // n mod n == 0, so a reducing implementation would produce zero here.
    expect(bytesToHex(out.secretKey)).not.toBe('00'.repeat(32));
  });

  it('throws rather than looping forever when the KDF is faulty', () => {
    const alwaysInvalid: Kdf = () => new Uint8Array(32); // zero: never valid
    expect(() =>
      deriveSecretKey(new Uint8Array(32).fill(7), new Uint8Array([1]), alwaysInvalid),
    ).toThrow(ScalarDerivationExhaustedError);
  });

  it('gives up after exactly MAX_SCALAR_ATTEMPTS draws', () => {
    let calls = 0;
    const counting: Kdf = () => {
      calls++;
      return new Uint8Array(32);
    };
    expect(() =>
      deriveSecretKey(new Uint8Array(32).fill(7), new Uint8Array([1]), counting),
    ).toThrow();
    expect(calls).toBe(MAX_SCALAR_ATTEMPTS);
  });

  it('real derivations essentially never retry', () => {
    for (let i = 0; i < 64; i++) {
      const prf = new Uint8Array(32).fill(i);
      expect(identityFromPrf(prf, new Uint8Array([i])).attempt).toBe(0);
    }
  });
});

describe('input validation', () => {
  it('rejects PRF output that is not 32 bytes', () => {
    expect(() => deriveSecretKey(new Uint8Array(31), new Uint8Array([1]))).toThrow(RangeError);
    expect(() => deriveSecretKey(new Uint8Array(64), new Uint8Array([1]))).toThrow(RangeError);
  });

  it('rejects an empty credential id', () => {
    expect(() => deriveSecretKey(new Uint8Array(32).fill(1), new Uint8Array(0))).toThrow(
      RangeError,
    );
  });

  it('rejects an out-of-range counter in buildInfo', () => {
    expect(() => buildInfo(new Uint8Array([1]), -1)).toThrow(RangeError);
    expect(() => buildInfo(new Uint8Array([1]), 256)).toThrow(RangeError);
    expect(() => buildInfo(new Uint8Array([1]), 1.5)).toThrow(RangeError);
  });

  it('info string embeds prefix, credential id, separator and counter', () => {
    const cred = new Uint8Array([0xaa, 0xbb]);
    const info = buildInfo(cred, 3);
    const PREFIX = 'secp256k1|'; // 10 bytes

    expect(new TextDecoder().decode(info.slice(0, PREFIX.length))).toBe(PREFIX);
    expect(Array.from(info.slice(PREFIX.length, PREFIX.length + cred.length))).toEqual([
      0xaa, 0xbb,
    ]);
    expect(info[PREFIX.length + cred.length]).toBe(0x7c); // '|'
    expect(info[info.length - 1]).toBe(3);
    expect(info.length).toBe(PREFIX.length + cred.length + 2);
  });

  it('info string differs per counter — this is what makes retry a new draw', () => {
    const cred = new Uint8Array([1, 2]);
    expect(Array.from(buildInfo(cred, 0))).not.toEqual(Array.from(buildInfo(cred, 1)));
  });
});

describe('secret material is real entropy, not a public function', () => {
  it('the only secret input is the PRF output', () => {
    // Same credential id (public — it is stored in localStorage and visible),
    // different PRF output -> completely different key. If an attacker could
    // predict the key from public data, these would collide.
    const cred = new Uint8Array([9, 9, 9, 9]);
    const a = identityFromPrf(new Uint8Array(32).fill(0x11), cred);
    const b = identityFromPrf(new Uint8Array(32).fill(0x12), cred);
    expect(a.pubkeyHex).not.toBe(b.pubkeyHex);
  });

  it('a one-bit change in PRF output fully changes the key (avalanche)', () => {
    const cred = new Uint8Array([1]);
    const p1 = new Uint8Array(32).fill(0);
    const p2 = new Uint8Array(32).fill(0);
    p2[31] = 1;
    const a = bytesToHex(identityFromPrf(p1, cred).secretKey);
    const b = bytesToHex(identityFromPrf(p2, cred).secretKey);
    let same = 0;
    for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same++;
    expect(same).toBeLessThan(a.length * 0.25); // ~1/16 expected for hex
  });
});
