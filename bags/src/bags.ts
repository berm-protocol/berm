/**
 * A typed model of the Bags fee-share resolution.
 *
 * STATUS: checked field-by-field against Bags' published OpenAPI specification
 * (docs.bags.fm/api-reference/openapi.json). It is no longer "modelled from
 * prose". What remains unverified is BEHAVIOUR — what a renamed handle returns,
 * whether resolution requires prior onboarding — and `probe.mjs` is still the
 * only thing that can answer those.
 *
 * The spec check corrected four things, and the fourth is the one worth reading:
 *
 *   1. THE PATH WAS WRONG. We modelled `/token-launch/fee-share/wallet/v2`.
 *      The real path is `/agent/v2/fee-share-wallet`.
 *
 *   2. THE PROVIDER ENUM WAS TOO NARROW. We had three; the spec has eleven.
 *      A union that is a strict subset silently rejects valid input.
 *
 *   3. THERE IS A `chain` PARAMETER — `SOL` (default) or `EVM`. We did not know
 *      Bags resolved the same handle on two chains, which matters because one
 *      handle can point at two different wallets.
 *
 *   4. THE RESPONSE CARRIES `platformData.id` — the platform's own account
 *      identifier, returned with nothing but an API key. `continuity.ts` treats
 *      an immutable account id as one of three requirements for `anchored`, and
 *      we had assumed it was reachable only through X OAuth on a node. It is
 *      not. See PlatformData below for what it is and is not worth.
 *
 * AND A CORRECTION TO OUR OWN EVIDENCE. The README claimed this endpoint was
 * "verified" because a dummy key returned a clean 401 rather than a 404, which
 * we read as confirming the path. That inference was wrong: we were calling a
 * path that does not exist and still got 401, so authentication is evaluated
 * before routing and a 401 says nothing about the path. The check could not
 * have failed, which is precisely why it did not.
 */

/* ------------------------------------------------------------------ */

/**
 * Every provider the spec's enum accepts, verbatim and in spec order.
 *
 * Kept complete rather than trimmed to the ones we care about. A narrower union
 * prevents nothing — Bags still accepts the others — it only makes our types
 * reject input the API would have taken.
 */
export const PROVIDERS = [
  'apple', 'google', 'email', 'solana', 'twitter', 'tiktok',
  'kick', 'instagram', 'onlyfans', 'github', 'moltbook',
] as const;

export type SocialProvider = (typeof PROVIDERS)[number];

/** Providers where a handle is publicly re-assignable, so continuity is at risk. */
export const MUTABLE_HANDLE_PROVIDERS: readonly SocialProvider[] = [
  'twitter', 'tiktok', 'instagram', 'kick', 'github', 'onlyfans',
];

/** The chains Bags resolves a handle on. Default is SOL. */
export const CHAINS = ['SOL', 'EVM'] as const;
export type Chain = (typeof CHAINS)[number];

/* ------------------------------------------------------------------ */

export const API_BASE = 'https://public-api-v2.bags.fm/api/v1';
/**
 * VERIFIED AGAINST THE LIVE API with a real key, 2026-08-04. Returns 200 and a
 * wallet. The published OpenAPI spec says `/agent/v2/fee-share-wallet`; that path
 * returns a routed 404 on the live host. We changed a WORKING path to a broken
 * one on the strength of the spec, and shipped it. A published specification is
 * evidence about intent, not about deployment — where they disagree, the running
 * service wins, and only a request can tell you which is which.
 */
export const FEE_SHARE_WALLET_PATH = '/token-launch/fee-share/wallet/v2';
export const AUTH_HEADER = 'x-api-key';

/**
 * `provider: 'solana'` CASE-FOLDS THE ADDRESS. Do not use it to name a wallet.
 *
 * Observed live: `username=7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU` returns
 * `success: true` with `wallet` = `7xkxtg2cw87d97txjsdpbd5jbkhetqa83tzrujosgasu`.
 * The username is lowercased — correct for a social handle, catastrophic for
 * base58, which is case-sensitive.
 *
 * The lowercased string still decodes to 32 valid bytes, so nothing errors. It
 * is simply a DIFFERENT public key, one nobody holds a private key for. Fees
 * assigned to it are unrecoverable by anyone.
 *
 * There is no grinding around it: only 34 of the 58 base58 characters survive
 * lowercasing unchanged, so an all-lowercase-safe 44-character address occurs
 * about once in 10^10 derivations.
 *
 * Consequence for the distributor: **naming a PDA as the Bags fee claimer is not
 * established** through this path, and this path is the only public candidate.
 * It needs Bags to confirm a case-preserving route before any design depends on
 * it. Ask; do not test it with a live launch.
 */
export function solanaAddressIsCaseMangled(username: string): boolean {
  return username !== username.toLowerCase();
}

/** Spec: claimers must total exactly this, and there may be at most 100. */
export const TOTAL_BPS = 10_000;
export const MAX_CLAIMERS = 100;

export interface FeeClaimer {
  provider: SocialProvider;
  username: string;
  bps: number;
}

/**
 * The platform's own record of the account, as Bags returns it.
 *
 * `id` is the field that matters: unlike the username it is not re-assigned when
 * a handle is released. What it is NOT is a statement by the platform — it is
 * Bags' record of what the platform said, at some past moment this response does
 * not timestamp. That makes it useful corroboration and useless as a sole basis
 * for a claim, which is exactly how `continuity.ts` treats it.
 */
export interface PlatformData {
  id: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
}

export interface ResolvedClaimer extends FeeClaimer {
  /** base58 for SOL, 0x-prefixed for EVM. */
  wallet: string;
  chain: Chain;
  platformData?: PlatformData;
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
 * Injected rather than imported so the bridge is testable offline and without an
 * API key, and so a change in Bags' surface touches one file.
 */
export type WalletResolver = (
  provider: SocialProvider,
  username: string,
  chain?: Chain,
) => Promise<{ wallet: string; chain: Chain; platformData?: PlatformData } | null>;

/** Build the resolution URL. Exported so the probe and the tests cannot drift. */
export function feeShareWalletUrl(
  provider: SocialProvider,
  username: string,
  chain: Chain = 'SOL',
  base = API_BASE,
): string {
  if (provider === 'solana' && solanaAddressIsCaseMangled(username)) {
    // Refused rather than warned. The response to a mangled address is a clean
    // 200 with a plausible-looking wallet, so nothing downstream can notice.
    throw new BagsError(
      `provider 'solana' lowercases the username, and base58 is case-sensitive. ` +
      `"${username}" would resolve to "${username.toLowerCase()}" — a different, ` +
      `unowned public key that still decodes to 32 valid bytes. Fees sent there ` +
      `are unrecoverable. Use a social provider, or get a case-preserving route ` +
      `confirmed by Bags first.`,
    );
  }
  const u = new URL(base + FEE_SHARE_WALLET_PATH);
  u.searchParams.set('provider', provider);
  u.searchParams.set('username', username);
  u.searchParams.set('chain', chain);
  return u.toString();
}

/**
 * Validate a fee split before it is ever sent anywhere.
 *
 * Checked locally because the failure mode is expensive: the spec says the sum
 * must be exactly 10000, and discovering that from a rejected mainnet
 * transaction costs real money and a confused user.
 */
export function assertValidSplit(creatorBps: number, claimers: readonly FeeClaimer[]): void {
  if (claimers.length > MAX_CLAIMERS) {
    throw new BagsError(`${claimers.length} fee claimers — the spec allows at most ${MAX_CLAIMERS}`);
  }

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
  chain: Chain = 'SOL',
): Promise<ResolveResult> {
  const resolved: ResolvedClaimer[] = [];
  const unresolved: FeeClaimer[] = [];

  for (const c of claimers) {
    const r = await resolve(c.provider, c.username, chain);
    if (r?.wallet) resolved.push({ ...c, wallet: r.wallet, chain: r.chain, platformData: r.platformData });
    else unresolved.push(c);
  }
  return { resolved, unresolved };
}
