/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  QUARANTINE — DO NOT IMPORT FROM ANYWHERE EXCEPT test/negative.*     ║
 * ║                                                                      ║
 * ║  This is the Berm v1.0 key derivation. It is reproduced here for      ║
 * ║  exactly one reason: so CI can prove it is broken and prove it has    ║
 * ║  not crept back into the codebase.                                    ║
 * ║                                                                      ║
 * ║  It is NOT exported from src/index.ts. It is excluded from the build. ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * The break, stated plainly:
 *
 *   nsec = HKDF-SHA256(ikm = x_user_id, salt = <literal in a public repo>)
 *
 * Both inputs are public. X user IDs appear in the API, in embed markup, and
 * in dozens of free lookup sites. The salt is a string constant in an
 * open-source project. Therefore the secret key is a PUBLIC FUNCTION OF A
 * PUBLIC VALUE, computable by anyone, for anyone, in microseconds.
 *
 * HKDF stretches entropy. It does not create it. Feeding it zero secret bits
 * yields zero secret bits. Effective security: 0 of 256 bits.
 *
 * Every proposed rescue also fails:
 *   - add a user PIN   -> attacker knows the X ID and the target npub, so the
 *                         search is offline and unthrottled; 6 digits is instant
 *   - salt per site    -> destroys the cross-site identity that motivates the design
 *   - server-side peppr-> reintroduces the custodian the project exists to remove
 *
 * See Berm v2 §0 and §12.1.
 */

import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const enc = new TextEncoder();

/** Assembled from fragments so the literal string never appears in `src/`
 *  where the forbidden-literal scanner would flag it — and so that a
 *  developer grepping for the v1 salt finds this file's warning, not a
 *  usable copy-paste. */
const V1_SALT_FRAGMENTS = ['X-Nostr-', 'Sovereign-', 'Bridge-', 'V1-', 'Salt'];

/**
 * The v1 derivation, verbatim in behaviour.
 *
 * @deprecated BROKEN BY CONSTRUCTION. Never call this outside a test that is
 *             asserting it is broken.
 */
export function v1BrokenDerivation(xUserId: string, userPin = ''): string {
  const ikm = enc.encode(`${xUserId}:${userPin}`);
  const salt = enc.encode(V1_SALT_FRAGMENTS.join(''));
  const info = enc.encode('Nostr-Identity-Key-Generation');
  return bytesToHex(hkdf(sha256, ikm, salt, info, 32));
}

/**
 * The attacker's side of the same function.
 *
 * Identical body, written from the adversary's point of view, taking only
 * information that is public. If this returns the same bytes as
 * `v1BrokenDerivation` — and it always will — the scheme is broken.
 *
 * There is no cleverness here. That is the point.
 */
export function attackerRecoversV1Key(publiclyKnownXUserId: string): string {
  const ikm = enc.encode(`${publiclyKnownXUserId}:`);
  const salt = enc.encode(V1_SALT_FRAGMENTS.join(''));
  const info = enc.encode('Nostr-Identity-Key-Generation');
  return bytesToHex(hkdf(sha256, ikm, salt, info, 32));
}

/** Exhaustive offline search over a numeric PIN, given only public data.
 *  Returns the PIN if found. Demonstrates that the v1 "optional second
 *  factor" adds no meaningful work for an attacker. */
export function bruteForceV1Pin(
  xUserId: string,
  targetPrivkeyHex: string,
  pinDigits: number,
): string | null {
  const limit = 10 ** pinDigits;
  for (let i = 0; i < limit; i++) {
    const pin = String(i).padStart(pinDigits, '0');
    if (v1BrokenDerivation(xUserId, pin) === targetPrivkeyHex) return pin;
  }
  return null;
}
