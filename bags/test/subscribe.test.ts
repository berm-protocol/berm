/**
 * The subscription format has to be right on the first subscriber.
 *
 * Everything else in this repo can be fixed by shipping a new version. This
 * cannot: a field missing from the signed event means going back to every
 * subscriber and asking again, and the ones who have drifted away never answer.
 *
 * So these assertions are about the things that are unfixable later — the
 * address being present and valid, membership surviving a wallet change, and
 * self-asserted time never ordering anybody.
 */

import { describe, it, expect } from 'vitest';
import {
  buildSubscription, parseSubscription, isValidSolanaAddress, snapshotMembers,
  describeForApproval, describeSnapshot, dTagFor, SUBSCRIBE_KIND,
  type Subscription,
} from '../src/subscribe.js';

// A real-shaped Solana address: 32 bytes, base58.
const SOL_A = 'So11111111111111111111111111111111111111112';
const SOL_B = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const NOW = 1_770_000_000;

const input = (over = {}) => ({
  campaign: 'berm-genesis', solanaAddress: SOL_A, createdAt: NOW, ...over,
});

describe('the payout address, which is the part that cannot be added later', () => {
  it('is a tag, not something parsed out of prose', () => {
    // Content is prose a client may render however it likes. An address
    // recovered by parsing a sentence is one rewording away from being lost.
    const ev = buildSubscription(input());
    expect(ev.tags).toContainEqual(['address', SOL_A]);
    expect(ev.tags).toContainEqual(['chain', 'solana']);
  });

  it('refuses to build an event naming an unpayable destination', () => {
    // Cheap to fix now. At payout time it is a token sent somewhere
    // unrecoverable, months after anyone was paying attention.
    for (const bad of ['', 'not-an-address', SOL_A.slice(0, 10), SOL_A + 'zzzz', '0xdeadbeef']) {
      expect(() => buildSubscription(input({ solanaAddress: bad }))).toThrow(/not a valid Solana address/);
    }
  });

  it('rejects the base58 characters that do not exist', () => {
    // 0, O, I and l are excluded from the alphabet precisely because they are
    // confusable, which is the case a typo actually produces.
    expect(isValidSolanaAddress(SOL_B.replace(/[1-9]/, '0'))).toBe(false);
    expect(isValidSolanaAddress(SOL_B.replace(/[a-z]/, 'l'))).toBe(false);
  });

  it('accepts real addresses', () => {
    expect(isValidSolanaAddress(SOL_A)).toBe(true);
    expect(isValidSolanaAddress(SOL_B)).toBe(true);
  });

  it('is not an Ethereum address wearing a hat', () => {
    expect(isValidSolanaAddress('0x71C7656EC7ab88b098defB751B7401B5f6d8976F')).toBe(false);
  });

  // Real, widely-known mainnet addresses. The first draft of the decoder passed
  // every synthetic fixture and rejected wrapped SOL — a false negative costs a
  // subscriber their place, so the fixtures have to be addresses that exist.
  it.each([
    ['wrapped SOL',    'So11111111111111111111111111111111111111112'],
    ['USDC',           'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'],
    ['USDT',           'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'],
    ['SPL Token prog', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'],
    ['System program', '11111111111111111111111111111111'],
  ])('accepts %s', (_name, addr) => {
    expect(isValidSolanaAddress(addr)).toBe(true);
  });

  it.each([
    ['one char short', 'So1111111111111111111111111111111111111111'],
    ['one char long',  'So111111111111111111111111111111111111111123'],
    ['bad alphabet',   'IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII'],
    ['contains zero',  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt10'],
  ])('rejects %s', (_name, addr) => {
    expect(isValidSolanaAddress(addr)).toBe(false);
  });
});

describe('what the signer shows before the user approves', () => {
  const text = describeForApproval(input());

  it('states the non-consequence: no money moves, in either direction', () => {
    expect(text).toMatch(/moves no money/);
    expect(text).toMatch(/no payment, now or later, in either direction/);
  });

  it('calls it a gift for showing up, not payment for work', () => {
    expect(text).toMatch(/gift for showing up early/);
    expect(text).toMatch(/not payment/);
    expect(text).toMatch(/not guaranteed to be worth anything/);
  });

  it('never predicts a price', () => {
    // Describing the mechanism is arithmetic. Predicting the outcome is a
    // financial promise, and it is the one sentence that would turn a
    // disclosure into the thing this project is trying not to be.
    expect(text).not.toMatch(/price|value will|worth more|moon|profit|return/i);
  });

  it('shows the address the user is committing to', () => {
    expect(text).toContain(SOL_A.slice(0, 8));
    expect(text).toContain(SOL_A.slice(-6));
  });

  it('travels with the event, not on a page nobody opened', () => {
    expect(buildSubscription(input()).content).toBe(text);
  });
});

describe('membership and payout address are different things', () => {
  it('is addressable, so a later event replaces the address', () => {
    const ev = buildSubscription(input());
    expect(ev.kind).toBe(SUBSCRIBE_KIND);
    expect(ev.tags).toContainEqual(['d', dTagFor('berm-genesis')]);
  });

  it('a wallet change does not cost the subscriber their place', () => {
    // The whole reason the address is replaceable. Conflating the two means
    // losing a wallet loses your position in a queue you already joined.
    const first: Subscription = {
      npub: 'npub1a', campaign: 'berm-genesis', solanaAddress: SOL_A, claimedAt: NOW,
    };
    const moved: Subscription = { ...first, solanaAddress: SOL_B, claimedAt: NOW + 90_000 };
    const snap = snapshotMembers([first, moved], 'berm-genesis');
    expect(snap.members).toEqual(['npub1a']);
    expect(snap.duplicates).toBe(1);
  });

  it('a subscription is not reusable across campaigns', () => {
    const s: Subscription = {
      npub: 'npub1a', campaign: 'other-launch', solanaAddress: SOL_A, claimedAt: NOW,
    };
    expect(snapshotMembers([s], 'berm-genesis').members).toEqual([]);
  });

  it('refuses an event whose d tag disagrees with its campaign', () => {
    const ev = buildSubscription(input());
    const tampered = { ...ev, tags: ev.tags.map((t) => (t[0] === 'd' ? ['d', dTagFor('elsewhere')] : t)) };
    expect(() => parseSubscription(tampered, 'npub1a')).toThrow(/d tag does not match/);
  });
});

describe('self-asserted time never orders anybody', () => {
  it('records claimedAt but sorts by npub, so the set is order-independent', () => {
    // Same lesson as dispute.ts: a party's own claim about timing is exactly
    // what is in dispute. Sorting by it would let a subscriber choose their
    // position in the list by choosing a number.
    const early: Subscription = { npub: 'npub1z', campaign: 'c', solanaAddress: SOL_A, claimedAt: 1 };
    const late: Subscription = { npub: 'npub1a', campaign: 'c', solanaAddress: SOL_B, claimedAt: 9_999_999_999 };

    const one = snapshotMembers([early, late], 'c');
    const other = snapshotMembers([late, early], 'c');

    expect(one.members).toEqual(other.members);
    expect(one.members).toEqual(['npub1a', 'npub1z']);       // by npub, not by time
    expect(one.members[0]).not.toBe('npub1z');               // the backdater did not win
  });

  it('still carries the claimed time, for display', () => {
    const ev = buildSubscription(input());
    expect(parseSubscription({ ...ev }, 'npub1a').claimedAt).toBe(NOW);
  });
});

describe('what the count does not prove', () => {
  it('reports shared payout addresses without judging them', () => {
    const a: Subscription = { npub: 'npub1a', campaign: 'c', solanaAddress: SOL_A, claimedAt: NOW };
    const b: Subscription = { npub: 'npub1b', campaign: 'c', solanaAddress: SOL_A, claimedAt: NOW };
    const snap = snapshotMembers([a, b], 'c');
    expect(snap.members).toHaveLength(2);
    expect(snap.sharedAddresses).toEqual([SOL_A]);
    expect(describeSnapshot(snap)).toMatch(/reported, not resolved/);
  });

  it('says out loud that a subscriber count is a count of keys', () => {
    const snap = snapshotMembers([], 'c');
    // "500 subscribers" invites a reading the data cannot support. Keys are free.
    expect(describeSnapshot(snap)).toMatch(/count of keys, not of people/);
    expect(describeSnapshot(snap)).toMatch(/proves nothing at all about how many humans/);
  });
});

describe('shape', () => {
  it('rejects campaign ids that would make a messy d tag', () => {
    for (const bad of ['', 'a', 'Has Capitals', 'trailing-', 'has_underscore', 'x'.repeat(40)]) {
      expect(() => buildSubscription(input({ campaign: bad }))).toThrow(/invalid campaign id/);
    }
  });

  it('carries an optional handle, stripped of its @', () => {
    const ev = buildSubscription(input({ handle: '@dorin' }));
    expect(ev.tags).toContainEqual(['handle', 'dorin']);
  });

  it('works without a handle — it is never required', () => {
    const ev = buildSubscription(input());
    expect(ev.tags.find((t) => t[0] === 'handle')).toBeUndefined();
    expect(parseSubscription(ev, 'npub1a').handle).toBeUndefined();
  });

  it('carries a NIP-31 alt so unknown-kind clients show something', () => {
    expect(buildSubscription(input()).tags.find((t) => t[0] === 'alt')?.[1])
      .toMatch(/Early subscriber record/);
  });
});
