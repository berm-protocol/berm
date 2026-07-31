/**
 * The transparency claims.
 *
 * The tests that matter are the adversarial ones: a hijacked origin serving
 * altered code, an attacker publishing their own attestation, a stale
 * attestation being treated as current, and the monitor being unable to reach
 * the signer at all. A suite that only proves the happy path proves nothing
 * about a system whose entire purpose is catching defection.
 */

import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';

import {
  buildAttestation, parseAttestation, checkAttestation, hashBundle, registry,
  buildFinding, AttestationError, SIGNER_BUILD_D_TAG,
  type SignedEvent,
} from '../src/attest.js';
import { verifySigner, type Fetcher, type AttestationLookup } from '../src/verify.js';

/* ---------- fixtures ---------- */

const ORIGIN = 'https://signer.xonly.ai';
const PATH = '/dist/signer.js';

/** The offline release key. Never on the web server — that is the whole point. */
const releaseKey = generateSecretKey();
const releasePub = getPublicKey(releaseKey);

/** An attacker who has taken the origin but not the release key. */
const attackerKey = generateSecretKey();

const GOOD_BUNDLE = new TextEncoder().encode('/* signer v2.4.1 — the real thing */');
const EVIL_BUNDLE = new TextEncoder().encode('/* signer v2.4.1 — exfiltrates prf_out */');

const GOOD_HASH = hashBundle(GOOD_BUNDLE);
const EVIL_HASH = hashBundle(EVIL_BUNDLE);

const REG = registry({ [ORIGIN]: [releasePub] });

function attest(opts: { hash?: string; at?: number; key?: Uint8Array; origin?: string } = {}): SignedEvent {
  const tmpl = buildAttestation({
    origin: opts.origin ?? ORIGIN,
    version: '2.4.1',
    sha256: opts.hash ?? GOOD_HASH,
    path: PATH,
    build: 'commit:abc123',
    created_at: opts.at ?? 1785000000,
  });
  return finalizeEvent(tmpl, opts.key ?? releaseKey) as SignedEvent;
}

const serving = (bytes: Uint8Array): Fetcher => async () => bytes;
const publishes = (evs: SignedEvent[]): AttestationLookup => async () => evs;

const NOW = 1785000100;

/* ================================================================== */

describe('attestation shape', () => {
  it('refuses an origin with a path', () => {
    // One attestation must stand for exactly one origin, or it becomes an
    // ambiguity an attacker can live inside.
    expect(() => buildAttestation({
      origin: 'https://signer.xonly.ai/app', version: '1', sha256: GOOD_HASH, path: PATH, created_at: 0,
    })).toThrow(AttestationError);
  });

  it('refuses a malformed hash', () => {
    expect(() => buildAttestation({
      origin: ORIGIN, version: '1', sha256: 'nope', path: PATH, created_at: 0,
    })).toThrow(/64 lowercase hex/);
  });

  it('round-trips', () => {
    const parsed = parseAttestation(attest());
    expect(parsed?.origin).toBe(ORIGIN);
    expect(parsed?.sha256).toBe(GOOD_HASH);
    expect(parsed?.build).toBe('commit:abc123');
  });

  it('ignores events that are not build attestations', () => {
    const other = finalizeEvent(
      { kind: 30078, created_at: 1, tags: [['d', 'berm:identity:v1']], content: '' },
      releaseKey,
    ) as SignedEvent;
    expect(parseAttestation(other)).toBeNull();
  });
});

describe('who may speak for an origin', () => {
  it('accepts the pinned release key', () => {
    expect(checkAttestation(attest(), ORIGIN, REG).ok).toBe(true);
  });

  it('REJECTS a valid signature from an unpinned key', () => {
    // The interesting failure: a hijacker publishes a perfectly well-formed,
    // correctly signed attestation for an origin they do not speak for.
    const c = checkAttestation(attest({ key: attackerKey, hash: EVIL_HASH }), ORIGIN, REG);
    expect(c.ok).toBe(false);
    expect(c.reason).toMatch(/is not a pinned key/);
  });

  it('rejects an attestation for a different origin', () => {
    const c = checkAttestation(attest({ origin: 'https://signer.evil.tld' }), ORIGIN, REG);
    expect(c.ok).toBe(false);
    expect(c.reason).toMatch(/is for https:\/\/signer\.evil\.tld/);
  });

  it('rejects a tampered attestation', () => {
    const ev = attest();
    const tampered = { ...JSON.parse(JSON.stringify(ev)) } as SignedEvent;
    tampered.tags = tampered.tags.map((t) => (t[0] === 'sha256' ? ['sha256', EVIL_HASH] : t));
    const c = checkAttestation(tampered, ORIGIN, REG);
    expect(c.ok).toBe(false);
    expect(c.reason).toMatch(/signature is invalid/);
  });

  it('rejects an origin with no pinned key at all', () => {
    const c = checkAttestation(attest(), ORIGIN, registry({}));
    expect(c.reason).toMatch(/no pinned signer key/);
  });
});

/* ================================================================== */

describe('verification against what is actually served', () => {
  it('verified when the bytes match', async () => {
    const r = await verifySigner(ORIGIN, REG, serving(GOOD_BUNDLE), publishes([attest()]), { now: NOW });
    expect(r.status).toBe('verified');
    expect(r.allow).toBe(true);
    expect(r.version).toBe('2.4.1');
  });

  it('MISMATCH when the origin serves altered code — and blocks', async () => {
    // The scenario the whole module exists for: the origin is hijacked, the
    // release key is not, so the attestation still says what the real bundle
    // hashes to and the served bytes no longer match it.
    const r = await verifySigner(ORIGIN, REG, serving(EVIL_BUNDLE), publishes([attest()]), { now: NOW });
    expect(r.status).toBe('mismatch');
    expect(r.allow).toBe(false);
    expect(r.observedSha256).toBe(EVIL_HASH);
    expect(r.expectedSha256).toBe(GOOD_HASH);
    expect(r.message).toMatch(/did not sign for/);
    expect(r.message).toMatch(/Do not enter anything here/);
  });

  it('an attacker cannot self-attest their way out of a mismatch', async () => {
    // Hijacker serves evil bytes AND publishes an attestation matching them —
    // signed with their own key, because they do not have the release key.
    const r = await verifySigner(
      ORIGIN, REG, serving(EVIL_BUNDLE),
      publishes([attest({ key: attackerKey, hash: EVIL_HASH, at: 1785000090 }), attest()]),
      { now: NOW },
    );
    expect(r.status).toBe('mismatch');
    expect(r.allow).toBe(false);
  });

  it('a newer forged attestation does not shadow the genuine one', async () => {
    const r = await verifySigner(
      ORIGIN, REG, serving(GOOD_BUNDLE),
      publishes([attest({ key: attackerKey, hash: EVIL_HASH, at: 1785000099 }), attest()]),
      { now: NOW },
    );
    expect(r.status).toBe('verified');
  });

  it('unattested fails CLOSED by default', async () => {
    const r = await verifySigner(ORIGIN, REG, serving(GOOD_BUNDLE), publishes([]), { now: NOW });
    expect(r.status).toBe('unattested');
    expect(r.allow).toBe(false);
    expect(r.message).toMatch(/Refusing to continue/);
  });

  it('unattested may fail open when a node operator chooses that', async () => {
    const r = await verifySigner(ORIGIN, REG, serving(GOOD_BUNDLE), publishes([]), {
      now: NOW, requireAttestation: false,
    });
    expect(r.allow).toBe(true);
    expect(r.status).toBe('unattested');
  });

  it('a stale attestation is treated as absent, not as weak proof', async () => {
    const r = await verifySigner(ORIGIN, REG, serving(GOOD_BUNDLE), publishes([attest({ at: 1700000000 })]), {
      now: NOW, maxAgeSeconds: 30 * 86400,
    });
    expect(r.status).toBe('unattested');
    expect(r.message).toMatch(/days old/);
  });

  it('unreachable never allows, even with requireAttestation off', async () => {
    // Cannot check AND cannot reach is the worst state, not a permissive one.
    const dead: Fetcher = async () => { throw new Error('ECONNREFUSED'); };
    const r = await verifySigner(ORIGIN, REG, dead, publishes([attest()]), {
      now: NOW, requireAttestation: false,
    });
    expect(r.allow).toBe(false);
    expect(r.message).toMatch(/Could not fetch/);
  });

  it('survives a relay returning junk', async () => {
    const broken: AttestationLookup = async () => { throw new Error('relay exploded'); };
    const r = await verifySigner(ORIGIN, REG, serving(GOOD_BUNDLE), broken, { now: NOW });
    expect(r.status).toBe('unattested');
    expect(r.allow).toBe(false);
  });
});

/* ================================================================== */

describe('findings are accusations that can be checked', () => {
  it('carries both hashes so a third party can re-run it', () => {
    const ev = buildFinding({
      origin: ORIGIN, verdict: 'mismatch',
      observedSha256: EVIL_HASH, expectedSha256: GOOD_HASH,
      checked_at: NOW, note: 'observed from monitor A',
    });
    const get = (k: string) => ev.tags.find((t) => t[0] === k)?.[1];

    expect(get('verdict')).toBe('mismatch');
    expect(get('observed')).toBe(EVIL_HASH);
    expect(get('expected')).toBe(GOOD_HASH);
    // Without both hashes and a timestamp the finding is an opinion, and an
    // accusation that cannot be refuted is worth as little as one that cannot
    // be corroborated.
    expect(get('checked_at')).toBe(String(NOW));
  });

  it('addresses per origin so one monitor can report on many', () => {
    const a = buildFinding({ origin: ORIGIN, verdict: 'match', checked_at: NOW });
    const b = buildFinding({ origin: 'https://signer.bags.fm', verdict: 'match', checked_at: NOW });
    const d = (ev: { tags: string[][] }) => ev.tags.find((t) => t[0] === 'd')?.[1];
    expect(d(a)).not.toBe(d(b));
    expect(d(a)).toContain(SIGNER_BUILD_D_TAG.replace('build', 'finding').slice(0, 12));
  });
});
