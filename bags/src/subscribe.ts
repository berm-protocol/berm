/**
 * The subscription event: "I was here, and this is where to send it."
 *
 * THE DEADLINE. This format has to be right on the first subscriber, because
 * fixing it later means going back to everyone and asking again — and the ones
 * who have drifted away never answer. So the fields that are hard to add later
 * are all here from the start, even the ones nothing uses yet.
 *
 * THE PROBLEM IT SOLVES THAT IS EASY TO MISS. A Nostr identity is secp256k1 and
 * a Solana address is ed25519. An npub is NOT a Solana address and you cannot
 * send an SPL token to one. So a subscription has to carry BOTH, under a single
 * signature, or the payout list is a set of identities with nowhere to pay.
 *
 * TWO THINGS THAT MUST NOT BE THE SAME FIELD:
 *
 *   membership   who was early. Established once, snapshotted, never edited.
 *   payout       where to send. Current, replaceable, because people lose wallets.
 *
 * Conflating them means a subscriber who changes wallets loses their place in
 * the queue, and a subscriber who loses a wallet loses everything. So the event
 * is addressable (kind 30078 with a `d` tag) and the LATEST one gives the
 * address, while membership is fixed by the earliest snapshot that contains the
 * npub.
 *
 * AND THE ONE THIS PROJECT SHOULD ALREADY KNOW. `created_at` is set by whoever
 * signs. It is a claim about time made by the party whose timing is in dispute,
 * which is exactly what `dispute.ts` refuses to score. It is recorded here and
 * MUST NOT order anybody. Ordering comes from the published snapshots, which are
 * archived by a third party — the same argument, one layer down.
 */

/* ------------------------------------------------------------------ */

export const SUBSCRIBE_KIND = 30078;
export const SUBSCRIBE_D_PREFIX = 'berm:subscribe:v1';

/** Campaign ids are part of a `d` tag, so keep them boring and unambiguous. */
const CAMPAIGN_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

export interface SubscriptionInput {
  /** Which launch this is for. A subscription is never reusable across campaigns. */
  campaign: string;
  /** Where an eventual payout would go. Validated here, not at payout time. */
  solanaAddress: string;
  /**
   * The X handle this subscriber claims, if they have made one.
   *
   * Optional and never required. It does not make a subscription more valid — it
   * makes it harder to sybil, which is a different property and is reported
   * separately rather than folded into a single score.
   */
  handle?: string;
  createdAt: number;
}

export interface Subscription {
  npub: string;
  campaign: string;
  solanaAddress: string;
  handle?: string;
  /** Self-asserted. Recorded, displayed, and never used to order anyone. */
  claimedAt: number;
}

export class SubscriptionError extends Error {
  constructor(msg: string) { super(msg); this.name = 'SubscriptionError'; }
}

/* ---------- Solana address validation ------------------------------ */

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * A Solana address is 32 bytes, base58-encoded.
 *
 * Checked at SIGNING time rather than at payout time, deliberately. A typo
 * discovered at payout is a token sent somewhere unrecoverable, months after the
 * person who could have corrected it stopped paying attention.
 *
 * This validates the encoding and the length. It cannot tell you the key is one
 * somebody holds — nothing can, short of a signature from it — so the honest
 * limit is stated rather than papered over.
 */
export function isValidSolanaAddress(addr: string): boolean {
  if (typeof addr !== 'string' || addr.length < 32 || addr.length > 44) return false;

  // Decode base58 to a byte count. Rejecting by length alone would accept
  // strings that are the right length and not decodable.
  //
  // The accumulator starts EMPTY. A first draft seeded it with [0] and then
  // subtracted one at the end to compensate, which rejected every address whose
  // decoding happened not to need that slot — including wrapped SOL, one of the
  // most-used addresses on the chain. The test caught it because the fixture was
  // a real address rather than something shaped like one.
  const bytes: number[] = [];
  for (const ch of addr) {
    let carry = B58.indexOf(ch);
    if (carry < 0) return false;                   // excludes 0, O, I, l by design
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  // Leading '1's encode leading zero bytes, which the loop above cannot produce.
  for (const ch of addr) { if (ch === '1') bytes.push(0); else break; }
  return bytes.length === 32;
}

/* ---------- what the user actually sees ---------------------------- */

/**
 * The text the signer extension shows before the user approves.
 *
 * This is the only thing most subscribers will read, so it carries the whole
 * disclosure rather than deferring to a page they are not looking at. Same rule
 * as the publish approval sheet: the sentence describing consequences must be in
 * front of the button, not one click away from it.
 *
 * It describes the mechanism and refuses to predict the outcome. "Claiming buys
 * the token" is arithmetic. "So the price goes up" would be a financial promise,
 * and that single sentence is what would turn this from a disclosure into the
 * thing we are trying not to be.
 */
export function describeForApproval(input: SubscriptionInput): string {
  return [
    `Sign up as an early subscriber to "${input.campaign}".`,
    '',
    'What this does: publishes a signed, public record that this key was here, and',
    `names ${input.solanaAddress.slice(0, 8)}…${input.solanaAddress.slice(-6)} as where any future`,
    'distribution would be sent.',
    '',
    'What this does NOT do: it moves no money, buys nothing, and commits you to',
    'nothing. There is no payment, now or later, in either direction.',
    '',
    'If a distribution ever happens it is a gift for showing up early — not payment',
    'for work, not a promise, and not guaranteed to be worth anything at all.',
  ].join('\n');
}

/* ---------- build and parse ---------------------------------------- */

export interface EventTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

export function dTagFor(campaign: string): string {
  return `${SUBSCRIBE_D_PREFIX}:${campaign}`;
}

/**
 * Build the unsigned event.
 *
 * Everything load-bearing is a TAG rather than parsed out of content: tags are
 * indexed by relays and queryable, and content is prose that a client is free to
 * render however it likes. A payout address recovered by parsing a sentence is a
 * payout address one rewording away from being lost.
 */
export function buildSubscription(input: SubscriptionInput): EventTemplate {
  if (!CAMPAIGN_RE.test(input.campaign)) {
    throw new SubscriptionError(
      `invalid campaign id "${input.campaign}" — lowercase letters, digits and hyphens, 3..32 chars`,
    );
  }
  if (!isValidSolanaAddress(input.solanaAddress)) {
    throw new SubscriptionError(
      `"${input.solanaAddress}" is not a valid Solana address. Refusing to sign a subscription ` +
      `that names an unpayable destination — this is cheap to fix now and unrecoverable later`,
    );
  }
  if (!Number.isInteger(input.createdAt) || input.createdAt <= 0) {
    throw new SubscriptionError('createdAt must be a positive integer (unix seconds)');
  }

  const tags: string[][] = [
    ['d', dTagFor(input.campaign)],
    ['campaign', input.campaign],
    ['chain', 'solana'],
    ['address', input.solanaAddress],
    // NIP-31: something for a client that does not understand this kind to show.
    ['alt', `Early subscriber record for ${input.campaign}`],
  ];
  if (input.handle) tags.push(['handle', input.handle.replace(/^@/, '')]);

  return {
    kind: SUBSCRIBE_KIND,
    created_at: input.createdAt,
    tags,
    content: describeForApproval(input),
  };
}

interface Signedish {
  kind: number;
  created_at: number;
  tags: string[][];
  pubkey?: string;
}

/** Read a subscription back out of an event, refusing anything malformed. */
export function parseSubscription(ev: Signedish, npub: string): Subscription {
  if (ev.kind !== SUBSCRIBE_KIND) {
    throw new SubscriptionError(`wrong kind ${ev.kind}, expected ${SUBSCRIBE_KIND}`);
  }
  const tag = (name: string) => ev.tags.find((t) => t[0] === name)?.[1];

  const campaign = tag('campaign');
  const address = tag('address');
  const chain = tag('chain');

  if (!campaign || !CAMPAIGN_RE.test(campaign)) throw new SubscriptionError('missing or invalid campaign tag');
  if (tag('d') !== dTagFor(campaign)) {
    // A `d` tag that disagrees with the campaign tag means replaceability is
    // pointing at a different record than the one this event describes.
    throw new SubscriptionError(`d tag does not match campaign "${campaign}"`);
  }
  if (chain !== 'solana') throw new SubscriptionError(`unsupported chain "${chain}"`);
  if (!address || !isValidSolanaAddress(address)) {
    throw new SubscriptionError('missing or invalid Solana address');
  }

  return {
    npub,
    campaign,
    solanaAddress: address,
    ...(tag('handle') ? { handle: tag('handle')! } : {}),
    claimedAt: ev.created_at,
  };
}

/* ---------- the membership set ------------------------------------- */

export interface Snapshot {
  campaign: string;
  /** npubs, sorted, deduplicated. The set, not the addresses. */
  members: string[];
  /** How many were dropped as duplicates of an npub already present. */
  duplicates: number;
  /**
   * Solana addresses claimed by more than one npub.
   *
   * Not an error and not filtered out. One person may legitimately point two
   * identities at one wallet, and a sybil will do the same — this cannot tell
   * them apart, so it reports the fact and refuses to judge it.
   */
  sharedAddresses: string[];
}

/**
 * Reduce subscriptions to the membership set for a campaign.
 *
 * ORDER IN, ORDER OUT — but not by `claimedAt`. The output is sorted by npub, so
 * the same set produces the same snapshot regardless of the order the events
 * arrived from relays, and the hash of it is stable. Sorting by a self-asserted
 * timestamp would let a subscriber choose their position in the list.
 */
export function snapshotMembers(subs: readonly Subscription[], campaign: string): Snapshot {
  const seen = new Set<string>();
  const byAddress = new Map<string, Set<string>>();
  let duplicates = 0;

  for (const s of subs) {
    if (s.campaign !== campaign) continue;
    if (seen.has(s.npub)) { duplicates++; continue; }
    seen.add(s.npub);

    if (!byAddress.has(s.solanaAddress)) byAddress.set(s.solanaAddress, new Set());
    byAddress.get(s.solanaAddress)!.add(s.npub);
  }

  const sharedAddresses = [...byAddress.entries()]
    .filter(([, npubs]) => npubs.size > 1)
    .map(([addr]) => addr)
    .sort();

  return { campaign, members: [...seen].sort(), duplicates, sharedAddresses };
}

/**
 * What a snapshot can and cannot prove, in the words a reader needs.
 *
 * Written out rather than left implicit because "N subscribers" invites a
 * reading the data does not support. N is a count of KEYS, and keys are free.
 */
export function describeSnapshot(s: Snapshot): string {
  const lines = [
    `${s.members.length} key(s) subscribed to "${s.campaign}".`,
    'That is a count of keys, not of people. Anyone can generate more keys for nothing,',
    'so this proves who was early and proves nothing at all about how many humans that is.',
  ];
  if (s.sharedAddresses.length) {
    lines.push(
      `${s.sharedAddresses.length} payout address(es) are named by more than one key. That is what` +
      ' one person with several keys looks like, and also what several people sharing a wallet' +
      ' looks like. It is reported, not resolved.',
    );
  }
  return lines.join(' ');
}
