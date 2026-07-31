/**
 * V6 — NEGATIVE VECTOR: the v1 derivation must stay dead.
 *
 * Two jobs:
 *   1. Prove, executably, that the v1 scheme is a public function of a public
 *      value. Not argued in a comment — computed.
 *   2. Scan the source tree so it cannot quietly return.
 *
 * The forbidden literals are assembled from fragments here, so that the
 * scanner does not match its own needle.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  v1BrokenDerivation,
  attackerRecoversV1Key,
  bruteForceV1Pin,
} from '../src/quarantine/v1-broken.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const V = JSON.parse(
  readFileSync(resolve(root, 'vectors', 'test-vectors.json'), 'utf8'),
).V6_v1_regression_guard;

/* ------------------------------------------------------------------ */
/* 1. The break, demonstrated                                          */
/* ------------------------------------------------------------------ */

describe('V6 — the v1 derivation is broken by construction', () => {
  const xUserId = V.publicXUserId as string;

  it('an attacker with ONLY the public X user ID recovers the private key exactly', () => {
    const victimKey = v1BrokenDerivation(xUserId);
    const attackerKey = attackerRecoversV1Key(xUserId);
    expect(attackerKey).toBe(victimKey);
    // The assertion IS the vector. No stored constant is needed, because the
    // point is not "the key equals X" — it is "anyone can compute the key".
  });

  it('the key is fully determined by public input — zero secret bits', () => {
    // Ten independent "attackers", no shared state, identical result.
    const results = new Set(Array.from({ length: 10 }, () => attackerRecoversV1Key(xUserId)));
    expect(results.size).toBe(1);
  });

  it('every X user on the platform is trivially enumerable', () => {
    const keys = ['1', '12', '123', '1234', '12345'].map((id) => attackerRecoversV1Key(id));
    expect(new Set(keys).size).toBe(5);   // distinct keys...
    keys.forEach((k) => expect(k).toMatch(/^[0-9a-f]{64}$/)); // ...all valid-looking
    // Distinctness is irrelevant to security here: each is still computable
    // from a public integer. Enumerating the whole user base is a for-loop.
  });

  it('the optional PIN does not save it — 6 digits falls to offline search', () => {
    const target = v1BrokenDerivation(xUserId, '493021');
    const started = performance.now();
    const found = bruteForceV1Pin(xUserId, target, 6);
    const elapsedMs = performance.now() - started;

    expect(found).toBe('493021');
    // The attacker knows the npub and the X ID, so the search is offline and
    // unthrottled. Wall-clock here is a loose upper bound on a laptop; real
    // attackers use GPUs.
    expect(elapsedMs).toBeLessThan(120_000);
  });

  it('a 4-digit PIN falls instantly', () => {
    const target = v1BrokenDerivation(xUserId, '0000');
    expect(bruteForceV1Pin(xUserId, target, 4)).toBe('0000');
  });
});

/* ------------------------------------------------------------------ */
/* 2. The scanner                                                      */
/* ------------------------------------------------------------------ */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
      walk(p, out);
    } else if (/\.(ts|js|mjs|cjs|php)$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

/** Assembled from fragments so this file is not itself a match. */
const V1_SALT_NEEDLE = ['X-Nostr-', 'Sovereign-', 'Bridge-', 'V1-', 'Salt'].join('');
const NIP04_NEEDLE = ['nip', '04'].join('');

describe('V6 — source tree guards', () => {
  const srcFiles = walk(resolve(root, 'src')).filter(
    (f) => !relative(root, f).includes('quarantine'),
  );

  it('finds source files to scan (guard against a vacuous pass)', () => {
    expect(srcFiles.length).toBeGreaterThan(5);
  });

  it('no file under src/ contains the v1 salt literal', () => {
    const offenders = srcFiles.filter((f) => readFileSync(f, 'utf8').includes(V1_SALT_NEEDLE));
    expect(offenders.map((f) => relative(root, f))).toEqual([]);
  });

  it('no file under src/ derives a key from an X user ID', () => {
    const suspicious = /derive\w*\s*\(\s*[^)]*x_?user_?id/i;
    const offenders = srcFiles.filter((f) => suspicious.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => relative(root, f))).toEqual([]);
  });

  it('NIP-04 appears nowhere in src/ or test/ — it is deprecated and prohibited', () => {
    const all = [...srcFiles, ...walk(resolve(root, 'test'))].filter(
      (f) => !f.endsWith('negative.test.ts'),
    );
    const offenders = all.filter((f) => readFileSync(f, 'utf8').includes(NIP04_NEEDLE));
    expect(offenders.map((f) => relative(root, f))).toEqual([]);
  });

  it('the quarantine module is not re-exported from the public surface', () => {
    const index = readFileSync(resolve(root, 'src', 'index.ts'), 'utf8');
    // Match real import/export statements, not prose in comments — the header
    // comment legitimately explains why the module is absent.
    const stripped = index.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/from\s+['"][^'"]*quarantine/);
    expect(stripped).not.toMatch(/v1Broken|attackerRecovers|bruteForceV1Pin/);
  });

  it('nothing outside test/negative and the quarantine dir imports the v1 module', () => {
    const all = [...walk(resolve(root, 'src')), ...walk(resolve(root, 'test'))].filter(
      (f) => !relative(root, f).includes('quarantine') && !f.endsWith('negative.test.ts'),
    );
    const offenders = all.filter((f) =>
      /from\s+['"][^'"]*quarantine/.test(
        readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''),
      ),
    );
    expect(offenders.map((f) => relative(root, f))).toEqual([]);
  });

  it('the quarantine module is excluded from the build', () => {
    const tsconfig = readFileSync(resolve(root, 'tsconfig.json'), 'utf8');
    expect(tsconfig).toContain('src/quarantine');
  });
});
