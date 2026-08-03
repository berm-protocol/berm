/**
 * Schedule in, root out. The whole allocation, as one pure function.
 *
 * WHAT THIS SOLVES. A batched campaign needs to say who was in which batch. The
 * obvious answer — read `created_at` — is wrong for the reason `dispute.ts` and
 * `subscribe.ts` both already establish: that field is set by the signer, so it
 * is a claim about time made by exactly the party whose timing decides their
 * payout. Backdating would be free and undetectable.
 *
 * SO BATCH MEMBERSHIP COMES FROM OBSERVATION, NOT ASSERTION. At each batch close
 * you publish a snapshot of the set as it stood. Batch 1 is the first snapshot;
 * batch 2 is the second snapshot minus the first; and so on. Subscribers do not
 * un-subscribe, so each snapshot is a superset of the one before and the set
 * differences are exactly the batches.
 *
 * A backdated timestamp then gains nothing at all: you are in the batch where you
 * were first SEEN, and nothing you sign changes what was already published.
 *
 * WHAT IT COSTS, stated plainly. A subscription sitting on a relay nobody queried
 * is not in the snapshot. That is a real way to be unfairly late, and the defence
 * is coverage — query many relays, publish which ones, and report the signal that
 * would show it happening (see `claimedBeforeFirstSeen` below) rather than
 * pretending the case does not exist.
 *
 * NOTHING HERE LAUNCHES ANYTHING. There is no key, no transaction, no network
 * call. It reads public inputs and returns numbers a stranger can recompute.
 */

import { buildTree, type Entitlement } from './merkle.js';
import type { Subscription } from './subscribe.js';

/* ------------------------------------------------------------------ */

export const TOTAL_BPS = 10_000;

export interface BatchSpec {
  /** Shown to humans. "Before launch", "Launch to migration", … */
  label: string;
  /** This batch's share of the distributed pot, in basis points. */
  potBps: number;
  /**
   * The set as observed when this batch closed — npubs, from a published
   * snapshot. Order is irrelevant; membership is all that is read.
   */
  observed: readonly string[];
}

/**
 * Where anything the caps could not allocate ends up.
 *
 * Required, with no default, on purpose. It is a policy question and the code
 * refuses to have an opinion on it — but it also refuses to let it go
 * unstated, because an undeclared residue is a decision somebody makes later,
 * in public, under pressure, which is the situation the whole pre-commitment
 * exists to avoid.
 */
export type ResiduePolicy = 'next-campaign' | 'team' | 'unallocated';

export interface CampaignConfig {
  campaign: string;
  batches: readonly BatchSpec[];
  /** Base units to distribute across all batches. */
  totalBaseUnits: bigint;
  /**
   * Ceiling on any one subscriber's share, in basis points of the distributed
   * pot. A tiny first batch would otherwise hand two people ten percent each —
   * honest, deterministic, and guaranteed to be read as insiders.
   */
  perPersonCapBps: number;
  residue: ResiduePolicy;
}

export class CampaignError extends Error {
  constructor(msg: string) { super(msg); this.name = 'CampaignError'; }
}

/* ---------- batch assignment ---------------------------------------- */

export interface Assignment {
  /** npub → index into `batches`. */
  batchOf: Map<string, number>;
  /** Members per batch, sorted, in batch order. */
  members: string[][];
  /**
   * Subscriptions whose self-asserted time precedes the snapshot they first
   * appeared in.
   *
   * Reported, never acted on. Acting on it would resurrect backdating as a
   * strategy. A rising count means either people are trying it or relay
   * coverage is poor, and both are worth seeing rather than smoothing over.
   */
  claimedBeforeFirstSeen: number;
}

export function assignBatches(
  batches: readonly BatchSpec[],
  subs: readonly Subscription[] = [],
  snapshotClosedAt: readonly number[] = [],
): Assignment {
  if (batches.length === 0) throw new CampaignError('a campaign needs at least one batch');

  const batchOf = new Map<string, number>();
  const members: string[][] = [];

  for (let i = 0; i < batches.length; i++) {
    const seen: string[] = [];
    for (const npub of batches[i]!.observed) {
      // First snapshot an npub appears in wins. Later snapshots are supersets,
      // so re-appearances are expected and are not batch changes.
      if (batchOf.has(npub)) continue;
      batchOf.set(npub, i);
      seen.push(npub);
    }
    members.push(seen.sort());
  }

  let claimedBeforeFirstSeen = 0;
  for (const s of subs) {
    const b = batchOf.get(s.npub);
    if (b === undefined || b === 0) continue;
    const previousClose = snapshotClosedAt[b - 1];
    if (previousClose !== undefined && s.claimedAt < previousClose) claimedBeforeFirstSeen++;
  }

  return { batchOf, members, claimedBeforeFirstSeen };
}

/* ---------- allocation ---------------------------------------------- */

export interface BatchResult {
  label: string;
  potBps: number;
  members: string[];
  /** Base units each member of this batch receives. */
  each: bigint;
  /** True when the cap bound this batch rather than the pot. */
  capped: boolean;
  allocated: bigint;
  /** Carried into the next batch — from the cap, or from having no members. */
  carriedOut: bigint;
}

export interface CampaignResult {
  campaign: string;
  batches: BatchResult[];
  /** npub → base units. */
  amounts: Map<string, bigint>;
  allocated: bigint;
  /** Never allocated: capped-out excess with nowhere left to go, plus rounding. */
  residue: bigint;
  residuePolicy: ResiduePolicy;
  claimedBeforeFirstSeen: number;
  root: string;
  entitlements: Entitlement[];
}

/**
 * Compute every share.
 *
 * Batches are processed in order and anything a batch cannot use carries into
 * the next one — from the cap, or from a batch that drew nobody. Whatever the
 * last batch cannot use is residue, and where residue goes is `residuePolicy`,
 * which the caller has to state.
 */
export function allocate(
  config: CampaignConfig,
  assignment: Assignment,
  addressOf: ReadonlyMap<string, string>,
): CampaignResult {
  const { batches, totalBaseUnits, perPersonCapBps } = config;

  const sumBps = batches.reduce((a, b) => a + b.potBps, 0);
  if (sumBps > TOTAL_BPS) {
    throw new CampaignError(`batch pots total ${sumBps} bps, which is more than the pot`);
  }
  if (perPersonCapBps <= 0 || perPersonCapBps > TOTAL_BPS) {
    throw new CampaignError(`per-person cap ${perPersonCapBps} bps is outside 1..${TOTAL_BPS}`);
  }
  if (totalBaseUnits < 0n) throw new CampaignError('total cannot be negative');

  const capPerPerson = (totalBaseUnits * BigInt(perPersonCapBps)) / BigInt(TOTAL_BPS);
  const amounts = new Map<string, bigint>();
  const results: BatchResult[] = [];

  let carry = 0n;

  for (let i = 0; i < batches.length; i++) {
    const spec = batches[i]!;
    const members = assignment.members[i] ?? [];
    const pot = (totalBaseUnits * BigInt(spec.potBps)) / BigInt(TOTAL_BPS) + carry;

    if (members.length === 0) {
      // An empty batch keeps nothing. Its whole pot moves on rather than
      // sitting in a bucket with no owner.
      results.push({
        label: spec.label, potBps: spec.potBps, members: [],
        each: 0n, capped: false, allocated: 0n, carriedOut: pot,
      });
      carry = pot;
      continue;
    }

    const even = pot / BigInt(members.length);
    const capped = even > capPerPerson;
    const each = capped ? capPerPerson : even;
    const allocated = each * BigInt(members.length);

    for (const npub of members) amounts.set(npub, each);

    results.push({
      label: spec.label, potBps: spec.potBps, members,
      each, capped, allocated, carriedOut: pot - allocated,
    });
    carry = pot - allocated;
  }

  const allocated = [...amounts.values()].reduce((a, b) => a + b, 0n);

  const entitlements: Entitlement[] = [...amounts.entries()].map(([npub, amount]) => {
    const solanaAddress = addressOf.get(npub);
    if (!solanaAddress) {
      // Every entitlement needs somewhere payable. Discovering this at payout is
      // a transfer that cannot happen, months after anyone could fix it.
      throw new CampaignError(`no payout address recorded for ${npub}`);
    }
    // index 0 is a placeholder — buildTree assigns the real one after sorting.
    return { index: 0, npub, solanaAddress, amount };
  });

  return {
    campaign: config.campaign,
    batches: results,
    amounts,
    allocated,
    residue: totalBaseUnits - allocated,
    residuePolicy: config.residue,
    claimedBeforeFirstSeen: assignment.claimedBeforeFirstSeen,
    root: entitlements.length ? buildTree(entitlements).root : '',
    entitlements: entitlements.length ? buildTree(entitlements).entries : [],
  };
}

/** Schedule in, root out. */
export function buildCampaign(
  config: CampaignConfig,
  subs: readonly Subscription[],
  snapshotClosedAt: readonly number[] = [],
): CampaignResult {
  const addressOf = new Map<string, string>();
  // Latest subscription wins the address — the event is replaceable precisely so
  // that losing a wallet does not cost somebody their place.
  for (const s of [...subs].sort((a, b) => a.claimedAt - b.claimedAt)) {
    addressOf.set(s.npub, s.solanaAddress);
  }
  return allocate(config, assignBatches(config.batches, subs, snapshotClosedAt), addressOf);
}

/* ---------- what a reader is told ------------------------------------ */

const RESIDUE_WORDS: Record<ResiduePolicy, string> = {
  'next-campaign': 'stays in the vault, earmarked for the next campaign',
  team: 'goes to the team allocation',
  unallocated: 'stays in the vault, unallocated',
};

export function describeCampaign(r: CampaignResult): string {
  const lines = [`Campaign "${r.campaign}" — ${r.amounts.size} subscriber(s).`];

  for (const b of r.batches) {
    lines.push(
      b.members.length === 0
        ? `  ${b.label}: nobody. Its ${b.potBps / 100}% moved to the next batch.`
        : `  ${b.label}: ${b.members.length} member(s), ${b.each} base units each` +
          (b.capped ? ' (per-person cap reached — the excess moved on).' : '.'),
    );
  }

  if (r.residue > 0n) lines.push(`  Residue ${r.residue}: ${RESIDUE_WORDS[r.residuePolicy]}.`);

  if (r.claimedBeforeFirstSeen > 0) {
    lines.push(
      `  ${r.claimedBeforeFirstSeen} subscription(s) claim a time earlier than the snapshot they ` +
      `first appeared in. That is reported and not acted on — acting on a self-asserted timestamp ` +
      `is what would make backdating worth attempting. It can also mean a relay was not reachable.`,
    );
  }

  lines.push(`  Root ${r.root || '(none — no entitlements)'}`);
  return lines.join('\n');
}
