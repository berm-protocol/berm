/**
 * The signer/1 wire protocol — `spec/signer-broker.md`.
 *
 * Method names and semantics are NIP-46's on purpose: a developer writes one
 * integration that works against Amber, nsec.app, a self-hosted bunker, or us.
 * We are a transport, not a new vocabulary.
 */

export const PROTOCOL = 'signer/1';

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

export type Method =
  | 'connect'
  | 'ping'
  | 'get_public_key'
  | 'sign_event'
  | 'nip44_encrypt'
  | 'nip44_decrypt'
  | 'get_relays';

/**
 * NIP-04 is prohibited repo-wide and is deliberately absent from `Method`.
 * A signer that offers a broken primitive because clients ask for it is how
 * broken primitives survive.
 */
export const SUPPORTED: ReadonlySet<string> = new Set<Method>([
  'connect', 'ping', 'get_public_key', 'sign_event', 'nip44_encrypt', 'nip44_decrypt', 'get_relays',
]);

export interface Request {
  berm: typeof PROTOCOL;
  id: string;
  method: Method;
  params?: Record<string, unknown>;
  /** Required. What the user reads. See `explains()`. */
  human?: string;
  /** Optional registered-client identifier. Buys presentation, never permission. */
  appKey?: string;
}

export type ErrorCode =
  | 'declined'
  | 'no_session'
  | 'unsupported_method'
  | 'rejected_origin'
  | 'timeout'
  | 'malformed';

export interface Response {
  berm: typeof PROTOCOL;
  id: string;
  result?: unknown;
  error?: { code: ErrorCode; message?: string };
}

export function isRequest(v: unknown): v is Request {
  if (!v || typeof v !== 'object') return false;
  const r = v as Partial<Request>;
  return r.berm === PROTOCOL && typeof r.id === 'string' && typeof r.method === 'string';
}

export function ok(id: string, result: unknown): Response {
  return { berm: PROTOCOL, id, result };
}

export function err(id: string, code: ErrorCode, message?: string): Response {
  return { berm: PROTOCOL, id, error: { code, message } };
}

/**
 * Does `human` actually describe this request?
 *
 * The spec: "If it is missing, absent, or disagrees with what the request
 * actually does, the signer shows the raw event instead and says the application
 * did not explain itself. A prompt nobody can understand is not consent."
 *
 * We cannot check truthfulness — no one can. We check that a sentence exists, is
 * of a length a human would read, and is not the method name wearing a costume.
 * Everything else is shown raw alongside it, always, so the human sentence is a
 * courtesy on top of the evidence rather than a replacement for it.
 */
export function explains(human: unknown): human is string {
  if (typeof human !== 'string') return false;
  const s = human.trim();
  if (s.length < 8 || s.length > 280) return false;
  if (SUPPORTED.has(s)) return false;
  return /\s/.test(s);
}
