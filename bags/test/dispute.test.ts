/**
 * The dispute model is the one place in this project where a wrong answer costs
 * somebody money, so these assertions are mostly about what it REFUSES to say.
 *
 * A model that always names a winner is worse than useless in a dispute: it
 * launders a guess into a verdict, and the operator relying on it has no way to
 * tell the confident case from the coin flip.
 */

import { describe, it, expect } from 'vitest';
import { adjudicate, isNeutralArchive, type Claimant } from '../src/dispute.js';
import type { IdentityBinding } from '../src/continuity.js';

const DAY = 86_400;
const MAR_2024 = 1_710_000_000;          // ~2024-03-09
const JAN_2026 = 1_767_000_000;          // ~2025-12-29

const binding = (over: Partial<IdentityBinding> = {}): IdentityBinding => ({
  npub: 'npub1creator', provider: 'twitter', username: 'alice', state: 'verified',
  proofUrl: 'https://x.com/alice/status/1', accountId: '1234567890',
  archiveUrl: 'https://web.archive.org/web/20240309/https://x.com/alice/status/1',
  archivedAt: MAR_2024,
  ...over,
});


/** Indexing is checked in this package, including here. A test that reaches past
 *  the end of an array should fail loudly rather than compare against undefined. */
const at = <T>(xs: T[], i: number): T => {
  const v = xs[i];
  if (v === undefined) throw new Error(`no element at index ${i} (length ${xs.length})`);
  return v;
};

const creator: Claimant = { label: 'Creator', binding: binding(), holdsNow: false, heldFrom: MAR_2024 };
const squatter: Claimant = { label: 'Squatter', binding: null, holdsNow: true, heldFrom: JAN_2026 };

describe('the ordinary case: the displaced creator can show something', () => {
  const r = adjudicate('alice', 'twitter', 2500, [squatter, creator]);

  it('is demonstrable, and by the party who does NOT hold the handle', () => {
    expect(r.verdict).toBe('demonstrable');
    expect(r.demonstrableBy).toBe('Creator');
  });

  it('ranks evidence above possession — possession is what changed', () => {
    expect(at(r.sides, 0).label).toBe('Creator');
    expect(at(r.sides, 0).holdsNow).toBe(false);
  });

  it('names the archive date, so an operator can check it themselves', () => {
    expect(r.summary).toContain('2024-03-09');
  });

  it('says out loud that it is evidence and not a transfer', () => {
    // The same rule the approval prompt enforces. Nobody reading a verdict near
    // a token launch may think money has moved.
    expect(r.summary).toMatch(/evidence, not a transfer/);
    expect(JSON.stringify(r)).not.toMatch(/\btransferred\b|\bpaid\b|\bsent funds\b/);
  });

  it('states the counterfactual — what Bags can see with none of this', () => {
    expect(r.withoutBerm).toMatch(/no field in that answer for who held it before/);
    expect(r.withoutBerm).toMatch(/whoever holds it right now/);
    // These labels are descriptions, not names. An earlier version built a
    // possessive out of one and rendered "Whoever holds @alice now's".
    expect(r.withoutBerm).not.toMatch(/\bnow's\b/);
  });
});

describe('what must NOT count as evidence', () => {
  it('a self-hosted "archive" is worth nothing on its own', () => {
    const selfHosted = { ...creator, binding: binding({ archiveUrl: 'https://alice.example/proof.html' }) };
    const r = adjudicate('alice', 'twitter', 2500, [squatter, selfHosted]);
    expect(r.verdict).toBe('unresolved');
    expect(r.sides.find((s) => s.label === 'Creator')!.shows)
      .toMatch(/could control/);
  });

  it('a lookalike domain does not become neutral by containing the name', () => {
    // `evil-archive.org.attacker.com` would pass a naive includes() check.
    expect(isNeutralArchive('https://web.archive.org.attacker.com/x')).toBe(false);
    expect(isNeutralArchive('https://notweb.archive.org.evil/x')).toBe(false);
    expect(isNeutralArchive('https://web.archive.org/web/1/x')).toBe(true);
    expect(isNeutralArchive('https://sub.archive.today/x')).toBe(true);
  });

  it('a malformed URL is not an archive, and does not throw', () => {
    expect(isNeutralArchive('not a url')).toBe(false);
    expect(isNeutralArchive(undefined)).toBe(false);
  });

  it('an archive URL with no timestamp proves nothing', () => {
    const noStamp = { ...creator, binding: binding({ archivedAt: undefined }) };
    const r = adjudicate('alice', 'twitter', 2500, [squatter, noStamp]);
    expect(r.verdict).toBe('unresolved');
  });

  it("a party's own claim about when they got the handle never counts", () => {
    // heldFrom is displayed, never scored. It is the thing in dispute.
    const liar: Claimant = { label: 'Liar', binding: null, holdsNow: true, heldFrom: 1 };
    const r = adjudicate('alice', 'twitter', 2500, [liar, { ...creator }]);
    expect(r.demonstrableBy).toBe('Creator');
    expect(at(r.sides, 0).provenSince).toBe(MAR_2024);
  });
});

describe('the model refuses to manufacture confidence', () => {
  it('two neutral archives are CONTESTED, not a win for the earlier one', () => {
    const other: Claimant = {
      label: 'Other', holdsNow: true,
      binding: binding({ npub: 'npub1other', archivedAt: MAR_2024 + 30 * DAY }),
    };
    const r = adjudicate('alice', 'twitter', 2500, [other, creator]);
    expect(r.verdict).toBe('contested');
    expect(r.summary).toMatch(/genuine conflict/);
  });

  it('but still orders them, earliest first — later cannot outrank earlier', () => {
    // Otherwise a forger archives the page today and beats the original.
    const later: Claimant = {
      label: 'Later', holdsNow: true,
      binding: binding({ npub: 'npub1later', archivedAt: MAR_2024 + 700 * DAY }),
    };
    const r = adjudicate('alice', 'twitter', 2500, [later, creator]);
    expect(at(r.sides, 0).label).toBe('Creator');
    expect(r.summary).toMatch(/earlier by 700 day/);
  });

  it('neither side having evidence is unresolved, and says the operator gained nothing', () => {
    const a: Claimant = { label: 'A', binding: null, holdsNow: true };
    const b: Claimant = { label: 'B', binding: null, holdsNow: false };
    const r = adjudicate('alice', 'twitter', 2500, [a, b]);
    expect(r.verdict).toBe('unresolved');
    expect(r.summary).toMatch(/what they would have had anyway/);
    expect(r.demonstrableBy).toBeNull();
  });

  it('never reports demonstrable without a neutral archive behind it', () => {
    const cases: Claimant[][] = [
      [squatter, { ...creator, binding: binding({ archiveUrl: 'https://alice.example/p' }) }],
      [squatter, { ...creator, binding: binding({ archivedAt: undefined }) }],
      [squatter, { label: 'Bare', binding: null, holdsNow: false }],
    ];
    for (const c of cases) {
      const r = adjudicate('alice', 'twitter', 2500, c);
      expect(r.verdict).not.toBe('demonstrable');
      expect(r.demonstrableBy).toBeNull();
    }
  });

  it('a verified-but-unarchived claim is honest about saying nothing about the past', () => {
    const claimOnly = { ...creator, binding: binding({ archiveUrl: undefined, archivedAt: undefined }) };
    const r = adjudicate('alice', 'twitter', 2500, [squatter, claimOnly]);
    expect(r.sides.find((s) => s.label === 'Creator')!.shows)
      .toMatch(/says nothing about who held the handle before now/);
  });
});

describe('shape', () => {
  it('refuses a one-sided "dispute"', () => {
    expect(() => adjudicate('alice', 'twitter', 2500, [creator]))
      .toThrow(/not a dispute/);
  });

  it('carries the fee share through untouched', () => {
    const r = adjudicate('alice', 'twitter', 3000, [squatter, creator]);
    expect(r.bps).toBe(3000);
  });
});
