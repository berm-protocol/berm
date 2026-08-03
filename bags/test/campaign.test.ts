/**
 * The allocation, and the two things it must never do.
 *
 * It must never let a self-asserted timestamp move somebody into an earlier
 * batch — that is backdating, and it would be free. And it must never quietly
 * decide where money goes when the caps leave a remainder, because a residue
 * nobody declared is a decision made later, in public, under pressure.
 */

import { describe, it, expect } from 'vitest';
import {
  buildCampaign, assignBatches, allocate, describeCampaign, CampaignError,
  type CampaignConfig, type BatchSpec,
} from '../src/campaign.js';
import type { Subscription } from '../src/subscribe.js';

const A = 'So11111111111111111111111111111111111111112';
const B = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

const POT = 1_000_000n;

const sub = (npub: string, claimedAt: number, addr = A): Subscription =>
  ({ npub, campaign: 'berm-genesis', solanaAddress: addr, claimedAt });

const batches = (b1: string[], b2: string[], b3: string[]): BatchSpec[] => [
  { label: 'Before launch', potBps: 2000, observed: b1 },
  { label: 'Launch to migration', potBps: 2000, observed: [...b1, ...b2] },
  { label: 'Until close', potBps: 2000, observed: [...b1, ...b2, ...b3] },
];

const config = (over: Partial<CampaignConfig> = {}): CampaignConfig => ({
  campaign: 'berm-genesis',
  batches: batches(['npub1a'], ['npub1b'], ['npub1c']),
  totalBaseUnits: POT,
  perPersonCapBps: 2000,
  residue: 'next-campaign',
  ...over,
});

describe('batch membership comes from observation, never from assertion', () => {
  it('assigns by the first snapshot an npub appears in', () => {
    const a = assignBatches(batches(['npub1a'], ['npub1b'], ['npub1c']));
    expect(a.batchOf.get('npub1a')).toBe(0);
    expect(a.batchOf.get('npub1b')).toBe(1);
    expect(a.batchOf.get('npub1c')).toBe(2);
  });

  it('a backdated timestamp does not buy an earlier batch', () => {
    // The whole reason assignment reads snapshots instead of created_at. This
    // subscriber claims to predate everything and still lands where they were
    // first seen, because nothing they sign changes what was already published.
    const liar = sub('npub1c', 1);
    const r = buildCampaign(config(), [sub('npub1a', 500), sub('npub1b', 600), liar], [400, 550, 700]);
    expect(r.batches[2]!.members).toContain('npub1c');
    expect(r.batches[0]!.members).not.toContain('npub1c');
  });

  it('but the attempt is counted and reported', () => {
    // Reported, never acted on. Acting on it is what would make backdating
    // worth trying in the first place.
    const r = buildCampaign(config(), [sub('npub1a', 500), sub('npub1b', 600), sub('npub1c', 1)], [400, 550, 700]);
    expect(r.claimedBeforeFirstSeen).toBe(1);
    expect(describeCampaign(r)).toMatch(/reported and not acted on/);
    expect(describeCampaign(r)).toMatch(/relay was not reachable/);
  });

  it('re-appearing in a later snapshot is not a batch change', () => {
    // Snapshots are supersets. Everyone in batch 1 appears in all of them.
    const a = assignBatches(batches(['npub1a'], ['npub1b'], []));
    expect(a.batchOf.get('npub1a')).toBe(0);
    expect(a.members[1]).toEqual(['npub1b']);
  });
});

describe('the per-person cap, and where the excess goes', () => {
  it('a tiny first batch does not hand two people ten percent each', () => {
    // Honest, deterministic, and it would be read as insiders forever.
    const r = buildCampaign(
      config({ batches: batches(['npub1a', 'npub1b'], [], []), perPersonCapBps: 200 }),
      [sub('npub1a', 1), sub('npub1b', 2)],
    );
    expect(r.batches[0]!.capped).toBe(true);
    expect(r.batches[0]!.each).toBe(POT * 200n / 10_000n);          // 2% each
    expect(r.batches[0]!.carriedOut).toBeGreaterThan(0n);
  });

  it('carries the excess into the next batch', () => {
    const r = buildCampaign(
      config({ batches: batches(['npub1a'], ['npub1b'], []), perPersonCapBps: 200 }),
      [sub('npub1a', 1), sub('npub1b', 2)],
    );
    // Batch 1 could take only 2%; batch 2 receives its own pot plus the rest.
    expect(r.batches[0]!.carriedOut).toBe(POT * 1800n / 10_000n);
    expect(r.batches[1]!.each).toBe(POT * 200n / 10_000n);           // also capped
  });

  it('an empty batch keeps nothing and passes its whole pot on', () => {
    const r = buildCampaign(
      config({ batches: batches([], ['npub1b'], []), perPersonCapBps: 10_000 }),
      [sub('npub1b', 2)],
    );
    expect(r.batches[0]!.members).toEqual([]);
    expect(r.batches[0]!.allocated).toBe(0n);
    expect(r.batches[0]!.carriedOut).toBe(POT * 2000n / 10_000n);
    expect(describeCampaign(r)).toMatch(/nobody\. Its 20% moved to the next batch/);
  });

  it('never allocates more than the pot, at any shape', () => {
    for (const cap of [50, 200, 1000, 10_000]) {
      for (const sizes of [[1, 1, 1], [5, 0, 20], [0, 0, 3], [50, 100, 500]]) {
        const mk = (p: string, n: number) => Array.from({ length: n }, (_, i) => `npub1${p}${i}`);
        const [b1, b2, b3] = [mk('a', sizes[0]!), mk('b', sizes[1]!), mk('c', sizes[2]!)];
        const subs = [...b1, ...b2, ...b3].map((n, i) => sub(n, i + 1));
        const r = buildCampaign(config({ batches: batches(b1, b2, b3), perPersonCapBps: cap }), subs);
        expect(r.allocated).toBeLessThanOrEqual(POT);
        expect(r.allocated + r.residue).toBe(POT);
      }
    }
  });
});

describe('the residue is declared, never decided quietly', () => {
  it('reports what is left and what was declared about it', () => {
    const r = buildCampaign(
      config({ batches: batches(['npub1a'], [], []), perPersonCapBps: 100, residue: 'next-campaign' }),
      [sub('npub1a', 1)],
    );
    expect(r.residue).toBeGreaterThan(0n);
    expect(describeCampaign(r)).toMatch(/earmarked for the next campaign/);
  });

  it('says something different when a different policy was declared', () => {
    const r = buildCampaign(
      config({ batches: batches(['npub1a'], [], []), perPersonCapBps: 100, residue: 'team' }),
      [sub('npub1a', 1)],
    );
    expect(describeCampaign(r)).toMatch(/goes to the team allocation/);
  });

  it('every declared policy renders as words, never as a bare enum', () => {
    // A reader should not have to know what 'next-campaign' means. And an
    // undeclared one must never surface as the string "undefined" next to money.
    for (const policy of ['next-campaign', 'team', 'unallocated'] as const) {
      const r = buildCampaign(
        config({ batches: batches(['npub1a'], [], []), perPersonCapBps: 100, residue: policy }),
        [sub('npub1a', 1)],
      );
      const text = describeCampaign(r);
      expect(text).not.toMatch(/undefined/);
      expect(text).toMatch(/Residue \d+:/);
    }
  });
});

describe('refusals', () => {
  it('batch pots cannot exceed the pot', () => {
    const over = [
      { label: 'a', potBps: 6000, observed: ['npub1a'] },
      { label: 'b', potBps: 6000, observed: ['npub1a', 'npub1b'] },
    ];
    expect(() => buildCampaign(config({ batches: over }), [sub('npub1a', 1), sub('npub1b', 2)]))
      .toThrow(/more than the pot/);
  });

  it('an out-of-range cap is refused', () => {
    for (const cap of [0, -1, 10_001]) {
      expect(() => buildCampaign(config({ perPersonCapBps: cap }), [sub('npub1a', 1)]))
        .toThrow(/outside/);
    }
  });

  it('refuses an entitlement with nowhere payable', () => {
    // Discovering this at payout is a transfer that cannot happen, months after
    // the person who could have fixed it stopped paying attention.
    expect(() => allocate(
      config(),
      assignBatches(batches(['npub1a'], [], [])),
      new Map(),
    )).toThrow(/no payout address recorded/);
  });

  it('a campaign with no batches is refused', () => {
    expect(() => assignBatches([])).toThrow(/at least one batch/);
  });
});

describe('reproducibility — the whole point', () => {
  it('the same inputs always produce the same root', () => {
    const subs = [sub('npub1a', 1), sub('npub1b', 2), sub('npub1c', 3)];
    const one = buildCampaign(config(), subs);
    const two = buildCampaign(config(), [...subs].reverse());
    expect(two.root).toBe(one.root);
    expect(two.allocated).toBe(one.allocated);
  });

  it('the latest address wins, so a wallet change is honoured', () => {
    // The subscription event is replaceable precisely so that losing a wallet
    // does not cost somebody their place in a queue they already joined.
    const r = buildCampaign(config({ batches: batches(['npub1a'], [], []) }), [
      sub('npub1a', 100, A),
      sub('npub1a', 200, B),
    ]);
    expect(r.entitlements[0]!.solanaAddress).toBe(B);
  });

  it('changing one member changes the root', () => {
    const base = buildCampaign(config(), [sub('npub1a', 1), sub('npub1b', 2), sub('npub1c', 3)]);
    const other = buildCampaign(
      config({ batches: batches(['npub1a'], ['npub1b'], ['npub1z']) }),
      [sub('npub1a', 1), sub('npub1b', 2), sub('npub1z', 3)],
    );
    expect(other.root).not.toBe(base.root);
  });

  it('nothing here launches, signs, or reaches the network', () => {
    const src = new URL('../src/campaign.ts', import.meta.url);
    // Read as text: the guarantee is about the file, not about this run.
    return import('node:fs').then(({ readFileSync }) => {
      const body = readFileSync(src, 'utf8');
      for (const forbidden of ['fetch(', 'Keypair', 'signTransaction', 'sendTransaction', 'WebSocket']) {
        expect(body).not.toContain(forbidden);
      }
    });
  });
});
