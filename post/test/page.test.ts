/**
 * The permalink page, and the two rules it exists to keep.
 *
 * The card is a picture. A picture of a table cannot be pasted into a
 * spreadsheet, so the page must carry the real thing — and it must carry the
 * SAME thing to X's crawler as to a person, because a page that shows the
 * unfurler something else is both a cloak and a lie about the card.
 */

import { describe, it, expect } from 'vitest';
import { postToPage, cardMeta, pageTitle, pageDescription, type PageOptions } from '../src/page.js';
import { fitBox, contentBox, CARD_W, CARD_H, CHROME } from '../src/card.js';
import type { Post, TableBlock } from '../src/model.js';

const AT = 1_780_000_000;
const o = (extra: Partial<PageOptions> = {}): PageOptions => ({
  canonicalUrl: 'https://xonly.ai/p/abc',
  authorName: 'Dorin',
  handle: 'dorin',
  npub: 'npub1exampleexampleexample',
  createdAt: AT,
  ...extra,
});

const table = (): TableBlock => ({
  id: 't',
  type: 'table',
  header: true,
  rows: [
    [[{ text: 'Tier' }], [{ text: 'Depends on' }]],
    [[{ text: '1' }], [{ text: 'a DNS name' }]],
  ],
});

const tablePost: Post = { text: 'custody, honestly', attachment: { kind: 'table', table: table() } };
const codePost: Post = { text: 'the guard', attachment: { kind: 'code', text: 'if (!ok) return;', language: 'ts' } };

describe('card metadata', () => {
  it('asks for a full-width card only when there is an image to show', () => {
    expect(cardMeta(tablePost, o({ cardUrl: 'https://xonly.ai/c/a.png' })))
      .toMatch(/twitter:card" content="summary_large_image"/);
    expect(cardMeta(tablePost, o())).toMatch(/twitter:card" content="summary"/);
  });

  it('declares 1200×630, the size X renders', () => {
    const m = cardMeta(tablePost, o({ cardUrl: 'https://xonly.ai/c/a.png' }));
    expect(m).toContain('og:image:width" content="1200"');
    expect(m).toContain('og:image:height" content="630"');
  });

  it('never emits an image without alt text', () => {
    const m = cardMeta(tablePost, o({ cardUrl: 'https://xonly.ai/c/a.png' }));
    expect(m).toMatch(/twitter:image:alt" content="[^"]{10,}"/);
  });

  it('records the npub, so the post outlives the page', () => {
    expect(cardMeta(tablePost, o())).toContain('nostr:pubkey');
  });

  it('escapes quotes in a title rather than breaking out of the attribute', () => {
    const nasty: Post = { text: 'x', heading: 'He said "hi" & <b>left</b>' };
    const m = cardMeta(nasty, o());
    expect(m).toContain('&quot;hi&quot;');
    expect(m).not.toContain('<b>left</b>');
  });
});

describe('the page carries the real artifact, not just a picture of it', () => {
  it('renders a table as a real table element', () => {
    const html = postToPage(tablePost, o({ cardUrl: 'https://x.ai/c.png' }));
    expect(html).toContain('<table>');
    expect(html).toContain('<th>Tier</th>');
    expect(html).toContain('<td>a DNS name</td>');
  });

  it('also offers the table as copyable markdown', () => {
    // A rendered table is not a portable one. This is the same rule the docs
    // pipeline follows for code: always link back to text.
    const html = postToPage(tablePost, o());
    expect(html).toContain('Copy as markdown');
    expect(html).toContain('| Tier | Depends on |');
  });

  it('renders code as selectable text inside a pre, not an image', () => {
    const html = postToPage(codePost, o());
    expect(html).toContain('<pre class="code"><code>if (!ok) return;</code></pre>');
  });

  it('escapes the artifact — a code snippet cannot inject markup', () => {
    const evil: Post = {
      text: 'look',
      attachment: { kind: 'code', text: '</code></pre><script>alert(1)</script>' },
    };
    const html = postToPage(evil, o());
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('states that the page is a rendering and the relay copy is the original', () => {
    expect(postToPage(tablePost, o())).toMatch(/rendering, not the original/);
  });
});

describe('no cloaking', () => {
  it('has one code path — nothing in the generator inspects a user agent', () => {
    // The page a crawler receives and the page a person receives are produced by
    // the same call with the same arguments. There is no branch to abuse.
    const src = postToPage.toString();
    // Word-bounded deliberately. An earlier version of this pattern matched
    // "bot" inside `border-bottom` in the stylesheet and failed a correct file —
    // the third time a loose regex has produced a false positive in this repo.
    expect(src).not.toMatch(/userAgent|user-?agent|isCrawler|\bcrawler\b|\bbots?\b/i);
  });

  it('takes no argument that could vary the output by requester', () => {
    expect(postToPage.length).toBe(2); // (post, options)
  });
});

describe('derived titles', () => {
  it('prefers an explicit heading', () => {
    expect(pageTitle({ text: 'body', heading: 'The heading' })).toBe('The heading');
  });

  it('falls back to the first line of prose', () => {
    expect(pageTitle({ text: 'first line\nsecond line' })).toBe('first line');
  });

  it('describes the artifact when there is no prose at all', () => {
    expect(pageTitle({ text: '', attachment: { kind: 'table', table: table() } })).toBe('A table');
  });

  it('never returns an empty title — an untitled card is a blank card', () => {
    for (const p of [{ text: '' }, { text: '   ' }] as Post[]) {
      expect(pageTitle(p).length).toBeGreaterThan(0);
      expect(pageDescription(p).length).toBeGreaterThan(0);
    }
  });

  it('truncates a very long first line instead of emitting it whole', () => {
    const t = pageTitle({ text: 'w '.repeat(200) });
    expect(t.length).toBeLessThanOrEqual(90);
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('card layout arithmetic', () => {
  it('does not enlarge past the artifact’s own pixel density — blur makes code unreadable', () => {
    const fit = fitBox(300, 100, contentBox(), 1);
    expect(fit.w).toBe(300);
    expect(fit.h).toBe(100);
  });

  it('DOES enlarge a 2x bitmap up to 2x, because that is still 1:1 in real pixels', () => {
    // Capping at 1 is what made the first rendered card draw a table at half the
    // width it should have. The bitmaps arrive pre-rendered at the theme's device
    // pixel ratio, so 2x logical is lossless.
    const fit = fitBox(300, 100, contentBox(), 2);
    expect(fit.w).toBe(600);
    expect(fit.h).toBe(200);
  });

  it('still respects the box when maxScale would overflow it', () => {
    const box = contentBox();
    const fit = fitBox(900, 300, box, 2);
    expect(fit.w).toBeLessThanOrEqual(box.w);
    expect(fit.h).toBeLessThanOrEqual(box.h);
  });

  it('scales an oversized artifact down while preserving aspect ratio', () => {
    const box = contentBox();
    const fit = fitBox(2400, 1200, box);
    expect(fit.w).toBeLessThanOrEqual(box.w);
    expect(fit.h).toBeLessThanOrEqual(box.h);
    expect(Math.abs(fit.w / fit.h - 2)).toBeLessThan(0.02);
  });

  it('centres the artifact in its box', () => {
    const box = contentBox();
    const fit = fitBox(200, 100, box);
    const left = fit.x - box.x;
    const right = box.x + box.w - (fit.x + fit.w);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1); // rounding only
  });

  it('keeps the content box inside the card with room for the chrome', () => {
    const box = contentBox();
    expect(box.x).toBeGreaterThanOrEqual(CHROME.side);
    expect(box.y + box.h).toBeLessThanOrEqual(CARD_H - CHROME.bottom);
    expect(box.x + box.w).toBeLessThanOrEqual(CARD_W);
  });

  it('gives a headingless card more room', () => {
    expect(contentBox(CHROME, false).h).toBeGreaterThan(contentBox(CHROME, true).h);
  });

  it('returns an empty box for a zero-sized artifact rather than dividing by zero', () => {
    const fit = fitBox(0, 0, contentBox());
    expect(fit.w).toBe(0);
    expect(Number.isFinite(fit.x)).toBe(true);
  });
});
