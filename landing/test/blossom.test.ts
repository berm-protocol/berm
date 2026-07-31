/**
 * Hash-addressed blobs, the fallback rule, and the URL shape.
 *
 * The claim being tested is that the image host is replaceable. That only holds
 * if a hash can be recovered from a URL, alternatives can be derived from the
 * author's server list, and a URL that addresses a *different* blob is refused —
 * otherwise "fallback" becomes a substitution channel.
 */

import { describe, it, expect } from 'vitest';
import {
  blobUrl, sha256FromUrl, serversFromList, candidateUrls,
  buildImeta, parseImeta, ogImageUrl, isSha256, SERVER_LIST_KIND,
} from '../src/blossom.js';
import { slugify, slugOrDigest, pageUrl, parsePagePath, normaliseHandle, MAX_SLUG } from '../src/slug.js';

const H = '3'.repeat(64);
const H2 = '4'.repeat(64);

describe('blob URLs', () => {
  it('puts the hash in the path, so every server has the same one', () => {
    expect(blobUrl('https://a.example', H)).toBe(`https://a.example/${H}.png`);
    expect(blobUrl('https://b.example/', H)).toBe(`https://b.example/${H}.png`);
  });

  it('refuses to build a URL from something that is not a hash', () => {
    expect(() => blobUrl('https://a.example', 'nope')).toThrow(/not a sha256/);
  });

  it('recovers the hash from a URL, per the NIP-B7 rule', () => {
    expect(sha256FromUrl(`https://a.example/${H}.png`)).toBe(H);
    expect(sha256FromUrl(`https://a.example/${H}`)).toBe(H);
    expect(sha256FromUrl(`https://a.example/media/${H}.webp`)).toBe(H);
  });

  it('looks at the last segment only', () => {
    // A hex string earlier in a path is not an address, and treating it as one
    // would invent fallbacks for URLs that are not blobs.
    expect(sha256FromUrl(`https://a.example/${H}/thumbnail.png`)).toBeNull();
  });

  it('returns null for ordinary URLs and for garbage', () => {
    expect(sha256FromUrl('https://a.example/post/hello')).toBeNull();
    expect(sha256FromUrl('not a url')).toBeNull();
    expect(sha256FromUrl('https://a.example/')).toBeNull();
  });

  it('accepts either hex case and normalises to lower', () => {
    // Case in a hex digest carries no meaning, so rejecting uppercase would
    // produce confusing failures for no security benefit. Everything normalises
    // down instead, which is what keeps comparisons from failing on case alone.
    expect(sha256FromUrl(`https://a.example/${H.toUpperCase()}.png`)).toBe(H);
    expect(isSha256(H.toUpperCase())).toBe(true);
    expect(blobUrl('https://a.example', H.toUpperCase())).toBe(`https://a.example/${H}.png`);
  });
});

describe('the author’s server list (kind 10063)', () => {
  const list = (servers: string[]) => ({
    kind: SERVER_LIST_KIND,
    tags: servers.map((s) => ['server', s]),
  });

  it('reads server tags', () => {
    expect(serversFromList(list(['https://a.example', 'https://b.example'])))
      .toEqual(['https://a.example', 'https://b.example']);
  });

  it('drops http — a blob fetched in cleartext can be substituted in transit', () => {
    // Which would defeat the entire point of having committed to its hash.
    expect(serversFromList(list(['http://a.example', 'https://b.example'])))
      .toEqual(['https://b.example']);
  });

  it('skips malformed entries instead of failing the whole list', () => {
    expect(serversFromList(list(['::::', 'https://b.example']))).toEqual(['https://b.example']);
  });

  it('deduplicates', () => {
    expect(serversFromList(list(['https://a.example', 'https://a.example/']))).toEqual(['https://a.example']);
  });

  it('ignores an event of the wrong kind', () => {
    expect(serversFromList({ kind: 1, tags: [['server', 'https://a.example']] })).toEqual([]);
  });

  it('handles a missing list', () => {
    expect(serversFromList(null)).toEqual([]);
  });
});

describe('candidate URLs', () => {
  it('puts the author’s declared URLs first, then their server list', () => {
    const urls = candidateUrls({
      sha256: H,
      declared: [`https://declared.example/${H}.png`],
      servers: ['https://list.example'],
    });
    expect(urls).toEqual([
      `https://declared.example/${H}.png`,
      `https://list.example/${H}.png`,
    ]);
  });

  it('REFUSES a declared URL that addresses a different blob', () => {
    // The important one. A declared URL for another hash is a mistake or a
    // substitution attempt, and following it would make "fallback" the attack.
    const urls = candidateUrls({ sha256: H, declared: [`https://evil.example/${H2}.png`] });
    expect(urls).toEqual([]);
  });

  it('drops a declared URL with no hash in it at all', () => {
    expect(candidateUrls({ sha256: H, declared: ['https://evil.example/card.png'] })).toEqual([]);
  });

  it('deduplicates across sources', () => {
    const urls = candidateUrls({
      sha256: H,
      declared: [`https://a.example/${H}.png`],
      servers: ['https://a.example'],
    });
    expect(urls).toHaveLength(1);
  });

  it('returns nothing for an invalid hash rather than throwing', () => {
    expect(candidateUrls({ sha256: 'nope', servers: ['https://a.example'] })).toEqual([]);
  });
});

describe('imeta', () => {
  it('carries the hash, which is what makes the host a cache instead of an authority', () => {
    const tag = buildImeta({ urls: [`https://a.example/${H}.png`], sha256: H, dim: '2400x1260', alt: 'A table' });
    expect(tag[0]).toBe('imeta');
    expect(tag).toContain(`x ${H}`);
    expect(tag).toContain('dim 2400x1260');
    expect(tag).toContain('alt A table');
  });

  it('round-trips', () => {
    const fields = { urls: [`https://a.example/${H}.png`, `https://b.example/${H}.png`], sha256: H, alt: 'x', dim: '1200x630', mime: 'image/png' };
    expect(parseImeta(buildImeta(fields))).toEqual(fields);
  });

  it('carries multiple urls, which is how the same card lives in several places', () => {
    const parsed = parseImeta(buildImeta({ urls: ['https://a/x.png', 'https://b/y.png'] }))!;
    expect(parsed.urls).toHaveLength(2);
  });

  it('ignores an x field that is not a sha256', () => {
    expect(parseImeta(['imeta', 'url https://a/x.png', 'x nonsense'])?.sha256).toBeUndefined();
  });

  it('tolerates values containing spaces — alt text has them', () => {
    expect(parseImeta(['imeta', 'alt Table, 2 columns, 3 rows'])?.alt).toBe('Table, 2 columns, 3 rows');
  });

  it('returns null for a tag that is not imeta', () => {
    expect(parseImeta(['r', 'https://a'])).toBeNull();
  });
});

describe('og:image is a single durability bet', () => {
  it('prefers the author’s own server — the only host they control', () => {
    expect(ogImageUrl({ sha256: H, ownServer: 'https://mine.example', fallbackServers: ['https://other.example'] }))
      .toBe(`https://mine.example/${H}.png`);
  });

  it('falls back to the first public server when they have none', () => {
    expect(ogImageUrl({ sha256: H, fallbackServers: ['https://other.example'] }))
      .toBe(`https://other.example/${H}.png`);
  });

  it('is hash-shaped, so a Nostr client meeting the same URL can recover it', () => {
    // X treats it as opaque and does not care; the shape costs nothing and buys
    // fallback for every other consumer.
    const u = ogImageUrl({ sha256: H, ownServer: 'https://mine.example' })!;
    expect(sha256FromUrl(u)).toBe(H);
  });

  it('returns null rather than a broken URL when there is nowhere to point', () => {
    expect(ogImageUrl({ sha256: H })).toBeNull();
  });
});

describe('/@handle/slug', () => {
  it('produces a URL that reads as a page somebody owns', () => {
    expect(pageUrl('https://their-site.com', '@Dorin', 'custody-honestly'))
      .toBe('https://their-site.com/@dorin/custody-honestly');
  });

  it('keeps the same shape on a convenience host, so moving domains keeps the path', () => {
    expect(pageUrl('https://xonly.ai', 'dorin', 'custody-honestly'))
      .toBe('https://xonly.ai/@dorin/custody-honestly');
  });

  it('round-trips through parsing', () => {
    const url = pageUrl('https://x.example', 'dorin', 'custody-honestly');
    expect(parsePagePath(new URL(url).pathname)).toEqual({ handle: 'dorin', slug: 'custody-honestly' });
  });

  it('rejects paths that are not this shape', () => {
    expect(parsePagePath('/p/abc123')).toBeNull();
    expect(parsePagePath('/@dorin')).toBeNull();
    expect(parsePagePath('/@dorin/a/b')).toBeNull();
  });

  it('slugifies a real title', () => {
    expect(slugify('Custody, honestly — what each tier depends on')).toBe('custody-honestly-what-each-tier-depends-on');
  });

  it('keeps non-Latin letters instead of producing an empty slug', () => {
    expect(slugify('日本語のタイトル')).toBe('日本語のタイトル');
    expect(slugify('Привет мир')).toBe('привет-мир');
  });

  it('never ends mid-word when truncating', () => {
    const s = slugify('the ' + 'alpha beta gamma delta epsilon zeta eta theta iota kappa '.repeat(3));
    expect(s.length).toBeLessThanOrEqual(MAX_SLUG);
    expect(s.endsWith('-')).toBe(false);
  });

  it('falls back to a digest when a title yields nothing, and says it did', () => {
    expect(slugOrDigest('Custody', 'ab'.repeat(32))).toEqual({ slug: 'custody', derived: true });
    const f = slugOrDigest('🙂🙂🙂', 'ab'.repeat(32));
    expect(f.derived).toBe(false);
    expect(f.slug).toMatch(/^[0-9a-f]{12}$/);
  });

  it('normalises handles the way the URL will carry them', () => {
    expect(normaliseHandle('  @Dorin ')).toBe('dorin');
  });
});
