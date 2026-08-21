/**
 * Grants — bounded, visible, expiring.
 *
 * `spec/signer-broker.md`: "Per-request approval is safest and unusable at any
 * volume." So a user may grant a client a session, and every dimension of it is
 * bounded and visible.
 *
 * Rules encoded here rather than described:
 *   - a grant is always scoped to methods AND event kinds; "sign anything" is
 *     not an option this module can express
 *   - grants expire; there is no permanent grant and no flag that creates one
 *   - grants are per-origin and never transfer — a redirect does not carry one
 *
 * Grants live in memory beside the key and die with it. Persisting them would
 * outlive the custody they are scoped to.
 */

export interface Grant {
  origin: string;
  methods: string[];
  /** Event kinds this grant covers. Empty means: no sign_event without asking. */
  kinds: number[];
  expiresAt: number;
  used: number;
}

const grants = new Map<string, Grant>();

export const MAX_GRANT_MS = 60 * 60 * 1000;

export function grant(origin: string, methods: string[], kinds: number[], ms: number): Grant {
  const g: Grant = {
    origin,
    methods: [...new Set(methods)],
    kinds: [...new Set(kinds)],
    expiresAt: Date.now() + Math.min(ms, MAX_GRANT_MS),
    used: 0,
  };
  grants.set(origin, g);
  return g;
}

export function covers(origin: string, method: string, kind?: number): boolean {
  const g = grants.get(origin);
  if (!g) return false;
  if (Date.now() > g.expiresAt) { grants.delete(origin); return false; }
  if (!g.methods.includes(method)) return false;
  // A grant that did not name the kind does not cover it. Asking again is the
  // correct outcome, not an inconvenience to design around.
  if (method === 'sign_event') {
    if (typeof kind !== 'number') return false;
    if (!g.kinds.includes(kind)) return false;
  }
  return true;
}

export function record(origin: string): void {
  const g = grants.get(origin);
  if (g) g.used += 1;
}

export function list(): Grant[] {
  const now = Date.now();
  for (const [k, g] of grants) if (now > g.expiresAt) grants.delete(k);
  return [...grants.values()];
}

export function revoke(origin: string): void { grants.delete(origin); }

export function revokeAll(): void { grants.clear(); }
