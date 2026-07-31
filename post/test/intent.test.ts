/**
 * The budget arithmetic, and the cases that make it worth having.
 *
 * The interesting assertions are the ones where `text.length` and what X charges
 * disagree — CJK, emoji, and links. If those three are right, the counter is
 * useful; if any is wrong, the counter is worse than none, because the user
 * trusts it and then meets X's rejection.
 */

import { describe, it, expect } from 'vitest';
import {
  weightedLength,
  buildIntent,
  headroom,
  URL_WEIGHT,
  X_LIMIT,
  MAX_INTENT_URL,
  INTENT_CAPABILITIES,
} from '../src/intent.js';

describe('weighted counting', () => {
  it('charges Latin text one unit per character', () => {
    const c = weightedLength('hello world');
    expect(c.weighted).toBe(11);
    expect(c.characters).toBe(11);
  });

  it('charges CJK two units per character — the gap that breaks naive counters', () => {
    // Eight characters, sixteen units. A post that "fits in 280 characters" of
    // Japanese does not fit in a 280-unit post.
    const c = weightedLength('これは日本語です');
    expect(c.characters).toBe(8);
    expect(c.weighted).toBe(16);
  });

  it('charges a multi-codepoint emoji once, not per codepoint', () => {
    // Family emoji: several code points joined by ZWJ, one visible glyph, and X
    // charges 2. Counting code points would say 7+.
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}';
    const c = weightedLength(family);
    expect(c.weighted).toBe(2);
  });

  it('charges every URL the flat rate regardless of length', () => {
    const short = weightedLength('https://x.ai');
    const long = weightedLength('https://example.com/' + 'a'.repeat(300));
    expect(short.weighted).toBe(URL_WEIGHT);
    expect(long.weighted).toBe(URL_WEIGHT);
    expect(short.urls).toBe(1);
  });

  it('detects bare domains, because X charges them 23 too', () => {
    // Counting "xonly.ai" as 8 would report more headroom than exists — the
    // unsafe direction, and the reason a TLD list is in the module at all.
    const c = weightedLength('see xonly.ai for more');
    expect(c.urls).toBe(1);
    expect(c.weighted).toBe('see '.length + URL_WEIGHT + ' for more'.length);
  });

  it('does not mistake ordinary prose punctuation for a URL', () => {
    expect(weightedLength('Done. Next. Finally.').urls).toBe(0);
    expect(weightedLength('e.g. this and i.e. that').urls).toBe(0);
  });

  it('counts three links as 69 units even though they are 20 characters', () => {
    const text = 'a.com b.com c.com';
    const c = weightedLength(text);
    expect(c.urls).toBe(3);
    expect(c.weighted).toBe(URL_WEIGHT * 3 + 2); // two spaces
  });
});

describe('buildIntent', () => {
  const ok = (text: string, url?: string) => buildIntent({ text, url });

  it('produces a plain intent URL — no API, no token, no developer app', () => {
    const r = ok('hello');
    expect(r.ok).toBe(true);
    expect(r.href!.startsWith('https://x.com/intent/tweet?')).toBe(true);
    expect(r.href).not.toMatch(/api\.x\.com|oauth|bearer|access_token/i);
  });

  it('passes the permalink as url=, not concatenated into the prose', () => {
    const r = ok('look at this', 'https://xonly.ai/p/abc');
    const q = new URL(r.href!).searchParams;
    expect(q.get('text')).toBe('look at this');
    expect(q.get('url')).toBe('https://xonly.ai/p/abc');
  });

  it('charges the permalink against the budget', () => {
    const without = headroom('x');
    const withUrl = headroom('x', { url: 'https://xonly.ai/p/abc' });
    expect(without - withUrl).toBe(URL_WEIGHT + 1);
  });

  it('REFUSES rather than truncating when over X’s limit', () => {
    const r = ok('a'.repeat(X_LIMIT + 1));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('over-x-limit');
    // The critical assertion: no URL is handed back at all. A truncating share
    // button publishes two thirds of an argument and the user finds out in public.
    expect(r.href).toBeUndefined();
    expect(r.headroom).toBeLessThan(0);
  });

  it('explains the link surcharge when links are what pushed it over', () => {
    const r = buildIntent({ text: Array.from({ length: 13 }, (_, i) => `site${i}.com`).join(' ') });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/counts as 23/);
  });

  it('refuses when percent-encoding inflates the URL past the cap', () => {
    // Each 🙂 is one code point and twelve characters once encoded (%F0%9F%99%82),
    // so 200 of them is 400 units — nothing to X — and ~2400 characters of URL.
    // This is the failure a character counter alone cannot see.
    const r = buildIntent({ text: '🙂'.repeat(200), limit: 25_000 });
    expect(r.count.weighted).toBe(400);
    expect(r.headroom).toBeGreaterThan(0); // X would have accepted it
    expect(r.urlLength).toBeGreaterThan(MAX_INTENT_URL);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('intent-url-too-long');
    expect(r.href).toBeUndefined();
  });

  it('reports urlLength even when refusing, so the UI can show how far over', () => {
    const r = buildIntent({ text: '🙂'.repeat(200), limit: 25_000 });
    expect(r.urlLength).toBeGreaterThan(0);
  });

  /**
   * Which budget binds first, and why the second one is not dead code.
   *
   * The worst encoding ratio available is an emoji: 2 units for 12 encoded
   * characters, i.e. 6 characters per unit. At the standard 280-unit limit the
   * URL can therefore never exceed roughly 1,700 characters, so X's counter
   * always refuses first and the URL cap never fires.
   *
   * It fires only above ~333 units — meaning it exists for PREMIUM accounts.
   * Recorded as a test because the check looks redundant when read against a
   * standard account, and deleting it would silently break the premium path.
   */
  it('at the standard limit, X’s counter always binds before the URL cap', () => {
    const worst = buildIntent({ text: '🙂'.repeat(140) }); // exactly 280 units
    expect(worst.count.weighted).toBe(280);
    expect(worst.headroom).toBe(0);
    expect(worst.urlLength).toBeLessThan(MAX_INTENT_URL);
    expect(worst.ok).toBe(true);

    // One more emoji and it is X's limit that rejects, not ours.
    expect(buildIntent({ text: '🙂'.repeat(141) }).reason).toBe('over-x-limit');
  });

  it('refuses an empty post', () => {
    expect(ok('').reason).toBe('empty');
    expect(ok('   ').reason).toBe('empty');
  });

  it('accepts a post that is exactly at the limit', () => {
    const r = ok('a'.repeat(X_LIMIT));
    expect(r.ok).toBe(true);
    expect(r.headroom).toBe(0);
  });

  it('honours a raised limit for premium accounts', () => {
    expect(buildIntent({ text: 'a'.repeat(1000), limit: 25_000 }).ok).toBe(true);
    expect(buildIntent({ text: 'a'.repeat(1000) }).ok).toBe(false);
  });

  it('round-trips text through encoding without corruption', () => {
    const tricky = 'quotes " & ampersands, plus + signs, 100% of it — and 日本語';
    const r = buildIntent({ text: tricky, limit: 10_000 });
    expect(new URL(r.href!).searchParams.get('text')).toBe(tricky);
  });
});

describe('stated capabilities', () => {
  it('records that media cannot be uploaded through an intent', () => {
    // Load-bearing: it is why the card must arrive by og:image unfurl, which is
    // why a post carrying a card necessarily carries a link.
    expect(INTENT_CAPABILITIES.mediaUpload).toBe(false);
  });

  it('records that delivery cannot be confirmed', () => {
    // The justification for there being no "posted" state anywhere.
    expect(INTENT_CAPABILITIES.deliveryConfirmation).toBe(false);
  });
});
