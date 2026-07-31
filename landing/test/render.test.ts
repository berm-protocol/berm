/**
 * The page, and the structural rules that keep it out of trouble.
 *
 * The document ORDER is the safety property: content, then machinery, then pitch.
 * A page that leads with a pitch is a bait-and-switch reached from a link on X,
 * and destination mismatch — not marketing — is what actually gets a domain
 * flagged. So the order is asserted rather than intended.
 */

import { describe, it, expect } from 'vitest';
import { renderLanding, metaTags, claimJson, type LandingData } from '../src/render.js';

const H = '7'.repeat(64);

const data = (over: Partial<LandingData> = {}): LandingData => ({
  text: 'Custody is not one thing. Here is what each tier actually depends on.',
  heading: 'Custody, honestly',
  artifact: {
    kind: 'table',
    text: '| Tier | Depends on |\n| --- | --- |\n| 1 | a DNS name |',
    rows: [['Tier', 'Depends on'], ['1', 'a DNS name']],
    header: true,
  },
  authorName: 'Dorin',
  handle: 'dorin',
  npub: 'npub1exampleexample',
  pubkeyHex: 'b'.repeat(64),
  createdAt: 1_780_000_000,
  canonicalUrl: 'https://their-site.com/@dorin/custody-honestly',
  nevent: 'nevent1qqsexampleexample',
  eventId: 'a'.repeat(64),
  signedContent: 'the exact signed content',
  cardUrl: `https://their-site.com/${H}.png`,
  cardSha256: H,
  cardSize: { w: 2400, h: 1260 },
  cardAlt: 'Table, 2 columns, 1 data row',
  relays: ['wss://relay.one', 'wss://relay.two'],
  profileUrl: 'https://their-site.com/@dorin',
  ctaUrl: 'https://xonly.ai/editor',
  ...over,
});

const at = (html: string, needle: string) => html.indexOf(needle);

/**
 * The document with HTML comments removed.
 *
 * Needed because the page carries comments that *explain* the rules — "No gate,
 * no modal, no interstitial" — and a naive scan for those words flags the
 * documentation of the rule as a violation of it. Fourth loose-regex false
 * positive in this repo; the pattern is always the same, so the fix is to scan
 * the actual document rather than its annotations.
 */
const body = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '');

describe('content comes first — the rule that keeps the domain safe', () => {
  const html = renderLanding(data());

  it('puts the artifact before the verification block and the pitch', () => {
    const table = at(html, '<table>');
    const attest = at(html, 'id="attest"');
    const cta = at(html, 'class="cta"');
    expect(table).toBeGreaterThan(0);
    expect(table).toBeLessThan(attest);
    expect(attest).toBeLessThan(cta);
  });

  it('puts the <article> before anything promotional', () => {
    expect(at(html, '<article>')).toBeLessThan(at(html, 'Made with the XOnly editor'));
  });

  it('has no modal, overlay, gate or interstitial', () => {
    // Any of these turns a delivered promise into a bait-and-switch.
    const b = body(html);
    expect(b).not.toMatch(/position:\s*fixed/i);
    expect(b).not.toMatch(/\bmodal\b|\boverlay\b|\bpaywall\b|\binterstitial\b/i);
    expect(b).not.toMatch(/sign\s*up to (read|see|continue)/i);
  });

  it('does not hide content behind a scroll or height cap', () => {
    expect(body(html)).not.toMatch(/max-height:\s*\d+(px|vh)[^}]*overflow:\s*hidden/i);
  });
});

describe('the artifact is real, not a picture of itself', () => {
  it('emits a real table with real cells', () => {
    const html = renderLanding(data());
    expect(html).toContain('<th>Tier</th>');
    expect(html).toContain('<td>a DNS name</td>');
  });

  it('offers the copyable markdown, because a picture cannot be pasted', () => {
    expect(renderLanding(data())).toContain('Copy as markdown');
  });

  it('escapes the artifact — a code snippet cannot inject markup', () => {
    const html = renderLanding(data({
      artifact: { kind: 'code', text: '</pre><script>alert(1)</script>' },
    }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes table cells too', () => {
    const html = renderLanding(data({
      artifact: { kind: 'table', text: 'x', rows: [['<img onerror=x>']], header: false },
    }));
    expect(html).not.toContain('<img onerror=x>');
  });
});

describe('the verdict starts unresolved and is never pre-set to a pass', () => {
  const html = renderLanding(data());

  it('ships as "checking", not "verified"', () => {
    expect(html).toContain('data-state="checking"');
    expect(html).not.toContain('data-state="verified"');
  });

  it('says nothing has been confirmed yet', () => {
    // If the script is blocked or throws, this is what the visitor is left with.
    expect(html).toMatch(/Checking against relays/);
    expect(html).not.toMatch(/✓|Verified against \d+ relays/);
  });
});

describe('it hands the visitor a way to leave', () => {
  const html = renderLanding(data());

  it('prints the nevent so the post resolves elsewhere', () => {
    expect(html).toContain('nevent1qqsexampleexample');
  });

  it('prints the author npub', () => {
    expect(html).toContain('npub1exampleexample');
  });

  it('lists the relays where the data actually lives', () => {
    expect(html).toContain('wss://relay.one');
    expect(html).toContain('wss://relay.two');
  });

  it('says the page is a rendering rather than the original', () => {
    expect(html).toMatch(/This page is a rendering/);
  });
});

describe('the pitch', () => {
  const html = renderLanding(data());

  it('is stated as a capability, not as an ideology', () => {
    // "Sign up for sovereignty" sells to a conference room.
    expect(html).toMatch(/without them turning into mush/);
    expect(html).not.toMatch(/sign up for sovereignty/i);
  });

  it('links where the caller says, not to a hardcoded host', () => {
    expect(html).toContain('href="https://xonly.ai/editor"');
  });
});

describe('card metadata', () => {
  it('declares the ACTUAL byte dimensions, not the layout box', () => {
    const m = metaTags(data());
    expect(m).toContain('og:image:width" content="2400"');
    expect(m).toContain('og:image:height" content="1260"');
  });

  it('asks for a large card only when there is an image', () => {
    expect(metaTags(data())).toMatch(/twitter:card" content="summary_large_image"/);
    expect(metaTags(data({ cardUrl: undefined }))).toMatch(/twitter:card" content="summary"/);
  });

  it('never emits an image without alt text', () => {
    expect(metaTags(data())).toMatch(/twitter:image:alt" content="[^"]{8,}"/);
  });

  it('escapes a hostile heading instead of breaking out of the attribute', () => {
    const m = metaTags(data({ heading: 'He said "hi" & <b>x</b>' }));
    expect(m).toContain('&quot;hi&quot;');
    expect(m).not.toContain('<b>x</b>');
  });
});

describe('the embedded claim', () => {
  it('carries what the browser needs to check the page', () => {
    const c = JSON.parse(claimJson(data()));
    expect(c.eventId).toBe('a'.repeat(64));
    expect(c.pubkeyHex).toBe('b'.repeat(64));
    expect(c.signedContent).toBe('the exact signed content');
    expect(c.relays).toEqual(['wss://relay.one', 'wss://relay.two']);
  });

  it('commits to the card hash, which is what makes the image host a cache', () => {
    const c = JSON.parse(claimJson(data()));
    expect(c.card.sha256).toBe(H);
    expect(c.imetaTag).toContain(`x ${H}`);
  });

  it('still claims the card when there is no hash, so it can be marked unverifiable', () => {
    // The distinction that was originally collapsed. An image with no commitment
    // is not "nothing to check" — it is something that cannot be checked, and
    // dropping it from the claim reported the page as verified.
    const c = JSON.parse(claimJson(data({ cardSha256: undefined })));
    expect(c.card).not.toBeNull();
    expect(c.card.sha256).toBeUndefined();
    expect(c.card.urls.length).toBeGreaterThan(0);
  });

  it('carries no card claim only when there is genuinely no image', () => {
    const c = JSON.parse(claimJson(data({ cardUrl: undefined, cardUrls: [], cardSha256: undefined })));
    expect(c.card).toBeNull();
  });

  it('cannot break out of the script tag', () => {
    // A </script> inside author content would end the block early and turn the
    // rest of the JSON into markup.
    const html = renderLanding(data({ signedContent: '</script><script>alert(1)</script>' }));
    const between = html.slice(at(html, 'id="claim"'), at(html, 'id="claim"') + 400);
    expect(between).not.toContain('</script><script>alert(1)');
    expect(between).toContain('\\u003c');
  });
});

describe('no cloaking', () => {
  it('has one code path — nothing inspects the requester', () => {
    const src = renderLanding.toString();
    expect(src).not.toMatch(/userAgent|user-?agent|isCrawler|\bcrawler\b|\bbots?\b/i);
  });

  it('produces byte-identical output for the same input', () => {
    expect(renderLanding(data())).toBe(renderLanding(data()));
  });
});
