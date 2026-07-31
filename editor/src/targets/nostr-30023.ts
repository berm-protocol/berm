/**
 * Target 1 — Nostr long-form (NIP-23, kind 30023).
 *
 * Why this target matters disproportionately: kind 30023 is the EXISTING
 * standard for long-form Nostr content. Publishing here means Habla, YakiHonne,
 * njump and every other long-form reader render the author's work on day one,
 * without XOnly shipping a single client. That is free distribution the project
 * did not have to build, and it is the reason NIP-23 is the canonical target
 * rather than a bespoke kind.
 */

import type { Doc, Inline, Block } from '../model.js';
import { docSummary, firstImage, slugify, inlineText } from '../model.js';
import type { EventTemplate } from '../sdk/types.js';

/* ------------------------------------------------------------------ */
/* Markdown serialization                                              */
/* ------------------------------------------------------------------ */

function escapeMd(s: string): string {
  // Escape only what would change meaning. Over-escaping makes the raw
  // markdown unreadable in clients that show source.
  return s.replace(/([\\`*_[\]])/g, '\\$1');
}

function inlineToMd(items: Inline[]): string {
  return items
    .map((i) => {
      let t = escapeMd(i.text);
      if (!t) return '';
      const marks = i.marks ?? [];
      if (marks.includes('code')) t = '`' + i.text + '`'; // no escaping inside code
      if (marks.includes('b')) t = `**${t}**`;
      if (marks.includes('i')) t = `*${t}*`;
      if (marks.includes('s')) t = `~~${t}~~`;
      if (i.href) t = `[${t}](${i.href})`;
      return t;
    })
    .join('');
}

function blockToMd(b: Block): string {
  switch (b.type) {
    case 'h1': return `# ${inlineToMd(b.content)}`;
    case 'h2': return `## ${inlineToMd(b.content)}`;
    case 'h3': return `### ${inlineToMd(b.content)}`;
    case 'p': return inlineToMd(b.content);
    case 'quote': return `> ${inlineToMd(b.content)}`;
    case 'code': return '```\n' + inlineText(b.content) + '\n```';
    case 'ul': return b.items.map((i) => `- ${inlineToMd(i)}`).join('\n');
    case 'ol': return b.items.map((i, n) => `${n + 1}. ${inlineToMd(i)}`).join('\n');
    case 'img': return `![${b.alt ?? ''}](${b.src})` + (b.caption ? `\n\n*${b.caption}*` : '');
    case 'hr': return '---';
    // No other target can guarantee an X embed renders, so it degrades to a
    // plain link. Degrading visibly beats degrading silently.
    case 'embed': return `[${b.url}](${b.url})`;

    // Markdown has real tables, so Nostr gets structure rather than a picture.
    // Only X falls back to an image, and only because it has no table primitive.
    case 'table': {
      const rows = b.rows.map((r) => `| ${r.map(inlineToMd).join(' | ')} |`);
      const cols = Math.max(1, ...b.rows.map((r) => r.length));
      const sep = `|${' --- |'.repeat(cols)}`;
      const out = b.header
        ? [rows[0] ?? '', sep, ...rows.slice(1)]
        // No header row: markdown still requires a separator, so emit an empty one.
        : [`|${'  |'.repeat(cols)}`, sep, ...rows];
      return out.join('\n') + (b.caption ? `\n\n*${escapeMd(b.caption)}*` : '');
    }

    // A fenced block preserves the monospace alignment character art depends on.
    case 'art':
      return '```\n' + b.text + '\n```' + (b.caption ? `\n\n*${escapeMd(b.caption)}*` : '');
  }
}

export function docToMarkdown(doc: Doc): string {
  return doc.blocks.map(blockToMd).filter((s) => s !== '').join('\n\n');
}

/* ------------------------------------------------------------------ */
/* Event construction                                                  */
/* ------------------------------------------------------------------ */

export interface Nip23Options {
  /** Stable identifier. Republishing with the same `d` REPLACES the article,
   *  which is how edits work for addressable events. */
  identifier?: string;
  publishedAt?: number;
  hashtags?: string[];
  /** Canonical URL on the author's node, published as an `r` tag. */
  canonicalUrl?: string;
}

export function docToNip23(doc: Doc, opts: Nip23Options = {}): EventTemplate {
  const d = opts.identifier ?? slugify(doc.title);
  const now = Math.floor(Date.now() / 1000);
  const image = firstImage(doc);
  const summary = docSummary(doc);

  const tags: string[][] = [['d', d]];

  if (doc.title.trim()) tags.push(['title', doc.title.trim()]);
  if (summary) tags.push(['summary', summary]);
  if (image) tags.push(['image', image]);
  tags.push(['published_at', String(opts.publishedAt ?? now)]);
  if (opts.canonicalUrl) tags.push(['r', opts.canonicalUrl]);
  for (const h of opts.hashtags ?? []) tags.push(['t', h.toLowerCase()]);

  return {
    kind: 30023,
    created_at: now,
    tags,
    content: docToMarkdown(doc),
  };
}

/**
 * The naddr a reader uses to find this article on any Nostr client.
 * Built by the caller once the pubkey is known.
 */
export function articleCoordinate(pubkeyHex: string, identifier: string): string {
  return `30023:${pubkeyHex}:${identifier}`;
}
