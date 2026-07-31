/**
 * Verifying a signer against its attestation.
 *
 * THREE STATES, NOT TWO — the same discipline as `claimed` / `verified` in the
 * identity layer, and for the same reason: collapsing "I could not check" into
 * "it failed" or into "it passed" both produce the wrong action.
 *
 *   verified     served bytes hash to what the signer attested
 *   unattested   no attestation found — unknown, not proven bad
 *   MISMATCH     served bytes differ from the attestation
 *
 * MISMATCH always blocks. It is not a warning, not a degraded badge, not a
 * console message. It means the origin is serving code its own operator did not
 * sign for, and the only safe response is to refuse.
 *
 * WHAT THIS CANNOT DO, stated here so nobody has to discover it: a signer can
 * serve different bytes to a monitor than to a user, keyed on IP or user agent.
 * Transparency does not prevent that. Certificate Transparency did not prevent
 * misissuance either — it made it discoverable, permanent, and expensive to
 * sustain. That is the honest claim, and it is still worth having.
 */

import { hashBundle, checkAttestation, type SignerRegistry, type SignedEvent, type BuildAttestation } from './attest.js';

export type SignerStatus = 'verified' | 'unattested' | 'mismatch';

export interface VerifyResult {
  status: SignerStatus;
  origin: string;
  observedSha256?: string;
  expectedSha256?: string;
  version?: string;
  /** Plain sentence suitable for showing a user. */
  message: string;
  /** Whether a caller should proceed to open this signer. */
  allow: boolean;
}

export interface VerifyOptions {
  /** Refuse when no attestation exists. Default true — fail closed. */
  requireAttestation?: boolean;
  /** Reject attestations older than this many seconds. 0 disables. */
  maxAgeSeconds?: number;
  now?: number;
}

/** Injected so the whole module is testable with no network at all. */
export type Fetcher = (url: string) => Promise<Uint8Array>;
export type AttestationLookup = (origin: string) => Promise<SignedEvent[]>;

export async function verifySigner(
  origin: string,
  reg: SignerRegistry,
  fetchBytes: Fetcher,
  lookup: AttestationLookup,
  opts: VerifyOptions = {},
): Promise<VerifyResult> {
  const requireAttestation = opts.requireAttestation ?? true;
  const now = opts.now ?? Math.floor(Date.now() / 1000);

  let events: SignedEvent[] = [];
  try {
    events = await lookup(origin);
  } catch {
    events = [];
  }

  // Newest valid attestation wins. Checking every candidate rather than only
  // the newest matters: a hijacker who can publish will publish something
  // newer, and it should fail the pinned-key check rather than shadow a good one.
  const valid: { ev: SignedEvent; a: BuildAttestation }[] = [];
  for (const ev of events) {
    const c = checkAttestation(ev, origin, reg);
    if (c.ok && c.attestation) valid.push({ ev, a: c.attestation });
  }
  valid.sort((x, y) => y.a.created_at - x.a.created_at);
  const newest = valid[0];

  if (!newest) {
    return {
      status: 'unattested',
      origin,
      message: requireAttestation
        ? `${origin} has published no build attestation this node can verify. Refusing to continue.`
        : `${origin} has published no build attestation. Proceeding without verification.`,
      allow: !requireAttestation,
    };
  }

  if (opts.maxAgeSeconds && now - newest.a.created_at > opts.maxAgeSeconds) {
    // A stale attestation is not evidence about what is served today. Treat it
    // as absent rather than as weak proof.
    return {
      status: 'unattested',
      origin,
      expectedSha256: newest.a.sha256,
      version: newest.a.version,
      message: `The newest attestation for ${origin} is ${Math.floor((now - newest.a.created_at) / 86400)} days old. Treating as unverified.`,
      allow: !requireAttestation,
    };
  }

  let observed: string;
  try {
    const bytes = await fetchBytes(origin + newest.a.path);
    observed = hashBundle(bytes);
  } catch (e) {
    return {
      status: 'unattested',
      origin,
      expectedSha256: newest.a.sha256,
      message: `Could not fetch ${origin}${newest.a.path} to check it: ${(e as Error).message}`,
      allow: false,   // cannot check AND cannot reach — never proceed
    };
  }

  if (observed !== newest.a.sha256) {
    return {
      status: 'mismatch',
      origin,
      observedSha256: observed,
      expectedSha256: newest.a.sha256,
      version: newest.a.version,
      message:
        `${origin} is serving code its operator did not sign for. ` +
        `Expected ${newest.a.sha256.slice(0, 16)}…, got ${observed.slice(0, 16)}…. ` +
        'Do not enter anything here.',
      allow: false,
    };
  }

  return {
    status: 'verified',
    origin,
    observedSha256: observed,
    expectedSha256: newest.a.sha256,
    version: newest.a.version,
    message: `${origin} is serving version ${newest.a.version}, matching its published attestation.`,
    allow: true,
  };
}
