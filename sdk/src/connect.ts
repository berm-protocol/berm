/**
 * Tier detection and selection.
 *
 * THE ORDERING RULE, and the reasoning behind it, because it is a product
 * decision disguised as a technical one:
 *
 *   1. NIP-07 extension, if present. The user already made a custody decision
 *      before they met us. Overriding it to push our own signer would be the
 *      behaviour we are supposedly building an alternative to.
 *   2. Berm passkey signer, when configured. The zero-friction path for the
 *      overwhelming majority who have never heard of Nostr.
 *   3. NIP-46 bunker, when the caller supplies a URI. Explicit by nature.
 *   4. Development signer, localhost only, and only when explicitly allowed.
 *
 * Never fall back silently between tiers *after* connecting. If a user's chosen
 * signer breaks, the app offers a retry; it does not quietly re-sign them into
 * a weaker custody model they did not pick.
 */

import { createNip07Signer, hasNip07 } from './backends/nip07.js';
import { createXnsbSigner, hasXnsbSigner, type XnsbSignerOptions } from './backends/berm-signer.js';
import { createNip46Signer, type Nip46Options } from './backends/nip46.js';
import { createDevSigner, isLocalOrigin, type DevSignerOptions } from './backends/dev.js';
import { NoSignerError } from './errors.js';
import type { Session, Tier, XnsbSdk } from './types.js';

export interface SetupOptions {
  relays?: string[];
  appName?: string;
  /** Enables tier 1 once you have a signer origin to point at. */
  signer?: Omit<XnsbSignerOptions, 'relays' | 'appName'>;
  /** Enables tier 2. */
  bunker?: Omit<Nip46Options, 'relays'>;
  /** Enables the dev signer. Ignored off localhost; throws if forced. */
  dev?: DevSignerOptions | true;
  /** Restrict to these tiers regardless of what is available. */
  allow?: Tier[];
}

export interface Availability {
  tier: Tier | 'dev';
  available: boolean;
  label: string;
  /** Why it is unavailable, when it is. */
  reason?: string;
}

/** What could sign here, right now. Show this on a connect screen instead of a
 *  single button that fails for reasons the user cannot see. */
export function detect(opts: SetupOptions = {}): Availability[] {
  const out: Availability[] = [
    hasNip07()
      ? { tier: 0, available: true, label: 'Browser extension' }
      : { tier: 0, available: false, label: 'Browser extension', reason: 'no NIP-07 extension found' },
    hasXnsbSigner(opts.signer)
      ? { tier: 1, available: true, label: 'Passkey' }
      : { tier: 1, available: false, label: 'Passkey', reason: 'no signer origin configured' },
    opts.bunker?.bunkerUri
      ? { tier: 2, available: true, label: 'Remote signer' }
      : { tier: 2, available: false, label: 'Remote signer', reason: 'no bunker URI supplied' },
  ];

  if (opts.dev) {
    out.push(isLocalOrigin()
      ? { tier: 'dev', available: true, label: 'Development key' }
      : { tier: 'dev', available: false, label: 'Development key', reason: 'not a local origin' });
  }
  return out;
}

function allowed(t: Tier, opts: SetupOptions): boolean {
  return !opts.allow || opts.allow.includes(t);
}

/**
 * Build the SDK for whichever signer is available.
 *
 * Returns the object without connecting — `connect()` must stay inside a user
 * gesture, or popup blockers eat tier 1.
 */
export function setup(opts: SetupOptions = {}): XnsbSdk {
  const tried: string[] = [];

  if (allowed(0, opts) && hasNip07()) return createNip07Signer(opts.relays);
  tried.push('nip07');

  if (allowed(1, opts) && hasXnsbSigner(opts.signer)) {
    return createXnsbSigner({
      ...opts.signer!,
      relays: opts.relays,
      appName: opts.appName,
    });
  }
  tried.push('berm-signer');

  if (allowed(2, opts) && opts.bunker?.bunkerUri) {
    return createNip46Signer({ ...opts.bunker, relays: opts.relays });
  }
  tried.push('nip46');

  if (opts.dev) {
    tried.push('dev');
    // Throws DevSignerMisuseError off localhost — deliberately, not silently.
    return createDevSigner({
      ...(opts.dev === true ? {} : opts.dev),
      relays: opts.relays,
    });
  }

  throw new NoSignerError(tried);
}

/**
 * Convenience: build, connect, return the session.
 *
 * Call it from a click handler. Everything here can prompt the user, and a
 * prompt outside a gesture is a prompt the browser suppresses.
 */
export async function connect(opts: SetupOptions = {}): Promise<{ sdk: XnsbSdk; session: Session }> {
  const sdk = setup(opts);
  const session = await sdk.connect({ preferred: undefined, appName: opts.appName });
  return { sdk, session };
}
