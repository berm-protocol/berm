/**
 * @berm/sdk — the `window.berm` surface.
 *
 * Sovereign identity for apps that on-ramp users from X.
 *
 * WHAT AN APP BUILT ON THIS DOES NOT HOLD: an X API key, an X developer app, a
 * rate limit, or any other revocable permission. There is nothing for a policy
 * change to take away, because there is nothing issued. The identity is a key
 * the user holds; the X handle is a claim the user published and archived.
 *
 * WHAT THIS DOES NOT GIVE YOU: distribution. X still decides who sees your
 * links. And anything you *write into* X still needs X's API and is still
 * revocable. Sovereignty keeps your users after a policy change; it does not
 * get you the audience. Both halves belong in your pitch.
 */

export type {
  EventTemplate, SignedEvent, Tier, Session, BindingInfo,
  PublishReceipt, ConnectOptions, XnsbSdk,
} from './types.js';

export {
  XnsbSdkError,
  UserDeclinedError,
  SignerUnavailableError,
  NoSignerError,
  DevSignerMisuseError,
  PublishRejectedError,
} from './errors.js';

export {
  type SetupOptions,
  type Availability,
  detect,
  setup,
  connect,
} from './connect.js';

export {
  DEFAULT_RELAYS,
  publishEvent,
  queryRelays,
  useWebSocketImplementation,
} from './relay.js';

export {
  type ProfileInfo,
  parseXClaim,
  profileFromEvent,
  fetchProfile,
} from './profile.js';

export { createNip07Signer, hasNip07 } from './backends/nip07.js';
export { createXnsbSigner, hasXnsbSigner, type XnsbSignerOptions } from './backends/berm-signer.js';
export { createNip46Signer, type Nip46Options } from './backends/nip46.js';
export { createDevSigner, isLocalOrigin, describeForApproval, type DevSignerOptions } from './backends/dev.js';

import { setup, type SetupOptions } from './connect.js';
import type { XnsbSdk } from './types.js';

/**
 * Install onto `window.berm` so mini-apps on a node page can find it without
 * importing anything.
 *
 * Refuses to clobber an existing `window.berm`. Two SDKs racing for the global
 * produces bugs that look like signer flakiness and are diagnosed in hours
 * rather than minutes.
 */
export function install(opts: SetupOptions = {}): XnsbSdk {
  const w = globalThis as { berm?: XnsbSdk };
  if (w.berm) return w.berm;
  const sdk = setup(opts);
  w.berm = sdk;
  return sdk;
}

export const VERSION = '0.1.0';
