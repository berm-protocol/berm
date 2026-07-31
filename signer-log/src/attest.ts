/**
 * Signer build attestations.
 *
 * THE PROBLEM THIS EXISTS FOR. A signer origin serves JavaScript that derives
 * or unlocks identity keys. It can serve different JavaScript tomorrow — to one
 * user, from one IP, for one hour — and nothing in the browser will tell them.
 * Subresource integrity does not help, because the same origin controls the page
 * that declares the SRI hash. This is the structural limit of all
 * browser-delivered cryptography.
 *
 * Transparency does not remove that power. It makes USING it leave permanent,
 * public, third-party-verifiable evidence.
 *
 *     signer publishes:  "version 2.4.1 of my bundle hashes to H"   (signed)
 *     anyone fetches:    the bytes actually served, hashes them
 *     mismatch:          a provable accusation, not an opinion
 *
 * THE OPERATIONAL REQUIREMENT THAT MAKES OR BREAKS IT: the attestation key MUST
 * NOT live on the web server. If it does, whoever takes the server signs
 * whatever they serve and the log attests to their code as faithfully as to
 * ours. Offline key, published pubkey, signed at release time. Everything below
 * is decoration if that one rule is broken.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { verifyEvent } from 'nostr-tools';

export const SIGNER_BUILD_D_TAG = 'berm:signer-build:v1';
export const SIGNER_FINDING_D_TAG = 'berm:signer-finding:v1';

export interface EventTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

export interface SignedEvent extends EventTemplate {
  id: string;
  pubkey: string;
  sig: string;
}

export interface BuildAttestation {
  /** Exact origin, scheme included. `https://signer.xonly.ai`, never a path. */
  origin: string;
  version: string;
  /** SHA-256 of the exact bytes served, lowercase hex. */
  sha256: string;
  /** Path the bundle is served at, so a monitor knows what to fetch. */
  path: string;
  /** Commit or build reference, so the hash can be reproduced from source. */
  build?: string;
  created_at: number;
}

export class AttestationError extends Error {
  constructor(msg: string) { super(msg); this.name = 'AttestationError'; }
}

const HEX64 = /^[0-9a-f]{64}$/;

/** Hash bytes exactly as served. No normalisation — a byte is a byte. */
export function hashBundle(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

export function buildAttestation(a: BuildAttestation): EventTemplate {
  if (!/^https:\/\/[^/]+$/.test(a.origin)) {
    // A path here would let one attestation stand for several bundles, which is
    // exactly the ambiguity an attacker wants.
    throw new AttestationError(`origin must be scheme+host with no path: ${a.origin}`);
  }
  if (!HEX64.test(a.sha256)) throw new AttestationError('sha256 must be 64 lowercase hex chars');

  const tags: string[][] = [
    ['d', SIGNER_BUILD_D_TAG],
    ['origin', a.origin],
    ['version', a.version],
    ['sha256', a.sha256],
    ['path', a.path],
  ];
  if (a.build) tags.push(['build', a.build]);

  return { kind: 30078, created_at: a.created_at, tags, content: '' };
}

export function parseAttestation(ev: SignedEvent): BuildAttestation | null {
  const get = (k: string) => ev.tags.find((t) => t[0] === k)?.[1];
  if (get('d') !== SIGNER_BUILD_D_TAG) return null;

  const origin = get('origin');
  const version = get('version');
  const hash = get('sha256');
  const path = get('path');
  if (!origin || !version || !hash || !path || !HEX64.test(hash)) return null;

  const build = get('build');
  return {
    origin, version, path, sha256: hash, created_at: ev.created_at,
    ...(build ? { build } : {}),
  };
}

/**
 * Which pubkeys may speak for which origin.
 *
 * Pinned, deliberately. The alternatives all fail: publishing the key at the
 * origin lets a hijacker publish their own, and NIP-05 has the same hole. This
 * is the certificate-root-store model — rigid, updated out of band, and honest
 * about being a trust decision rather than a derivation.
 *
 * The on-chain root (v3) replaces this with a commitment nobody can rewrite.
 * Until then, a node operator can add origins they choose to trust.
 */
export type SignerRegistry = ReadonlyMap<string, ReadonlySet<string>>;

export function registry(entries: Record<string, string[]>): SignerRegistry {
  return new Map(Object.entries(entries).map(([o, keys]) => [o, new Set(keys)]));
}

export interface AttestationCheck {
  ok: boolean;
  attestation?: BuildAttestation;
  reason?: string;
}

/**
 * Validate an attestation event: real signature, recognised signer, matching
 * origin. Everything here is checkable without contacting the signer.
 */
export function checkAttestation(
  ev: SignedEvent,
  origin: string,
  reg: SignerRegistry,
): AttestationCheck {
  // Clone through JSON before verifying. nostr-tools memoises verifyEvent via a
  // Symbol on the object, and an object spread copies it — so a tampered clone
  // can report itself valid. This footgun has bitten this project once already.
  const fresh = JSON.parse(JSON.stringify(ev)) as SignedEvent;
  if (!verifyEvent(fresh)) return { ok: false, reason: 'attestation signature is invalid' };

  const parsed = parseAttestation(fresh);
  if (!parsed) return { ok: false, reason: 'not a well-formed signer build attestation' };

  if (parsed.origin !== origin) {
    return { ok: false, reason: `attestation is for ${parsed.origin}, not ${origin}` };
  }

  const allowed = reg.get(origin);
  if (!allowed) return { ok: false, reason: `no pinned signer key for ${origin}` };
  if (!allowed.has(fresh.pubkey)) {
    // A valid signature by the wrong key is the interesting failure: someone
    // published a well-formed attestation for an origin they do not speak for.
    return { ok: false, reason: `${fresh.pubkey.slice(0, 16)}… is not a pinned key for ${origin}` };
  }

  return { ok: true, attestation: parsed };
}

/* ------------------------------------------------------------------ */
/* Findings — what a monitor publishes                                 */
/* ------------------------------------------------------------------ */

export type FindingVerdict = 'match' | 'mismatch' | 'unattested' | 'unreachable';

export interface Finding {
  origin: string;
  verdict: FindingVerdict;
  /** What the monitor actually got. */
  observedSha256?: string;
  /** What the attestation said it should be. */
  expectedSha256?: string;
  checked_at: number;
  note?: string;
}

/**
 * A monitor's report, published so it can be checked rather than believed.
 *
 * A mismatch finding is an accusation. It must carry both hashes and the time,
 * so a third party can re-run the check and either corroborate or refute it —
 * including refuting ours.
 */
export function buildFinding(f: Finding): EventTemplate {
  const tags: string[][] = [
    ['d', `${SIGNER_FINDING_D_TAG}:${f.origin}`],
    ['origin', f.origin],
    ['verdict', f.verdict],
    ['checked_at', String(f.checked_at)],
  ];
  if (f.observedSha256) tags.push(['observed', f.observedSha256]);
  if (f.expectedSha256) tags.push(['expected', f.expectedSha256]);

  return {
    kind: 30078,
    created_at: f.checked_at,
    tags,
    content: f.note ?? '',
  };
}
