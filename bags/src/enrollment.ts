/**
 * The enrollment wire contract — v2, with an explicit execution mode.
 *
 * WHY THIS EXISTS, AND WHY IT WAS BLOCKING. Enrollment has two paths that mean
 * different things about where money goes:
 *
 *   Path A  the user arrived with nothing. We generated their key, and their EVM
 *           destination is DERIVED from that same key.
 *   Path B  the user arrived with an npub they already had. Their EVM destination
 *           is a wallet they SUPPLIED, and deriving one from their npub would
 *           silently point at an address they may never be able to open.
 *
 * The v1 event could not tell those apart. It carried an address tag, so the
 * only way to distinguish them was to guess from what was present — and the
 * dangerous guess is the quiet one: *"no address, so derive from the npub"*. For
 * an existing Nostr user that produces a plausible, fundable, unopenable address.
 *
 * So the mode is now **stated in the signed object** and is part of what the
 * signature covers. It cannot be inferred, defaulted, or repaired by a reader.
 *
 * FAIL CLOSED. Missing mode, unknown mode, a mode whose required evidence is
 * absent, or evidence that contradicts the mode — all rejected. A parser that
 * "does its best" with an ambiguous enrollment is a parser that decides where
 * someone's money goes, on its own authority, from data nobody signed.
 *
 * BOTH MODES REQUIRE EVM CONTROL PROOF, and that is not symmetry for its own
 * sake. In Path A it proves the parity normalisation actually happened — that
 * the secret the user exported controls the address we committed. In Path B it
 * proves the wallet is theirs rather than a string they pasted. Different
 * question, same evidence, and neither is optional.
 */

/* ------------------------------------------------------------------ */

export const ENROLL_KIND = 30078;
export const ENROLL_D_PREFIX = 'berm:enroll:v2';

/**
 * The execution mode. Versioned, because the day one of these needs different
 * evidence it must be a NEW token rather than a redefinition — an old signed
 * event has to keep meaning what it meant when it was signed.
 */
export const EXECUTION_MODES = ['derived_v1', 'bound_wallet_v1'] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

/** Campaign ids ride in a `d` tag, so keep them boring and unambiguous. */
const CAMPAIGN_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
/** 65-byte ECDSA signature, 0x-prefixed. */
const SIG_RE = /^0x[0-9a-fA-F]{130}$/;

export class EnrollmentError extends Error {
  constructor(msg: string) { super(msg); this.name = 'EnrollmentError'; }
}

export const dTagFor = (campaign: string) => `${ENROLL_D_PREFIX}:${campaign}`;

/* ------------------------------------------------------------------ */

export interface EnrollmentInput {
  campaign: string;
  mode: ExecutionMode;
  /** The destination. For `derived_v1` this MUST equal the address derived from the npub. */
  evmAddress: string;
  /**
   * ECDSA signature over `controlMessage()`, proving the EVM key is held.
   *
   * `derived_v1`  — made by the normalised generated secret. Proves the exported
   *                 secret controls the committed address, which is the whole
   *                 point of normalising at generation.
   * `bound_wallet_v1` — made by the user's ordinary wallet. Proves they hold it.
   */
  evmProof: string;
  handle?: string;
  createdAt: number;
}

export interface Enrollment {
  npub: string;
  campaign: string;
  mode: ExecutionMode;
  evmAddress: string;
  evmProof: string;
  handle?: string;
  /** Self-asserted. Recorded, never used to order anybody — see `campaign.ts`. */
  claimedAt: number;
}

/**
 * The message the EVM key signs. One canonical string, both modes, so a
 * signature made for one campaign or one mode cannot be replayed into another.
 *
 * The mode is INSIDE the signed message as well as in the tags. A signature that
 * proves control under `bound_wallet_v1` must not be liftable into a
 * `derived_v1` enrollment, and binding the mode into the preimage is what stops
 * that at the cryptographic layer rather than the parsing layer.
 */
export function controlMessage(
  campaign: string,
  mode: ExecutionMode,
  npubHex: string,
  evmAddress: string,
): string {
  if (!HEX64_RE.test(npubHex)) {
    throw new EnrollmentError('npub must be 32 bytes of lowercase hex (x-only pubkey)');
  }
  if (!EVM_RE.test(evmAddress)) throw new EnrollmentError(`"${evmAddress}" is not an EVM address`);
  return [
    'berm.enroll.v2',
    campaign,
    mode,
    npubHex,
    evmAddress.toLowerCase(),
  ].join('\n');
}

/* ---------- building ------------------------------------------------ */

export function buildEnrollment(input: EnrollmentInput): {
  kind: number; created_at: number; tags: string[][]; content: string;
} {
  if (!CAMPAIGN_RE.test(input.campaign)) {
    throw new EnrollmentError(
      `invalid campaign id "${input.campaign}" — lowercase letters, digits and hyphens, 3..32 chars`,
    );
  }
  if (!(EXECUTION_MODES as readonly string[]).includes(input.mode)) {
    throw new EnrollmentError(
      `unknown execution mode "${input.mode}" — must be one of ${EXECUTION_MODES.join(', ')}`,
    );
  }
  if (!EVM_RE.test(input.evmAddress)) {
    throw new EnrollmentError(
      `"${input.evmAddress}" is not an EVM address. Refusing to sign an enrollment that ` +
      `names an unpayable destination — cheap to fix now, unrecoverable later`,
    );
  }
  if (!SIG_RE.test(input.evmProof)) {
    throw new EnrollmentError(
      'evmProof must be a 65-byte ECDSA signature. Both modes require proof that the EVM ' +
      'key is held — for derived_v1 it proves the exported secret opens the committed ' +
      'address, for bound_wallet_v1 it proves the wallet is the user\'s',
    );
  }
  if (!Number.isInteger(input.createdAt) || input.createdAt <= 0) {
    throw new EnrollmentError('createdAt must be a positive integer (unix seconds)');
  }

  const tags: string[][] = [
    ['d', dTagFor(input.campaign)],
    ['campaign', input.campaign],
    ['mode', input.mode],
    ['chain', 'evm'],
    ['address', input.evmAddress.toLowerCase()],
    ['evm_proof', input.evmProof],
    ['alt', `Supporter enrollment for ${input.campaign}`],
  ];
  if (input.handle) tags.push(['handle', input.handle.replace(/^@/, '')]);

  return {
    kind: ENROLL_KIND,
    created_at: input.createdAt,
    tags,
    content: describeForApproval(input),
  };
}

/* ---------- parsing, fail-closed ------------------------------------ */

interface Signedish {
  kind: number;
  created_at: number;
  tags: string[][];
  pubkey?: string;
}

/**
 * Read an enrollment back out of an event, refusing anything ambiguous.
 *
 * Every rejection below is a case where a lenient parser would have had to
 * INVENT the missing piece, and the invention decides a payout destination.
 */
export function parseEnrollment(ev: Signedish, npub: string): Enrollment {
  if (ev.kind !== ENROLL_KIND) {
    throw new EnrollmentError(`wrong kind ${ev.kind}, expected ${ENROLL_KIND}`);
  }

  // A repeated tag is ambiguity, not redundancy: two `mode` tags means two
  // different readers can reach two different conclusions about the same signed
  // object, which is the whole class of bug this contract exists to close.
  for (const name of ['mode', 'address', 'campaign', 'evm_proof', 'd', 'chain']) {
    if (ev.tags.filter((t) => t[0] === name).length > 1) {
      throw new EnrollmentError(`duplicate "${name}" tag — ambiguous, refusing to choose`);
    }
  }
  const tag = (name: string) => ev.tags.find((t) => t[0] === name)?.[1];

  const campaign = tag('campaign');
  if (!campaign || !CAMPAIGN_RE.test(campaign)) {
    throw new EnrollmentError('missing or invalid campaign tag');
  }
  if (tag('d') !== dTagFor(campaign)) {
    throw new EnrollmentError(`d tag does not match campaign "${campaign}"`);
  }

  const mode = tag('mode');
  if (mode === undefined) {
    throw new EnrollmentError(
      'missing execution mode. There is no default — an absent mode used to be read as ' +
      '"derive from the npub", which for an existing Nostr user names an address they ' +
      'may never be able to open',
    );
  }
  if (!(EXECUTION_MODES as readonly string[]).includes(mode)) {
    throw new EnrollmentError(
      `unknown execution mode "${mode}". Refusing to guess — a future mode means new ` +
      'evidence rules, and this reader does not know them',
    );
  }

  if (tag('chain') !== 'evm') throw new EnrollmentError(`unsupported chain "${tag('chain')}"`);

  const address = tag('address');
  if (!address || !EVM_RE.test(address)) {
    throw new EnrollmentError('missing or invalid EVM address');
  }
  const proof = tag('evm_proof');
  if (!proof || !SIG_RE.test(proof)) {
    throw new EnrollmentError(
      `mode "${mode}" requires evm_proof, and it is missing or malformed. Both modes ` +
      'require EVM control proof; neither is exempt',
    );
  }

  return {
    npub,
    campaign,
    mode: mode as ExecutionMode,
    evmAddress: address.toLowerCase(),
    evmProof: proof,
    ...(tag('handle') ? { handle: tag('handle')! } : {}),
    claimedAt: ev.created_at,
  };
}

/* ---------- the mode-specific check --------------------------------- */

export interface ModeCheck {
  ok: boolean;
  reason: string;
}

/**
 * Verify the enrollment is internally consistent for its declared mode.
 *
 * Separate from parsing because it needs the derivation, which is the caller's
 * to supply — and because a parser that silently performed cryptography would be
 * doing work nobody asked it to audit.
 *
 * @param deriveAddress  npub hex → the canonical derived EVM address, or null if
 *                       the caller cannot derive (in which case `derived_v1`
 *                       cannot be validated and must NOT be assumed valid).
 * @param recoverSigner  (message, signature) → the recovered EVM address.
 */
export function checkMode(
  e: Enrollment,
  npubHex: string,
  deriveAddress: (npubHex: string) => string | null,
  recoverSigner: (message: string, signature: string) => string | null,
): ModeCheck {
  const msg = controlMessage(e.campaign, e.mode, npubHex, e.evmAddress);
  const signer = recoverSigner(msg, e.evmProof);

  if (!signer) {
    return { ok: false, reason: 'evm_proof does not recover to any address' };
  }
  if (signer.toLowerCase() !== e.evmAddress.toLowerCase()) {
    return {
      ok: false,
      reason:
        `evm_proof recovers to ${signer.toLowerCase()} but the enrollment commits ` +
        `${e.evmAddress}. The signature proves control of a DIFFERENT address`,
    };
  }

  if (e.mode === 'derived_v1') {
    const derived = deriveAddress(npubHex);
    if (!derived) {
      return {
        ok: false,
        reason:
          'mode derived_v1 could not be validated because no derivation was supplied. ' +
          'Unvalidated is not valid',
      };
    }
    if (derived.toLowerCase() !== e.evmAddress.toLowerCase()) {
      return {
        ok: false,
        reason:
          `mode derived_v1 commits ${e.evmAddress} but this npub derives to ` +
          `${derived.toLowerCase()}. Either the parity normalisation did not happen, or ` +
          'this is a bound wallet wearing the wrong mode',
      };
    }
    return { ok: true, reason: 'derived_v1: address derives from the npub and the same key signed it' };
  }

  // bound_wallet_v1 — a wallet the user supplied and proved control of.
  //
  // An earlier revision rejected this mode when the committed address happened
  // to equal derive(npub). That rule is GONE, and deliberately (G-02): the
  // control proof is what carries the security, and the mode label carries
  // provenance. Refusing a proven binding because of a numeric coincidence is a
  // false positive that locks out a legitimate user.
  //
  // The residue is real but it is not a validator's problem. A Path-B user is
  // never told to back up a key, so a Path-B user standing on a derived address
  // has not been told what they are holding. That is a DISCLOSURE duty, owed in
  // the UI copy before signing — not a rejection owed here, after.
  return { ok: true, reason: 'bound_wallet_v1: the committed wallet signed for itself' };
}

/* ---------- what the user is shown before signing -------------------- */

const MODE_WORDS: Record<ExecutionMode, string> = {
  derived_v1:
    'This address is computed from the key you just created. The key you downloaded ' +
    'is the only thing that opens it.',
  bound_wallet_v1:
    'This is the wallet you connected. Your Nostr key is not involved in spending it, ' +
    'and stays where it already lives.',
};

export function describeForApproval(i: EnrollmentInput): string {
  return [
    `Enroll in campaign "${i.campaign}".`,
    '',
    `Destination: ${i.evmAddress}`,
    MODE_WORDS[i.mode],
    '',
    'This records your place and where a payout would go. It moves no funds and buys ',
    'nothing. You can change the destination until the cohort list is finalised; after ',
    'that it is fixed, because it is inside the published commitment.',
  ].join('\n');
}
