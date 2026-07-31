/**
 * The continuity claims.
 *
 * Everything here runs against a MOCK resolver. That is a limitation, stated
 * loudly: it proves our side is correct, not that Bags behaves as documented.
 * `probe.mjs` is what closes that gap, and it needs an API key.
 */

import { describe, expect, it } from 'vitest';
import {
  assertValidSplit, resolveClaimers, BagsError, TOTAL_BPS,
  type FeeClaimer, type SocialProvider, type WalletResolver,
} from '../src/bags.js';
import {
  assessContinuity, buildRecord, buildFeeClaimAttestation, describeFeeClaim,
  summarise, FEE_D_TAG, type IdentityBinding,
} from '../src/continuity.js';

const WALLETS: Record<string, string> = {
  'twitter:alice': 'A1iceWa11etAddre55000000000000000000000000',
  'twitter:bob': 'B0bWa11etAddre5500000000000000000000000000',
};

const mockResolver: WalletResolver = async (provider, username) =>
  WALLETS[`${provider}:${username.toLowerCase()}`] ?? null;

const anchored = (username: string): IdentityBinding => ({
  npub: 'npub1fn27skur6m05z747px3epnlclf8etedhahky9zxrwxad8gll2lm',
  provider: 'twitter',
  username,
  state: 'verified',
  proofUrl: `https://x.com/${username}/status/1789456123456789012`,
  archiveUrl: `https://web.archive.org/web/20260727224400/https://x.com/${username}/status/1789456123456789012`,
  archivedAt: 1785000240,
  accountId: '1234567890',
});

/* ------------------------------------------------------------------ */

describe('fee split validation happens before anything costs money', () => {
  it('accepts a split that totals exactly 10000', () => {
    expect(() => assertValidSplit(5000, [
      { provider: 'twitter', username: 'alice', bps: 3000 },
      { provider: 'twitter', username: 'bob', bps: 2000 },
    ])).not.toThrow();
  });

  it('rejects a split that does not total 10000', () => {
    // Discovering this from a rejected mainnet transaction costs real money.
    expect(() => assertValidSplit(5000, [{ provider: 'twitter', username: 'alice', bps: 3000 }]))
      .toThrow(/totals 8000 bps/);
  });

  it('rejects a duplicated claimer rather than summing the shares', () => {
    expect(() => assertValidSplit(5000, [
      { provider: 'twitter', username: 'alice', bps: 3000 },
      { provider: 'twitter', username: 'Alice', bps: 2000 },
    ])).toThrow(/duplicate fee claimer/);
  });

  it('rejects non-integer and out-of-range bps', () => {
    for (const bad of [1.5, -1, TOTAL_BPS + 1]) {
      expect(() => assertValidSplit(0, [{ provider: 'twitter', username: 'a', bps: bad }]), String(bad))
        .toThrow(BagsError);
    }
  });
});

describe('resolution reports every failure, not just the first', () => {
  it('separates resolved from unresolved', async () => {
    const claimers: FeeClaimer[] = [
      { provider: 'twitter', username: 'alice', bps: 4000 },
      { provider: 'twitter', username: 'nobody', bps: 3000 },
      { provider: 'twitter', username: 'bob', bps: 3000 },
    ];
    const r = await resolveClaimers(claimers, mockResolver);
    expect(r.resolved.map((c) => c.username)).toEqual(['alice', 'bob']);
    expect(r.unresolved.map((c) => c.username)).toEqual(['nobody']);
  });
});

describe('continuity grading is blunt', () => {
  it('anchored needs all three: verified, archived, and an immutable id', () => {
    expect(assessContinuity(anchored('alice')).strength).toBe('anchored');
  });

  it('drops to claim-only without an archive', () => {
    const b = { ...anchored('alice') };
    delete b.archiveUrl;
    const a = assessContinuity(b);
    expect(a.strength).toBe('claim-only');
    expect(a.gaps.join(' ')).toMatch(/dies with the account/);
  });

  it('drops to claim-only without an immutable account id', () => {
    const b = { ...anchored('alice') };
    delete b.accountId;
    const a = assessContinuity(b);
    expect(a.strength).toBe('claim-only');
    expect(a.gaps.join(' ')).toMatch(/re-registered handle/);
  });

  it('an unverified claim is worth nothing, however well archived', () => {
    const a = assessContinuity({ ...anchored('alice'), state: 'claimed' });
    expect(a.strength).toBe('none');
    expect(a.gaps[0]).toMatch(/not verified/);
  });
});

describe('evidence is never attached to the wrong handle', () => {
  it('refuses a binding that does not match the claimer', async () => {
    await expect(buildRecord(
      { provider: 'twitter', username: 'bob', bps: 5000 },
      anchored('alice'),
      mockResolver,
    )).rejects.toThrow(/refusing to attach evidence to the wrong handle/);
  });

  it('matches case-insensitively, because handles are displayed inconsistently', async () => {
    const r = await buildRecord(
      { provider: 'twitter', username: 'Alice', bps: 5000 },
      anchored('alice'),
      mockResolver,
    );
    expect(r.strength).toBe('anchored');
  });
});

describe('an unresolved handle is not an error', () => {
  it('records anchored identity even when Bags returns no wallet', async () => {
    const r = await buildRecord(
      { provider: 'twitter', username: 'carol', bps: 2000 },
      anchored('carol'),
      mockResolver,
    );
    // A handle Bags cannot resolve yet, with a key-anchored claim, is a BETTER
    // position than a resolved handle with no anchor. The record must show it.
    expect(r.wallet).toBeNull();
    expect(r.strength).toBe('anchored');
  });
});

describe('the attestation is evidence, not a transfer', () => {
  it('carries the binding, the share, and the strength', async () => {
    const r = await buildRecord(
      { provider: 'twitter', username: 'alice', bps: 2500 },
      anchored('alice'),
      mockResolver,
    );
    const ev = buildFeeClaimAttestation(r, 'So1anaM1ntAddre5500000000000000000000000', 1785000300);

    expect(ev.kind).toBe(30078);
    expect(ev.tags.find((t) => t[0] === 'd')?.[1]).toBe(FEE_D_TAG);
    expect(ev.tags.find((t) => t[0] === 'i')?.[1]).toBe('twitter:alice');
    expect(ev.tags.find((t) => t[0] === 'strength')?.[1]).toBe('anchored');
    expect(ev.tags.find((t) => t[0] === 'wallet')?.[2]).toBe('solana');
  });

  it('the prompt says it moves no money', async () => {
    const r = await buildRecord(
      { provider: 'twitter', username: 'alice', bps: 2500 },
      anchored('alice'),
      mockResolver,
    );
    const prompt = describeFeeClaim(buildFeeClaimAttestation(r));

    expect(prompt).toMatch(/@alice/);
    expect(prompt).toMatch(/25%/);
    // The single most important sentence in this module. A user signing an event
    // near a token launch must not think they are authorising a payment.
    expect(prompt).toMatch(/moves no funds/);
  });

  it('renders fractional percentages without lying about precision', async () => {
    const r = await buildRecord(
      { provider: 'twitter', username: 'alice', bps: 1234 },
      anchored('alice'),
      mockResolver,
    );
    expect(describeFeeClaim(buildFeeClaimAttestation(r))).toMatch(/12\.34%/);
  });
});

describe('the launch summary surfaces what is fragile', () => {
  it('names the exposed percentage rather than a reassuring total', async () => {
    const strong = await buildRecord(
      { provider: 'twitter', username: 'alice', bps: 6000 }, anchored('alice'), mockResolver);
    const weak = await buildRecord(
      { provider: 'twitter', username: 'bob', bps: 4000 },
      { ...anchored('bob'), archiveUrl: undefined, archivedAt: undefined },
      mockResolver);

    const s = summarise([strong, weak]);
    expect(s.anchoredBps).toBe(6000);
    expect(s.fragileBps).toBe(4000);
    expect(s.verdict).toMatch(/40% of fee share depends on a handle alone/);
  });

  it('says so plainly when nothing is fragile', async () => {
    const r = await buildRecord(
      { provider: 'twitter', username: 'alice', bps: 10000 }, anchored('alice'), mockResolver);
    expect(summarise([r]).verdict).toMatch(/Handle loss costs nobody their revenue/);
  });
});
