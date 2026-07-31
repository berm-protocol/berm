/**
 * The verdict, and the states that must never be confused.
 *
 * The failure this suite exists to prevent is the ordinary one: a page that shows
 * a tick because most checks passed, or because it could not check at all. Both
 * turn "unknown" into "fine", which is the same class of error as rendering
 * `claimed` as `verified`.
 */

import { describe, it, expect } from 'vitest';
import {
  judge, judgeCard, summarise, contentMatches,
  type EvidenceItem, type FetchedEvent,
} from '../src/verdict.js';

const ID = 'a'.repeat(64);
const PK = 'b'.repeat(64);
const CONTENT = '| Tier | Depends on |\n| --- | --- |\n| 1 | a DNS name |';

const ev = (over: Partial<FetchedEvent> = {}): FetchedEvent => ({
  id: ID, pubkey: PK, kind: 1, created_at: 1_780_000_000, tags: [], content: CONTENT,
  sig: '0'.repeat(128), ...over,
});

const good = (relay: string): EvidenceItem => ({ relay, event: ev(), signatureValid: true });
const silent = (relay: string): EvidenceItem => ({ relay, event: null });

const base = { declaredId: ID, declaredPubkey: PK, renderedContent: CONTENT };

describe('verified', () => {
  it('needs two independent relays, for the same reason publishing does', () => {
    expect(judge({ ...base, evidence: [good('a'), good('b')] }).state).toBe('verified');
    expect(judge({ ...base, evidence: [good('a')] }).state).toBe('unverified');
  });

  it('says the check happened in the visitor’s browser', () => {
    const v = judge({ ...base, evidence: [good('a'), good('b')] });
    expect(v.message).toMatch(/in your browser/i);
    expect(v.ok).toBe(true);
  });

  it('tolerates trailing whitespace but not a reflowed table', () => {
    expect(contentMatches(CONTENT + '\n\n', CONTENT)).toBe(true);
    expect(contentMatches(CONTENT.replace(/\n/g, ' '), CONTENT)).toBe(false);
  });
});

describe('unverified — unknown is never fine', () => {
  it('is the verdict when no relay answered', () => {
    const v = judge({ ...base, evidence: [silent('a'), silent('b')] });
    expect(v.state).toBe('unverified');
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/no relay returned this post/);
  });

  it('never sets ok, however many relays were merely silent', () => {
    const v = judge({ ...base, evidence: Array.from({ length: 9 }, (_, i) => silent(`r${i}`)) });
    expect(v.ok).toBe(false);
  });

  it('tells the visitor they can check for themselves', () => {
    expect(judge({ ...base, evidence: [silent('a')] }).message).toMatch(/Nostr client/i);
  });

  it('does not claim accuracy it cannot prove, or deny it either', () => {
    const m = judge({ ...base, evidence: [silent('a')] }).message;
    expect(m).toMatch(/may be accurate/i);
    expect(m).not.toMatch(/\bfake\b|\bfalse\b/i);
  });
});

describe('a forged copy is evidence of nothing', () => {
  it('does not count towards the quorum', () => {
    const forged: EvidenceItem = { relay: 'evil', event: ev(), signatureValid: false };
    const v = judge({ ...base, evidence: [good('a'), forged, forged] });
    expect(v.state).toBe('unverified');
    expect(v.corroborating).toEqual(['a']);
    expect(v.servedForgery).toEqual(['evil', 'evil']);
  });

  it('is reported separately, because it says something about the relay', () => {
    const forged: EvidenceItem = { relay: 'evil', event: ev(), signatureValid: false };
    const v = judge({ ...base, evidence: [forged] });
    expect(v.message).toMatch(/invalid signature/i);
    expect(v.message).toMatch(/discarded/i);
  });

  it('cannot manufacture a verified state no matter how many relays serve it', () => {
    const forged = (r: string): EvidenceItem => ({ relay: r, event: ev(), signatureValid: false });
    const v = judge({ ...base, evidence: Array.from({ length: 20 }, (_, i) => forged(`r${i}`)) });
    expect(v.ok).toBe(false);
  });

  it('treats a missing signatureValid flag as not valid, never as valid', () => {
    // Fail closed: an undefined flag means the caller did not check.
    const unchecked: EvidenceItem = { relay: 'x', event: ev() };
    expect(judge({ ...base, evidence: [unchecked, unchecked] }).state).toBe('unverified');
  });
});

describe('mismatch — the state that must be loud', () => {
  const disagreeing: EvidenceItem = {
    relay: 'honest', event: ev({ content: 'something else entirely' }), signatureValid: true,
  };

  it('is reached when a validly signed copy disagrees with the page', () => {
    expect(judge({ ...base, evidence: [disagreeing] }).state).toBe('mismatch');
  });

  it('outranks any number of agreeing relays', () => {
    // One valid copy that disagrees proves the page is wrong. Majority does not
    // enter into it — this is not a vote.
    const v = judge({ ...base, evidence: [good('a'), good('b'), good('c'), disagreeing] });
    expect(v.state).toBe('mismatch');
    expect(v.ok).toBe(false);
  });

  it('tells the visitor to trust the signed copy, not this page', () => {
    expect(judge({ ...base, evidence: [disagreeing] }).message)
      .toMatch(/Trust the signed copy, not this page/);
  });
});

describe('a relay answering a different question', () => {
  it('does not corroborate when the id differs', () => {
    const other: EvidenceItem = { relay: 'a', event: ev({ id: 'c'.repeat(64) }), signatureValid: true };
    const v = judge({ ...base, evidence: [other, other] });
    expect(v.state).toBe('unverified');
    expect(v.corroborating).toEqual([]);
  });

  it('does not corroborate when the author differs', () => {
    const other: EvidenceItem = { relay: 'a', event: ev({ pubkey: 'd'.repeat(64) }), signatureValid: true };
    expect(judge({ ...base, evidence: [other, other] }).state).toBe('unverified');
  });
});

describe('the card image', () => {
  const H = 'e'.repeat(64);

  it('verifies when the bytes hash to what the author committed', () => {
    expect(judgeCard(H, H).state).toBe('verified');
  });

  it('is a MISMATCH when the host served different bytes', () => {
    const v = judgeCard(H, 'f'.repeat(64));
    expect(v.state).toBe('mismatch');
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/has replaced it/);
  });

  it('is unverified — not verified — when the post committed to no hash', () => {
    // Without an `x` field the host is simply trusted. That is a weaker position
    // and must read as unknown rather than as fine.
    expect(judgeCard('', H).state).toBe('unverified');
    expect(judgeCard('not-a-hash', H).state).toBe('unverified');
  });

  it('is unverified when the image could not be fetched', () => {
    expect(judgeCard(H, null).state).toBe('unverified');
  });

  it('compares case-insensitively — hex case is not a substitution', () => {
    expect(judgeCard(H.toUpperCase(), H).state).toBe('verified');
  });
});

describe('the one line above the fold', () => {
  const ok = judge({ ...base, evidence: [good('a'), good('b')] });
  const H = 'e'.repeat(64);

  it('reports the count when everything checks out', () => {
    expect(summarise(ok, judgeCard(H, H))).toEqual({
      state: 'verified',
      line: 'Verified against 2 relays in your browser.',
    });
  });

  it('THE WORST STATE WINS — a swapped image is not a verified page', () => {
    // The failure being prevented: three of four checks passed, so show a tick.
    const s = summarise(ok, judgeCard(H, 'f'.repeat(64)));
    expect(s.state).toBe('mismatch');
    expect(s.line).toMatch(/image/);
  });

  it('an unverifiable image downgrades a verified post to unconfirmed', () => {
    expect(summarise(ok, judgeCard(H, null)).state).toBe('unverified');
  });

  it('names content rather than image when the post itself mismatches', () => {
    const bad = judge({
      ...base,
      evidence: [{ relay: 'h', event: ev({ content: 'other' }), signatureValid: true }],
    });
    expect(summarise(bad, judgeCard(H, H)).line).toMatch(/content/);
  });

  it('works with no card at all', () => {
    expect(summarise(ok).state).toBe('verified');
  });
});
