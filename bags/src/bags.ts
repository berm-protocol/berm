/**
 * A typed model of the Bags fee-share resolution.
 *
 * STATUS: modelled from public documentation, not from observed behaviour. Every
 * shape here is a hypothesis until `probe.mjs` runs against the real API with a
 * key. Where the docs are silent, the code says so rather than guessing quietly.
 *
 * WHAT BAGS DOES, as documented: a token launch assigns fee shares in basis
 * points, and a claimer can be specified by SOCIAL HANDLE rather than by wallet.
 * The SDK resolves it:
 *
 *   sdk.state.getLaunchWalletV2({ provider: 'twitter', username: 'alice' })
 *   GET /token-launch/fee-share/wallet/v2
 *     → a Solana wallet address
 *
 * WHY THIS IS INTERESTING TO US: that is a binding from a MUTABLE HANDLE to a
 * claim on money. It is the same fragility as a NIP-39 claim — handles are
 * released and re-registered, accounts are suspended — except the stake is a
 * revenue stream rather than a badge.
 *
 * We do not know how Bags handles a renamed or re-registered handle. That is
 * question 1 in `probe.mjs`, and it should be answered before anyone builds on
 * the assumption either way.
 */

export type SocialProvider = 'twitter' | 'kick' | 'github';

/** Basis points. The docs state creator + all claimers must total exactly 10000. */
export const TOTAL_BPS = 10_000;

export interface FeeClaimer {
  provider: SocialProvider;
  username: string;
  bps: number;
}

export interface ResolvedClaimer extends FeeClaimer {
  /** Solana address the share is payable to. */
  wallet: string;
}

export class BagsError extends Error {
  constructor(msg: string) { super(msg); this.name = 'BagsError'; }
}

/** The handle resolved to nothing — not onboarded, or does not exist. */
export class UnresolvedHandleError extends BagsError {
  readonly provider: SocialProvider;
  readonly username: string;
  constructor(provider: SocialProvider, username: string) {
    super(`${provider}:${username} does not resolve to a fee wallet`);
    this.provider = provider;
    this.username = username;
  }
}

/**
 * The one call we depend on, isolated behind an interface.
 *
 * Injected rather than imported so the whole bridge is testable offline and
 * without an API key — and so a change in Bags' surface touches one file.
 */
export type WalletResolver = (
  provider: SocialProvider,
  username: string,
) => Promise<string | null>;

/**
 * Validate a fee split before it is ever sent anywhere.
 *
 * Checked locally because the failure mode is expensive: the docs say the sum
 * must be exactly 10000, and discovering that from a rejected mainnet
 * transaction costs real money and a confused user.
 */
export function assertValidSplit(creatorBps: number, claimers: readonly FeeClaimer[]): void {
  const all = [creatorBps, ...claimers.map((c) => c.bps)];
  for (const bps of all) {
    if (!Number.isInteger(bps) || bps < 0 || bps > TOTAL_BPS) {
      throw new BagsError(`invalid bps value ${bps} — must be an integer in 0..${TOTAL_BPS}`);
    }
  }
  const sum = all.reduce((a, b) => a + b, 0);
  if (sum !== TOTAL_BPS) {
    throw new BagsError(`fee split totals ${sum} bps, must be exactly ${TOTAL_BPS}`);
  }

  const seen = new Set<string>();
  for (const c of claimers) {
    const key = `${c.provider}:${c.username.toLowerCase()}`;
    // Two entries for one handle is either a mistake or an attempt to inflate a
    // share past what a reviewer would notice. Refuse rather than sum them.
    if (seen.has(key)) throw new BagsError(`duplicate fee claimer ${key}`);
    seen.add(key);
  }
}

export interface ResolveResult {
  resolved: ResolvedClaimer[];
  unresolved: FeeClaimer[];
}

/**
 * Resolve every claimer, reporting failures rather than throwing on the first.
 *
 * A launch with one unresolvable claimer should show the operator exactly which
 * one, not fail with a single error and make them bisect the list.
 */
export async function resolveClaimers(
  claimers: readonly FeeClaimer[],
  resolve: WalletResolver,
): Promise<ResolveResult> {
  const resolved: ResolvedClaimer[] = [];
  const unresolved: FeeClaimer[] = [];

  for (const c of claimers) {
    const wallet = await resolve(c.provider, c.username);
    if (wallet) resolved.push({ ...c, wallet });
    else unresolved.push(c);
  }
  return { resolved, unresolved };
}
