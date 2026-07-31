/**
 * A short post, and the thing X cannot render.
 *
 * The point of this package is not "compose a tweet" — X already has a box for
 * that and it is better at it. The point is the *attachment*: a table, a code
 * block or a character diagram, which X destroys on paste, rendered instead as
 * the 1200×630 card image that IS the whole link card now that X strips
 * headlines and descriptions.
 *
 * So a post is prose plus at most one artifact. One, deliberately: a card is a
 * single image, and a composer that accepts three attachments and silently shows
 * one is a composer that lies.
 *
 * Block shapes are imported from the editor rather than redeclared. There were
 * once three copies of the signing interface in this repository and they drifted;
 * the same would happen here, except the drift would be between what the card
 * draws and what the permalink page says.
 */

import type { Inline, TableBlock, ArtBlock } from '../../editor/src/model.js';

export type { Inline, TableBlock, ArtBlock };

/** Code carries its language for the permalink page; the card shows it as a chip. */
export interface CodeAttachment {
  kind: 'code';
  text: string;
  language?: string;
  caption?: string;
}

export interface TableAttachment {
  kind: 'table';
  table: TableBlock;
}

export interface ArtAttachment {
  kind: 'art';
  art: ArtBlock;
}

/** A pull-quote. The one variant with no X equivalent worth beating — included
 *  because it is the cheapest artifact to make and the most shared. */
export interface QuoteAttachment {
  kind: 'quote';
  text: string;
  attribution?: string;
}

export type Attachment = CodeAttachment | TableAttachment | ArtAttachment | QuoteAttachment;

export interface Post {
  /** Prose, as typed. This is what goes into the X composer. */
  text: string;
  /** At most one artifact. */
  attachment?: Attachment;
  /** Short label used in the card and the permalink `<title>`. */
  heading?: string;
}

export function emptyPost(): Post {
  return { text: '' };
}

/**
 * Does this post contain anything X would damage?
 *
 * Drives the UI's central claim. If the answer is no, the honest thing to tell
 * the user is that they should just post it on X — an app that manufactures a
 * reason to be used is an app people stop trusting.
 */
export function needsCard(p: Post): boolean {
  return p.attachment !== undefined;
}

/**
 * Alt text for the card.
 *
 * Not optional and not decorative: the card is the entire visual payload of the
 * post, so a missing alt makes the post empty to anyone using a screen reader.
 * Generated from the content rather than left to the user, because a required
 * field that can be skipped is a field that gets skipped.
 */
export function cardAlt(p: Post): string {
  const a = p.attachment;
  if (!a) return p.heading?.trim() || 'Post card';

  switch (a.kind) {
    case 'table': {
      const rows = a.table.rows.length;
      const cols = a.table.rows[0]?.length ?? 0;
      const head = a.table.header
        ? a.table.rows[0]?.map((c) => c.map((i) => i.text).join('')).filter(Boolean).join(', ')
        : '';
      const body = a.table.header ? `${rows - 1} data rows` : `${rows} rows`;
      return `Table, ${cols} columns, ${body}${head ? `. Columns: ${head}` : ''}`;
    }
    case 'code':
      return `${a.language ? `${a.language} ` : ''}code, ${a.text.split('\n').length} lines` +
             (a.caption ? `: ${a.caption}` : '');
    case 'art':
      return a.art.caption?.trim() || 'Character diagram';
    case 'quote':
      return `Quote: ${a.text.slice(0, 180)}${a.text.length > 180 ? '…' : ''}` +
             (a.attribution ? ` — ${a.attribution}` : '');
  }
}

/** Plain text of an attachment, for the permalink page and the Nostr event. */
export function attachmentText(a: Attachment): string {
  switch (a.kind) {
    case 'code': return a.text;
    case 'art': return a.art.text;
    case 'quote': return a.attribution ? `${a.text}\n— ${a.attribution}` : a.text;
    case 'table': return tableToMarkdown(a.table);
  }
}

/**
 * A table as markdown.
 *
 * This is the copyable form. The card is a picture of a table and a picture
 * cannot be pasted into a spreadsheet, so the permalink must carry the real
 * thing — the same rule the docs pipeline follows for code.
 */
export function tableToMarkdown(t: TableBlock): string {
  const cell = (c: Inline[]) => c.map((i) => i.text).join('').replace(/\|/g, '\\|').trim();
  const rows = t.rows.map((r) => r.map(cell));
  if (!rows.length) return '';
  const cols = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => Array.from({ length: cols }, (_, i) => r[i] ?? '');

  const out = [`| ${pad(rows[0]!).join(' | ')} |`];
  if (t.header) out.push(`| ${Array.from({ length: cols }, () => '---').join(' | ')} |`);
  for (const r of rows.slice(1)) out.push(`| ${pad(r).join(' | ')} |`);
  return out.join('\n');
}
