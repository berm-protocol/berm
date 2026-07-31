/**
 * Berm v2 §3.2.1 — origin isolation.
 *
 * WebAuthn credentials are bound to a Relying Party ID, which is a registered
 * domain. A passkey created at blog-a.com is unusable at blog-b.com. That is
 * the browser's guarantee, and it is why custody has to be centralised at one
 * signer origin rather than replicated per node.
 *
 * This module enforces the corollary in our own code: the derivation path
 * refuses to execute anywhere except the configured signer origin. A node that
 * bundles this module by mistake fails loudly instead of quietly minting a
 * second, node-scoped identity for the user.
 */

import { WrongOriginError } from './errors.js';

export interface OriginLike {
  readonly origin: string;
}

/**
 * Assert that we are running at the signer origin.
 *
 * @param expectedOrigin e.g. "https://signer.xonly.ai"
 * @param current        injectable for tests; defaults to globalThis.location
 */
export function assertSignerOrigin(
  expectedOrigin: string,
  current: OriginLike | undefined = (globalThis as any).location,
): void {
  const actual = current?.origin;
  if (typeof actual !== 'string' || actual.length === 0) {
    throw new WrongOriginError('<no origin>', expectedOrigin);
  }
  if (!constantTimeEquals(actual, expectedOrigin)) {
    throw new WrongOriginError(actual, expectedOrigin);
  }
}

/** Not security-critical here (origins are public), but avoids leaking a
 *  comparison-timing oracle if this helper is reused for secrets later. */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Derive the WebAuthn RP ID from a signer origin.
 * "https://signer.xonly.ai" -> "signer.xonly.ai"
 *
 * The RP ID is what scopes the passkey. Two different signer origins produce
 * two different RP IDs and therefore two different, non-interchangeable
 * identities — the property asserted by negative vector V5.
 */
export function rpIdFromOrigin(origin: string): string {
  const u = new URL(origin);
  if (u.protocol !== 'https:' && u.hostname !== 'localhost') {
    throw new WrongOriginError(origin, 'https:// (or localhost for development)');
  }
  return u.hostname;
}
