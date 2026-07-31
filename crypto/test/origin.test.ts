/**
 * V5 — NEGATIVE VECTOR: origin scoping.
 *
 * The full guarantee ("the same passkey cannot be used from a second origin")
 * is enforced by the browser via the WebAuthn RP ID and cannot be unit-tested
 * in Node. It is covered by scripts/e2e-checklist.md.
 *
 * What IS tested here is our own half of the contract: the derivation path
 * refuses to execute anywhere except the configured signer origin, and two
 * signer origins map to two different RP IDs — which is precisely why custody
 * must be centralised rather than replicated per node (Berm v2 §3.2.1).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertSignerOrigin, rpIdFromOrigin } from '../src/origin.js';
import { WrongOriginError } from '../src/errors.js';

const here = dirname(fileURLToPath(import.meta.url));
const V = JSON.parse(
  readFileSync(resolve(here, '..', 'vectors', 'test-vectors.json'), 'utf8'),
).V5_origin_scoping;

describe('V5 — signer origin guard', () => {
  it('permits the configured signer origin', () => {
    expect(() => assertSignerOrigin(V.signerOrigin, { origin: V.signerOrigin })).not.toThrow();
  });

  for (const bad of V.mustThrow) {
    it(`REFUSES to derive at ${bad}`, () => {
      expect(() => assertSignerOrigin(V.signerOrigin, { origin: bad })).toThrow(WrongOriginError);
    });
  }

  it('refuses when there is no origin at all (non-browser context)', () => {
    expect(() => assertSignerOrigin(V.signerOrigin, undefined)).toThrow(WrongOriginError);
    expect(() => assertSignerOrigin(V.signerOrigin, { origin: '' })).toThrow(WrongOriginError);
  });

  it('is not fooled by a suffix-matching lookalike domain', () => {
    expect(() =>
      assertSignerOrigin(V.signerOrigin, { origin: 'https://signer.xonly.ai.evil.tld' }),
    ).toThrow(WrongOriginError);
  });

  it('is not fooled by a prefix-matching lookalike domain', () => {
    expect(() =>
      assertSignerOrigin(V.signerOrigin, { origin: 'https://evil.signer.xonly.ai' }),
    ).toThrow(WrongOriginError);
  });

  it('treats http as a different origin from https', () => {
    expect(() =>
      assertSignerOrigin(V.signerOrigin, { origin: 'http://signer.xonly.ai' }),
    ).toThrow(WrongOriginError);
  });

  it('names both origins in the error, so the failure is diagnosable', () => {
    try {
      assertSignerOrigin(V.signerOrigin, { origin: 'https://blog-a.com' });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain('blog-a.com');
      expect((e as Error).message).toContain(V.signerOrigin);
      expect((e as Error).message).toContain('NIP-46');
    }
  });
});

describe('V5 — RP ID derivation', () => {
  it('derives the frozen RP ID from the signer origin', () => {
    expect(rpIdFromOrigin(V.signerOrigin)).toBe(V.expectedRpId);
  });

  it('two node origins produce two different RP IDs — hence two identities', () => {
    const a = rpIdFromOrigin('https://blog-a.com');
    const b = rpIdFromOrigin('https://blog-b.com');
    expect(a).not.toBe(b);
    // This inequality IS the argument for a single signer origin. Per-site
    // passkeys would give this user two unrelated Nostr identities.
  });

  it('rejects non-https origins outside development', () => {
    expect(() => rpIdFromOrigin('http://signer.xonly.ai')).toThrow(WrongOriginError);
  });

  it('allows http://localhost for development only', () => {
    expect(rpIdFromOrigin('http://localhost:5173')).toBe('localhost');
  });
});
