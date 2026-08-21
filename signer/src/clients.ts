/**
 * Registered clients.
 *
 * An API key buys PRESENTATION, NOT PERMISSION. A registered origin gets a
 * display name so the approval reads "bermlaunch wants you to sign" instead of
 * "an unregistered site at https://… wants you to sign".
 *
 * An unregistered origin is NEVER BLOCKED. It is named, loudly. Blocking unknown
 * origins would make us the gatekeeper of who may ask a user for a signature,
 * and we would then be a permission system pretending to be infrastructure.
 * The user is the authority. We are furniture that tells the truth.
 */

export interface ClientIdentity {
  origin: string;
  name: string;
  registered: boolean;
}

const REGISTERED: Record<string, string> = {
  'https://bermlaunch.com': 'BermLaunch',
  'https://editor.xonly.ai': 'xonly editor',
  'https://xonly.ai': 'xonly',
};

export function identify(origin: string): ClientIdentity {
  const name = REGISTERED[origin];
  return name
    ? { origin, name, registered: true }
    : { origin, name: origin, registered: false };
}
