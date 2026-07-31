/**
 * Recovery readiness.
 *
 * A recovery page that only helps AFTER a loss is half a page. By then the
 * options have already been decided — by what the person happened to have set
 * up months earlier, usually nothing.
 *
 * So the core of this is a check that answers one question:
 *
 *     "If you lost this device right now, what would happen?"
 *
 * and then lets you close each gap. Preparation is the product; the recovery
 * walkthroughs are the fallback for people who arrive too late.
 */

export type Severity = 'ok' | 'warn' | 'critical';

export interface Check {
  id: string;
  title: string;
  severity: Severity;
  /** What actually happens, in the second person, no hedging. */
  consequence: string;
  /** The fix, or null when nothing is needed. */
  action: string | null;
}

export interface IdentityState {
  npub: string | null;
  /** Enrolled credentials, including the deterministic primary. */
  deviceCount: number;
  /** Has the user confirmed an offline backup exists? */
  backupConfirmed: boolean;
  /** Guardians named in an anchored pre-commitment. */
  guardianCount: number;
  guardianThreshold: number;
  /** X handle claim, if any. */
  handle: string | null;
  /** Is the proof post archived? */
  proofArchived: boolean;
}

/**
 * Worst case if the current device disappears today.
 *
 * Deliberately blunt. A readiness check that softens the answer is worse than
 * no check, because it converts a warning into reassurance.
 */
export function assess(s: IdentityState): Check[] {
  const checks: Check[] = [];

  /* ---- devices ---- */
  if (s.deviceCount >= 2) {
    checks.push({
      id: 'devices',
      title: `${s.deviceCount} devices enrolled`,
      severity: 'ok',
      consequence:
        'Losing one device costs you nothing. Any other enrolled device unwraps the same identity.',
      action: null,
    });
  } else {
    checks.push({
      id: 'devices',
      title: 'Only one device enrolled',
      severity: s.backupConfirmed ? 'warn' : 'critical',
      consequence: s.backupConfirmed
        ? 'Platform passkeys sync within an ecosystem, so a broken phone is survivable. Losing the ' +
          'ecosystem account itself is not — you would be restoring from your backup file.'
        : 'Lose this device and its synced ecosystem account and your identity is gone permanently. ' +
          'There is no reset, no support queue, and nobody who can help.',
      action: 'Enrol a second device — ideally on a different ecosystem, since that is the gap ' +
              'passkey sync does not cover.',
    });
  }

  /* ---- backup ---- */
  checks.push(
    s.backupConfirmed
      ? {
          id: 'backup',
          title: 'Offline backup confirmed',
          severity: 'ok',
          consequence:
            'Even losing every device and every ecosystem account is recoverable from the keyfile.',
          action: null,
        }
      : {
          id: 'backup',
          title: 'No offline backup',
          severity: 'critical',
          consequence:
            'This is the only truly unrecoverable loss in the system. Everything else — articles, ' +
            'follows, pages — comes back from relays. The key does not.',
          action: 'Download an encrypted keyfile and store it somewhere that is not this device.',
        },
  );

  /* ---- guardians ---- */
  if (s.guardianCount >= s.guardianThreshold && s.guardianCount > 0) {
    checks.push({
      id: 'guardians',
      title: `${s.guardianCount} guardians, ${s.guardianThreshold} required`,
      severity: 'ok',
      consequence:
        'If your key is ever lost, your guardians can attest that a new one is you. That is social ' +
        'consensus rather than key recovery — it works because people choose to honour it.',
      action: null,
    });
  } else {
    checks.push({
      id: 'guardians',
      title: 'No guardians named',
      severity: 'warn',
      consequence:
        'If your key is lost, nobody can vouch that a replacement is you. A pre-commitment is only ' +
        'valid if it was anchored BEFORE the loss — so it cannot be added afterwards, when you ' +
        'would actually want it.',
      action: 'Name two or three people you trust. One signed event, published now.',
    });
  }

  /* ---- X claim ---- */
  if (!s.handle) {
    checks.push({
      id: 'claim',
      title: 'No X handle linked',
      severity: 'warn',
      consequence:
        'Nothing to lose here, but also nothing that proves the account was ever yours if someone ' +
        'takes the handle later.',
      action: 'Link your handle, with an archived proof.',
    });
  } else if (!s.proofArchived) {
    checks.push({
      id: 'claim',
      title: `@${s.handle} linked, proof not archived`,
      severity: 'warn',
      consequence:
        'Your proof post dies with the X account. The evidence would disappear at exactly the moment ' +
        'someone else holds the handle and is claiming to be you.',
      action: 'Archive the proof post. It takes about a minute and needs no credentials.',
    });
  } else {
    checks.push({
      id: 'claim',
      title: `@${s.handle} linked and archived`,
      severity: 'ok',
      consequence:
        'If X suspends the account you lose a badge, not a login, not a key, and not one byte of ' +
        'content. The archived proof outlives the account.',
      action: null,
    });
  }

  return checks;
}

export function worstCase(checks: Check[]): Severity {
  if (checks.some((c) => c.severity === 'critical')) return 'critical';
  if (checks.some((c) => c.severity === 'warn')) return 'warn';
  return 'ok';
}

/** One-line summary of what a total device loss costs today. */
export function verdict(s: IdentityState): string {
  if (!s.backupConfirmed && s.deviceCount < 2) {
    return 'If you lost this device today, your identity would be gone permanently.';
  }
  if (!s.backupConfirmed) {
    return 'You could recover from another device, but losing your ecosystem account would end it.';
  }
  if (s.deviceCount < 2) {
    return 'You could recover from your backup file. Everything depends on that one file existing.';
  }
  return 'You could recover from another device or from your backup. Nothing here is a single point of failure.';
}

/* ------------------------------------------------------------------ */
/* Loss triage                                                         */
/* ------------------------------------------------------------------ */

export type LossKind = 'x-account' | 'one-device' | 'all-devices' | 'everything';

export interface Path {
  title: string;
  recoverable: boolean;
  steps: string[];
  note?: string;
}

export function pathFor(kind: LossKind, s: IdentityState): Path {
  switch (kind) {
    case 'x-account':
      return {
        title: 'Your X account is gone. Your identity is not.',
        recoverable: true,
        steps: [
          'Sign in with your passkey — the identity never depended on X.',
          'Post a fresh proof from your new X account and archive it.',
          'Publish an updated profile: new claim in, dead claim OUT.',
        ],
        note:
          'Removing the old claim matters more than adding the new one. Abandoned handles get ' +
          're-registered, and a stale claim leaves your profile pointing at a stranger.',
      };

    case 'one-device':
      return {
        title: 'One device lost.',
        recoverable: true,
        steps: [
          'Sign in on another device — platform passkeys sync within an ecosystem.',
          s.deviceCount >= 2
            ? 'If it was a separate ecosystem, use the other enrolled device.'
            : 'If your passkey did not sync, restore from your backup keyfile.',
          'Enrol a replacement device so you are back to two.',
        ],
      };

    case 'all-devices':
      return {
        title: 'Every device gone.',
        recoverable: s.backupConfirmed,
        steps: s.backupConfirmed
          ? [
              'Get your encrypted keyfile and its passphrase.',
              'Import it here to restore the identity.',
              'Enrol a new device immediately, then download a fresh backup.',
            ]
          : [
              'Check every place a backup keyfile might be — downloads, cloud storage, a USB stick.',
              'If guardians were named BEFORE the loss, they can attest a new key is you.',
              'If neither exists, the identity cannot be recovered.',
            ],
        note: s.backupConfirmed
          ? undefined
          : 'This is the honest answer rather than a hopeful one. There is no reset and nobody to ask.',
      };

    case 'everything':
      return {
        title: 'Identity gone, no backup.',
        recoverable: s.guardianCount > 0,
        steps: s.guardianCount > 0
          ? [
              'Create a new identity.',
              `Ask your guardians to sign a rotation attestation — ${s.guardianThreshold} of ${s.guardianCount} are needed.`,
              'Publish it. Resolvers that honour guardian rotations will follow you to the new key.',
            ]
          : [
              'The key cannot be recovered. Nothing can restore it.',
              'Create a new identity and link your X handle to it afresh.',
              'Your published work still exists on relays under the old key — readable forever, but ' +
                'you can no longer sign as its author.',
            ],
        note:
          'Guardian rotation is social consensus, not key recovery. It works because relying ' +
          'parties choose to honour it, and only when the pre-commitment was anchored before the loss.',
      };
  }
}
