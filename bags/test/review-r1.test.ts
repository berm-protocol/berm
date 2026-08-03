/**
 * Reproductions for the R1 adversarial review of DISTRIBUTOR-SPEC.
 *
 * Every case here failed when it was written. They are kept because each one is
 * a property the review showed we were only assuming, and because the tests we
 * already had could not have caught any of them:
 *
 *   BDR-013b  the same events in a different order produced a DIFFERENT root
 *   BDR-009   production and the "independent" comparator disagree off ASCII
 *   BDR-011   reconcile() reported a mismatch while naming nothing
 *   BDR-010   verifyProof accepted a proof longer than any tree could produce
 *
 * The common shape is worth naming: all four passed the existing suite because
 * the fixtures were tidy. ASCII npubs, distinct timestamps, membership-only
 * differences, well-formed proofs. A test whose inputs are all well-behaved
 * proves the code handles well-behaved inputs.
 */

import { describe, it, expect } from 'vitest';
import { buildTree, proofFor, verifyProof, reconcile, distributeEqually } from '../src/merkle.js';
import { buildCampaign, type CampaignConfig } from '../src/campaign.js';
import type { Subscription } from '../src/subscribe.js';

const A = 'So11111111111111111111111111111111111111112';
const B = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

/* ------------------------------------------------------------------ */

describe('BDR-013b — equal timestamps must not let arrival order pick the address', () => {
  // THE ONE THAT MATTERS MOST. The entire claim is that a stranger fetching the
  // same subscriptions rebuilds the same root. Relays return events in arbitrary
  // order. If two subscriptions from one npub share a created_at, the winner was
  // decided by whichever arrived first — so two honest parties could publish two
  // different roots from identical data and each be certain the other was lying.

  const cfg = (): CampaignConfig => ({
    campaign: 'berm-genesis',
    batches: [{ label: 'only', potBps: 10_000, observed: ['npub1a'] }],
    totalBaseUnits: 1_000_000n,
    perPersonCapBps: 10_000,
    residue: 'unallocated',
  });

  const sameTime: Subscription[] = [
    { npub: 'npub1a', campaign: 'berm-genesis', solanaAddress: A, claimedAt: 500 },
    { npub: 'npub1a', campaign: 'berm-genesis', solanaAddress: B, claimedAt: 500 },
  ];

  it('produces the same root whichever order the relay returned them in', () => {
    const forwards = buildCampaign(cfg(), sameTime);
    const backwards = buildCampaign(cfg(), [...sameTime].reverse());
    expect(backwards.root).toBe(forwards.root);
  });

  it('and picks the same address', () => {
    const forwards = buildCampaign(cfg(), sameTime);
    const backwards = buildCampaign(cfg(), [...sameTime].reverse());
    expect(backwards.entitlements[0]!.solanaAddress).toBe(forwards.entitlements[0]!.solanaAddress);
  });

  it('breaks the tie on something in the data, not on arrival', () => {
    // Whatever rule is chosen must be a function of the events themselves.
    // Higher address wins is arbitrary but total, deterministic and stateless.
    const r = buildCampaign(cfg(), sameTime);
    expect(r.entitlements[0]!.solanaAddress).toBe(A > B ? A : B);
  });
});

describe('BDR-009 — the independent comparator must agree with production', () => {
  // The differential test compares roots across eight tree sizes and every
  // fixture is ASCII. Production sorts by UTF-16 code unit; the independent
  // implementation used localeCompare('en'). Those disagree the moment an
  // identifier is not plain ASCII — so the test proved agreement on exactly the
  // inputs where agreement was never in doubt.

  it('orders identically for inputs where localeCompare and code-unit order differ', () => {
    // localeCompare ignores case and diacritics at its default strength;
    // code-unit order does not. Uppercase sorts before lowercase in code units.
    const tricky = ['npub1Z', 'npub1a', 'npub1A', 'npub1z'];

    const production = [...tricky].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const locale = [...tricky].sort((a, b) => a.localeCompare(b, 'en'));

    // Demonstrate the two differ, so the assertion below is not vacuous.
    expect(locale).not.toEqual(production);

    // The tree must use the bytewise rule, and the root must be stable under it.
    const set = tricky.map((npub) => ({ index: 0, npub, solanaAddress: A, amount: 1n }));
    expect(buildTree(set).entries.map((e) => e.npub)).toEqual(production);
  });
});

describe('BDR-011 — a mismatch must name what actually differs', () => {
  // reconcile() diffed npub membership only, while the root commits index,
  // npub, destination AND amount. Change an address and the root moves while
  // both named sets stay empty — the diagnostic announces a discrepancy and
  // then points at nothing.

  const members = [
    { npub: 'npub1a', solanaAddress: A },
    { npub: 'npub1b', solanaAddress: A },
  ];

  it('reports a changed destination rather than two empty sets', () => {
    const moved = [{ npub: 'npub1a', solanaAddress: B }, members[1]!];
    const published = distributeEqually(moved, 1000n);
    const r = reconcile(published.root, published.entries, members, 1000n);

    expect(r.matches).toBe(false);
    expect(r.omitted).toEqual([]);
    expect(r.extra).toEqual([]);
    // The point: something must explain the mismatch.
    expect(r.changed.length).toBeGreaterThan(0);
    expect(r.changed[0]!.npub).toBe('npub1a');
    expect(r.summary).toMatch(/destination/i);
  });

  it('never claims a difference it cannot locate', () => {
    const published = distributeEqually(members, 1000n);
    const r = reconcile(published.root, published.entries, members, 1000n);
    expect(r.matches).toBe(true);
    expect(r.changed).toEqual([]);
  });
});

describe('BDR-010 — a proof longer than the tree could produce is not a proof', () => {
  // verifyProof folded any number of siblings. Not a known forgery against
  // SHA-256, but unbounded input into code whose Rust twin will run under a
  // compute budget, and an ambiguity two implementations can resolve differently.

  it('rejects a proof deeper than the tree', () => {
    const set = Array.from({ length: 4 }, (_, i) =>
      ({ index: 0, npub: `npub1${i}`, solanaAddress: A, amount: 1n }));
    const tree = buildTree(set);
    const entry = tree.entries[0]!;
    const proof = proofFor(tree, entry.npub);

    expect(verifyProof(entry, proof, tree.root)).toBe(true);
    // Depth for 4 leaves is 2. Padding it out must fail on length alone.
    expect(verifyProof(entry, [...proof, 'ab'.repeat(32), 'cd'.repeat(32)], tree.root)).toBe(false);
  });

  it('caps at the maximum depth the spec allows', () => {
    const set = [{ index: 0, npub: 'npub1a', solanaAddress: A, amount: 1n }];
    const tree = buildTree(set);
    const tooLong = Array.from({ length: 15 }, () => 'ab'.repeat(32));
    expect(verifyProof(tree.entries[0]!, tooLong, tree.root)).toBe(false);
  });
});
