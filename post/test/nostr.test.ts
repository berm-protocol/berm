/**
 * The rule this package exists to keep: nothing here may claim a post reached X.
 *
 * Opening the intent URL returns nothing — no callback, no post id. Any tag or
 * field asserting X delivery would be stating an unknown as a fact, which is the
 * same error as rendering `claimed` as `verified`. The first test walks every
 * event this module can produce and fails on any tag outside the allow-list, so
 * a future `x_posted` tag added in good faith breaks the build.
 */

import { describe, it, expect } from 'vitest';
import {
  buildPostEvent,
  describePostForApproval,
  ALLOWED_TAGS,
  STATE_LABEL,
  type PostEventOptions,
} from '../src/nostr.js';
import { tableToMarkdown, cardAlt, needsCard, type Post, type TableBlock } from '../src/model.js';

const AT = 1_780_000_000;
const opts = (o: Partial<PostEventOptions> = {}): PostEventOptions => ({ createdAt: AT, ...o });

const table = (): TableBlock => ({
  id: 't1',
  type: 'table',
  header: true,
  rows: [
    [[{ text: 'Tier' }], [{ text: 'Depends on' }]],
    [[{ text: '1' }], [{ text: 'a DNS name' }]],
    [[{ text: '2' }], [{ text: 'your hardware' }]],
  ],
});

/** Every distinct post shape this package can build. */
const ALL_POSTS: Post[] = [
  { text: 'plain prose' },
  { text: 'with a table', attachment: { kind: 'table', table: table() } },
  { text: 'with code', attachment: { kind: 'code', text: 'const a = 1;', language: 'ts' } },
  { text: 'with art', attachment: { kind: 'art', art: { id: 'a1', type: 'art', text: 'A -> B' } } },
  { text: 'with a quote', attachment: { kind: 'quote', text: 'Ship it.', attribution: 'someone' } },
];

describe('no path claims the post reached X', () => {
  it('emits no tag outside the allow-list, for any post shape', () => {
    for (const p of ALL_POSTS) {
      const ev = buildPostEvent(p, opts({
        permalink: 'https://xonly.ai/p/abc',
        cardUrl: 'https://xonly.ai/c/abc.png',
        subject: 'a subject',
      }));
      for (const t of ev.tags) {
        expect(ALLOWED_TAGS as readonly string[]).toContain(t[0]);
      }
    }
  });

  it('never emits a tag or content asserting X delivery', () => {
    const forbidden = /x_post|posted_to|tweet_id|x_status|published_to_x|shared_to_x/i;
    for (const p of ALL_POSTS) {
      const ev = buildPostEvent(p, opts({ permalink: 'https://xonly.ai/p/abc' }));
      expect(JSON.stringify(ev)).not.toMatch(forbidden);
    }
  });

  it('has no state meaning "posted to X"', () => {
    expect(Object.keys(STATE_LABEL).sort()).toEqual(['draft', 'offered', 'signed']);
    // The wording matters as much as the absence of the state.
    expect(STATE_LABEL.offered).toMatch(/cannot confirm/i);
    expect(STATE_LABEL.offered).not.toMatch(/^posted/i);
  });

  it('accepts no argument through which the UI could report an X result', () => {
    // buildPostEvent(post, options) — two parameters, and neither carries an
    // X outcome. Enforced structurally so it cannot be added by accident.
    expect(buildPostEvent.length).toBe(2);
  });
});

describe('the event itself', () => {
  it('is kind 1 — a short post belongs in ordinary timelines', () => {
    expect(buildPostEvent({ text: 'hi' }, opts()).kind).toBe(1);
  });

  it('carries the artifact in content, so no client must fetch our page', () => {
    const ev = buildPostEvent(ALL_POSTS[1]!, opts());
    expect(ev.content).toContain('| Tier | Depends on |');
    expect(ev.content).toContain('| 2 | your hardware |');
  });

  it('fences code and records the language', () => {
    const ev = buildPostEvent(ALL_POSTS[2]!, opts());
    expect(ev.content).toContain('```ts\nconst a = 1;\n```');
  });

  it('puts the permalink in an r tag and in the content', () => {
    const ev = buildPostEvent({ text: 'hi' }, opts({ permalink: 'https://xonly.ai/p/abc' }));
    expect(ev.tags).toContainEqual(['r', 'https://xonly.ai/p/abc']);
    expect(ev.content).toContain('https://xonly.ai/p/abc');
  });

  it('gives the card alt text, because the card IS the post visually', () => {
    const ev = buildPostEvent(ALL_POSTS[1]!, opts({ cardUrl: 'https://xonly.ai/c/a.png' }));
    const imeta = ev.tags.find((t) => t[0] === 'imeta')!;
    expect(imeta).toBeTruthy();
    expect(imeta.some((s) => s.startsWith('alt '))).toBe(true);
    // Default reflects the file that is actually produced (2x), not the layout box.
    expect(imeta).toContain('dim 2400x1260');
  });

  it('commits to the card hash — without it the image host is simply trusted', () => {
    const H = 'a1'.repeat(32);
    const ev = buildPostEvent(ALL_POSTS[1]!, opts({
      cardUrl: `https://xonly.ai/${H}.png`, cardSha256: H.toUpperCase(), cardDim: '2400x1260',
    }));
    const imeta = ev.tags.find((t) => t[0] === 'imeta')!;
    expect(imeta).toContain(`x ${H}`);          // normalised to lower case
    expect(imeta).toContain('m image/png');
  });

  it('carries every host that may hold the card, so the client can fall back', () => {
    const H = 'b2'.repeat(32);
    const ev = buildPostEvent(ALL_POSTS[1]!, opts({
      cardUrls: [`https://a.example/${H}.png`, `https://b.example/${H}.png`], cardSha256: H,
    }));
    const imeta = ev.tags.find((t) => t[0] === 'imeta')!;
    expect(imeta.filter((s) => s.startsWith('url ')).length).toBe(2);
  });

  it('emits no hash when the author committed to none, rather than a fake one', () => {
    const ev = buildPostEvent(ALL_POSTS[1]!, opts({ cardUrl: 'https://xonly.ai/c/a.png' }));
    const imeta = ev.tags.find((t) => t[0] === 'imeta')!;
    expect(imeta.some((s) => s.startsWith('x '))).toBe(false);
  });

  it('emits no imeta when there is no card — no empty image reference', () => {
    const ev = buildPostEvent({ text: 'hi' }, opts());
    expect(ev.tags.find((t) => t[0] === 'imeta')).toBeUndefined();
  });

  it('is deterministic — same input, same event', () => {
    const a = buildPostEvent(ALL_POSTS[1]!, opts({ permalink: 'https://xonly.ai/p/a' }));
    const b = buildPostEvent(ALL_POSTS[1]!, opts({ permalink: 'https://xonly.ai/p/a' }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('takes its timestamp from the caller, never the clock', () => {
    expect(buildPostEvent({ text: 'hi' }, opts()).created_at).toBe(AT);
  });
});

describe('the approval sentence', () => {
  it('names the consequence and the non-consequence', () => {
    const s = describePostForApproval(ALL_POSTS[1]!, opts({ permalink: 'https://xonly.ai/p/a' }));
    expect(s).toMatch(/table/);
    expect(s).toMatch(/relays/);
    // The part a user actually needs: signing does not post to X.
    expect(s).toMatch(/nothing is sent to X/i);
  });

  it('never says the word "sign this" without saying what this is', () => {
    for (const p of ALL_POSTS) {
      const s = describePostForApproval(p, opts());
      expect(s.length).toBeGreaterThan(40);
      expect(s).toMatch(/^Publish /);
    }
  });
});

describe('alt text and table conversion', () => {
  it('describes a table by shape and column names', () => {
    const alt = cardAlt(ALL_POSTS[1]!);
    expect(alt).toMatch(/2 columns/);
    expect(alt).toMatch(/2 data rows/);
    expect(alt).toMatch(/Tier, Depends on/);
  });

  it('never returns an empty alt — the card is the whole visual payload', () => {
    for (const p of [...ALL_POSTS, { text: '' } as Post]) {
      expect(cardAlt(p).trim().length).toBeGreaterThan(0);
    }
  });

  it('escapes pipes so a cell cannot break the markdown table', () => {
    const t = table();
    t.rows[1]![0] = [{ text: 'a|b' }];
    expect(tableToMarkdown(t)).toContain('a\\|b');
  });

  it('pads short rows rather than producing a ragged table', () => {
    const t = table();
    t.rows.push([[{ text: 'only one cell' }]]);
    const lines = tableToMarkdown(t).split('\n');
    const pipes = lines.map((l) => (l.match(/\|/g) ?? []).length);
    expect(new Set(pipes).size).toBe(1);
  });

  it('only claims a card is needed when there is an artifact to render', () => {
    expect(needsCard({ text: 'just words' })).toBe(false);
    expect(needsCard(ALL_POSTS[1]!)).toBe(true);
  });
});
