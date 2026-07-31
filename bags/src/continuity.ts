/**
 * Fee continuity — the actual integration.
 *
 * THE PROBLEM. Bags binds a fee claim to a social handle. Handles are mutable:
 * they get renamed, abandoned, suspended, and re-registered by strangers. So a
 * revenue stream is anchored to a string somebody else can eventually own.
 *
 * Three ways that goes wrong, none exotic:
 *
 *   renamed      the creator changes @alice to @alice_eth; the old binding is
 *                now either dead or pointing at whoever takes @alice
 *   suspended    the creator cannot demonstrate the handle was theirs, because
 *                the proof lived on the account that is gone
 *   re-registered  someone else holds @alice and has a plausible claim to a
 *                revenue stream they did not earn
 *
 * THE FIX, and it is not a new mechanism. The creator's durable identity is
 * their npub. The handle is a *claim* attached to it, with an archived proof
 * captured by a neutral third party BEFORE any dispute. So the chain becomes:
 *
 *   npub  ──verified claim──▶  @handle  ──Bags──▶  fee wallet
 *     └───────── archived proof, timestamped by a third party ────────┘
 *
 * When the handle dies, the npub and the archive survive. The creator can
 * demonstrate the binding existed, and can attest a replacement handle with the
 * same key.
 *
 * WHAT THIS MODULE DOES NOT DO: change anything on Bags' side. It cannot move a
 * fee wallet, cannot re-point a claim, and does not touch a chain. It produces
 * evidence and a machine-readable continuity record. Whether Bags honours it is
 * Bags' decision — the same honest limit as guardian rotation.
 */

import type { FeeClaimer, ResolvedClaimer, SocialProvider, WalletResolver } from './bags.js';

/** A verified X↔npub binding, as produced by the link flow. */
export interface IdentityBinding {
  npub: string;
  provider: SocialProvider;
  username: string;
  /** State from the node's server-side check. Only `verified` is load-bearing. */
  state: 'verified' | 'claimed' | 'unlinked';
  /** URL of the proof post on the platform. */
  proofUrl?: string;
  /** Third-party capture of the proof. This is what survives the account. */
  archiveUrl?: string;
  /** Capture time in unix seconds, AS REPORTED BY THE ARCHIVE. */
  archivedAt?: number;
  /** The platform's immutable numeric account id, if verified. */
  accountId?: string;
}

export type ContinuityStrength = 'anchored' | 'claim-only' | 'none';

export interface ContinuityRecord {
  npub: string;
  provider: SocialProvider;
  username: string;
  wallet: string | null;
  bps: number;
  strength: ContinuityStrength;
  /** Plain-English statement of what survives handle loss. */
  survives: string;
  /** What is missing, in the order worth fixing. */
  gaps: string[];
}

/**
 * How much of this binding survives the handle going away.
 *
 * Deliberately blunt, in the same spirit as the recovery readiness check: a
 * grading that softens the answer converts a warning into reassurance, and here
 * the thing at stake is somebody's revenue.
 */
export function assessContinuity(b: IdentityBinding): { strength: ContinuityStrength; gaps: string[] } {
  const gaps: string[] = [];

  if (b.state !== 'verified') {
    gaps.push('the handle claim is not verified — anyone can assert a handle they do not control');
  }
  if (!b.archiveUrl || !b.archivedAt) {
    gaps.push('the proof post is not archived — it dies with the account, exactly when it is needed');
  }
  if (!b.accountId) {
    gaps.push('no immutable account id recorded — a re-registered handle would be indistinguishable');
  }

  // Anchored requires all three: verified now, provable later, and pinned to an
  // identifier the platform cannot recycle.
  if (b.state === 'verified' && b.archiveUrl && b.archivedAt && b.accountId) {
    return { strength: 'anchored', gaps };
  }
  if (b.state === 'verified') return { strength: 'claim-only', gaps };
  return { strength: 'none', gaps };
}

const SURVIVES: Record<ContinuityStrength, string> = {
  anchored:
    'If the handle is lost, renamed or taken by someone else, you can still demonstrate — from an ' +
    'archive neither you nor the platform controls — that this key held it, and when.',
  'claim-only':
    'The claim is verified today but nothing outlives the account. If it is suspended, the proof ' +
    'disappears at the moment you would need it.',
  none:
    'Nothing here connects this fee share to a key you hold. If the handle changes hands, the new ' +
    'holder has as good a claim as you do.',
};

/**
 * Build the continuity record for one claimer.
 *
 * `wallet` is null when Bags does not resolve the handle. That is not an error
 * here — an unresolved handle with an anchored identity is a *better* position
 * than a resolved handle with no anchor, and the record should show that rather
 * than refusing to exist.
 */
export async function buildRecord(
  claimer: FeeClaimer,
  binding: IdentityBinding,
  resolve: WalletResolver,
): Promise<ContinuityRecord> {
  if (binding.provider !== claimer.provider || binding.username.toLowerCase() !== claimer.username.toLowerCase()) {
    throw new Error(
      `binding is for ${binding.provider}:${binding.username} but the claimer is ` +
      `${claimer.provider}:${claimer.username} — refusing to attach evidence to the wrong handle`,
    );
  }

  const wallet = await resolve(claimer.provider, claimer.username);
  const { strength, gaps } = assessContinuity(binding);

  return {
    npub: binding.npub,
    provider: claimer.provider,
    username: claimer.username,
    wallet,
    bps: claimer.bps,
    strength,
    survives: SURVIVES[strength],
    gaps,
  };
}

/** A signed, publishable statement of the binding. Kind 30078, Berm namespace. */
export const FEE_D_TAG = 'berm:fee-claim:v1';

export interface EventTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

/**
 * Publish the continuity record as a signed event.
 *
 * The point is the ORDERING. An attestation published while the creator
 * demonstrably controls the handle is evidence; one published after a dispute
 * begins is an assertion. Same rule as the guardian pre-commitment, and the same
 * caveat applies — `created_at` is chosen by the signer, so anything that must
 * withstand a hostile reading needs an external anchor.
 */
export function buildFeeClaimAttestation(
  record: ContinuityRecord,
  tokenMint?: string,
  now = Math.floor(Date.now() / 1000),
): EventTemplate {
  const tags: string[][] = [
    ['d', FEE_D_TAG],
    ['i', `${record.provider}:${record.username}`],
    ['platform', 'bags'],
    ['bps', String(record.bps)],
    ['strength', record.strength],
  ];
  if (record.wallet) tags.push(['wallet', record.wallet, 'solana']);
  if (tokenMint) tags.push(['mint', tokenMint, 'solana']);

  return {
    kind: 30078,
    created_at: now,
    tags,
    content: JSON.stringify({ survives: record.survives, gaps: record.gaps }),
  };
}

/** The approval prompt. Names the consequence, like every other one. */
export function describeFeeClaim(t: EventTemplate): string {
  const d = t.tags.find((x) => x[0] === 'd')?.[1];
  if (t.kind !== 30078 || d !== FEE_D_TAG) return `Sign a kind ${t.kind} event`;

  const handle = t.tags.find((x) => x[0] === 'i')?.[1]?.replace(/^[a-z]+:/, '@') ?? 'a handle';
  const bps = Number(t.tags.find((x) => x[0] === 'bps')?.[1] ?? 0);
  const pct = (bps / 100).toFixed(bps % 100 === 0 ? 0 : 2);

  return `Publish a public record linking ${handle} and this key to a ${pct}% fee share. ` +
         'This is evidence, not a transfer — it moves no funds and changes nothing on Bags.';
}

/**
 * Summarise a whole launch.
 *
 * Surfaces the number that matters: how much of the fee split is anchored to a
 * key rather than to a string somebody else can register.
 */
export function summarise(records: readonly ContinuityRecord[]): {
  anchoredBps: number;
  fragileBps: number;
  verdict: string;
} {
  const anchoredBps = records.filter((r) => r.strength === 'anchored').reduce((a, r) => a + r.bps, 0);
  const fragileBps = records.filter((r) => r.strength !== 'anchored').reduce((a, r) => a + r.bps, 0);

  const pct = (b: number) => (b / 100).toFixed(b % 100 === 0 ? 0 : 2);
  const verdict = fragileBps === 0
    ? `All ${pct(anchoredBps)}% of assigned fee share is anchored to a key. Handle loss costs nobody their revenue.`
    : `${pct(fragileBps)}% of fee share depends on a handle alone. If those accounts are lost or ` +
      `re-registered, the claim is contestable by whoever holds the name next.`;

  return { anchoredBps, fragileBps, verdict };
}
