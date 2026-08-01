/**
 * Two people claim the same handle. One fee share. Who does an operator believe?
 *
 * THIS IS THE PRODUCT. Everything else in this package prepares evidence; this
 * is the moment the evidence is worth having or it is decoration.
 *
 * The scenario is not exotic. A creator launches under `@alice`, the account is
 * suspended or renamed or abandoned, `@alice` becomes available, somebody else
 * registers it, and now two parties have a story about a revenue stream. Bags
 * resolves a fee claim from a handle string, so today the platform's only input
 * is *who holds the handle right now* — which is precisely the fact that changed.
 *
 * WHAT THIS DOES NOT DO, and the tests hold the line:
 *
 *   - It does not move money. It cannot. There is no wallet, no transaction and
 *     no chain call anywhere in this package.
 *   - It does not declare a winner. It ranks evidence and says what each side
 *     can and cannot demonstrate. An operator decides.
 *   - It does not manufacture confidence. Two claimants with equal evidence come
 *     back `unresolved`, because that is the true answer and a system that
 *     always produces a name is a system that sometimes produces the wrong one.
 *
 * THE ONE RULE THAT DECIDES MOST CASES. Evidence is worth what its *timestamp*
 * is worth, and a timestamp is worth what the party holding it does NOT control.
 * An archive captured by a neutral third party before the dispute existed beats
 * any assertion made after it, however sincere. A "proof" hosted by the claimant
 * proves only that the claimant can write files.
 */

import type { SocialProvider } from './bags.js';
import { assessContinuity, type ContinuityStrength, type IdentityBinding } from './continuity.js';

/* ------------------------------------------------------------------ */

/** One side of a dispute. */
export interface Claimant {
  /** Label for display. Never used in the comparison. */
  label: string;
  /** Their identity binding, if they have one at all. */
  binding: IdentityBinding | null;
  /**
   * When this party is first known to have held the handle, unix seconds.
   *
   * For the incumbent this is their registration date; for a displaced creator
   * it is the archive capture. Undefined means "cannot say", which is a
   * materially different claim from "recently", and is scored as such.
   */
  heldFrom?: number;
  /** Whether the party holds the handle at this moment. */
  holdsNow: boolean;
}

/**
 * Hosts whose timestamps mean something in a dispute, because the claimant
 * cannot backdate them.
 *
 * Deliberately a short allowlist rather than a heuristic. "Looks like an
 * archive" is not a property a dispute can rest on, and the failure mode of a
 * clever guess here is handing someone else's revenue to a forger with a domain
 * name. Anything not on this list is treated as self-hosted — not rejected, but
 * worth nothing on its own.
 */
export const NEUTRAL_ARCHIVES = [
  'web.archive.org',
  'archive.org',
  'archive.ph',
  'archive.today',
] as const;

export function isNeutralArchive(url: string | undefined): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;                                  // not a URL is not an archive
  }
  // Exact host or a subdomain of one. `evil-archive.org.attacker.com` must not
  // match, which a bare `includes()` would happily allow.
  return NEUTRAL_ARCHIVES.some((a) => host === a || host.endsWith(`.${a}`));
}

export type Verdict =
  | 'demonstrable'      // one side can show a neutral, pre-dispute record
  | 'contested'         // both sides have something; the evidence does not separate them
  | 'unresolved';       // neither side can demonstrate anything an operator could act on

export interface Assessment {
  label: string;
  strength: ContinuityStrength;
  /** Evidence an operator can check without trusting either party. */
  neutralEvidence: boolean;
  /** Earliest neutrally-timestamped moment this party can point to. */
  provenSince: number | null;
  holdsNow: boolean;
  /** What this party can actually demonstrate, in plain words. */
  shows: string;
}

export interface DisputeResult {
  handle: string;
  provider: SocialProvider;
  bps: number;
  verdict: Verdict;
  /** Assessments in the order an operator should read them. Strongest first. */
  sides: Assessment[];
  /** The label of the side with demonstrable evidence, or null. */
  demonstrableBy: string | null;
  /** One line an operator can act on. */
  summary: string;
  /**
   * What Bags can see today, with no continuity record at all. Present so the
   * screen shows a comparison rather than a claim — the counterfactual is the
   * part that makes the rest mean anything.
   */
  withoutBerm: string;
}

/* ------------------------------------------------------------------ */

function assess(c: Claimant): Assessment {
  const b = c.binding;
  const strength = b ? assessContinuity(b).strength : 'none';
  const neutral = !!b && isNeutralArchive(b.archiveUrl) && typeof b.archivedAt === 'number';

  // `provenSince` is ONLY the archive timestamp. Not heldFrom, not the binding's
  // own claim about itself. A party's own assertion of when they got the handle
  // is exactly what is in dispute, so letting it set this field would let the
  // stronger story win instead of the stronger evidence.
  const provenSince = neutral ? b!.archivedAt! : null;

  let shows: string;
  if (neutral) {
    shows =
      `A third-party archive, captured before this dispute, showing this key published a proof ` +
      `for @${b!.username}. Neither party controls that archive or its timestamp.`;
  } else if (b && b.archiveUrl) {
    shows =
      `A proof post archived at a location this party could control. It carries no timestamp an ` +
      `operator can rely on, so it demonstrates capability rather than history.`;
  } else if (b && b.state === 'verified') {
    shows =
      `A verified claim as it stands today. It says nothing about who held the handle before now, ` +
      `which is the only question in a dispute.`;
  } else if (c.holdsNow) {
    shows = `Possession of the handle right now, and nothing else. This is what changed.`;
  } else {
    shows = `Nothing an operator could check without taking this party's word for it.`;
  }

  return { label: c.label, strength, neutralEvidence: neutral, provenSince, holdsNow: c.holdsNow, shows };
}

/**
 * Rank and judge.
 *
 * Ordering is by what can be *shown*, not by who holds the handle. Possession is
 * deliberately the weakest signal here: in every failure mode this package
 * exists for, the wrong party is the one holding it.
 */
export function adjudicate(
  handle: string,
  provider: SocialProvider,
  bps: number,
  claimants: Claimant[],
): DisputeResult {
  if (claimants.length < 2) {
    throw new Error('a dispute needs at least two claimants — one party is not a dispute');
  }

  const sides = claimants.map(assess).sort((x, y) => {
    if (x.neutralEvidence !== y.neutralEvidence) return x.neutralEvidence ? -1 : 1;
    // Earlier neutral evidence wins. Later capture cannot beat earlier capture,
    // or a forger would simply archive the page today and outrank the original.
    if (x.provenSince !== null && y.provenSince !== null) return x.provenSince - y.provenSince;
    if (x.strength !== y.strength) return x.strength === 'anchored' ? -1 : y.strength === 'anchored' ? 1 : 0;
    return 0;
  });

  const withNeutral = sides.filter((s) => s.neutralEvidence);

  let verdict: Verdict;
  let demonstrableBy: string | null = null;
  let summary: string;

  // Destructured with real guards rather than `!`. `noUncheckedIndexedAccess`
  // is on in this package precisely so that indexing an array cannot silently
  // become a runtime undefined, and suppressing it here would defeat it at the
  // one place where the output is somebody's revenue.
  const [best, runnerUp] = withNeutral;

  if (best && !runnerUp) {
    verdict = 'demonstrable';
    demonstrableBy = best.label;
    const when = new Date((best.provenSince ?? 0) * 1000).toISOString().slice(0, 10);
    summary =
      `${best.label} can demonstrate, from an archive captured ${when} by a party with no ` +
      `stake in this, that their key published a proof for @${handle}. No other claimant can show ` +
      `anything of that kind. This is evidence, not a transfer — acting on it is Bags' decision.`;
  } else if (best && runnerUp) {
    // Two neutral archives. The earlier one is better evidence, but "better" is
    // not "conclusive", and saying otherwise here would be the exact overreach
    // this package refuses everywhere else.
    verdict = 'contested';
    const gap = Math.round(((runnerUp.provenSince ?? 0) - (best.provenSince ?? 0)) / 86_400);
    summary =
      `Both parties hold neutrally-timestamped evidence, ${best.label}'s earlier by ${gap} day(s). ` +
      `Earlier is stronger, but two independent archives is a genuine conflict and not something ` +
      `this record resolves on its own.`;
  } else {
    verdict = 'unresolved';
    summary =
      `Neither party can point to anything a third party timestamped. An operator has possession of ` +
      `the handle and two assertions, which is what they would have had anyway.`;
  }

  // No possessive on a label — these are descriptions ("Whoever holds @alice
  // now"), not names, and "Whoever holds @alice now's" is what that produces.
  const contested = sides.some((s) => s.holdsNow);
  const withoutBerm =
    `A fee-share lookup for @${handle} returns whatever wallet is bound to the handle today` +
    (contested ? ` — the wallet of whoever holds it right now.` : '.') +
    ` There is no field in that answer for who held it before, so the question this dispute turns ` +
    `on cannot be asked, let alone answered.`;

  return { handle, provider, bps, verdict, sides, demonstrableBy, summary, withoutBerm };
}
