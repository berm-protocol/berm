/**
 * The canonical document model.
 *
 * ONE model, THREE serializers. This is the load-bearing design decision of the
 * whole editor: the author's document is the canonical artifact, and X Articles,
 * Nostr long-form, and the node page are all renderings of it. Nothing is
 * derived from an X-shaped source, so losing X loses a rendering, not the work.
 */

export type Mark = 'b' | 'i' | 's' | 'code';

export interface Inline {
  text: string;
  marks?: Mark[];
  /** Link target. Rendered as an entity in DraftJS, a markdown link in NIP-23. */
  href?: string;
}

export type BlockType =
  | 'h1' | 'h2' | 'h3'
  | 'p'
  | 'quote'
  | 'code'
  | 'ul' | 'ol'
  | 'img'
  | 'hr'
  | 'embed'
  | 'table'
  | 'art';

export interface TextBlock {
  id: string;
  type: 'h1' | 'h2' | 'h3' | 'p' | 'quote' | 'code';
  content: Inline[];
}

export interface ListBlock {
  id: string;
  type: 'ul' | 'ol';
  items: Inline[][];
}

export interface ImageBlock {
  id: string;
  type: 'img';
  src: string;
  alt?: string;
  caption?: string;
}

export interface RuleBlock {
  id: string;
  type: 'hr';
}

/** An embedded X post. Supported natively by X Articles; rendered as a link
 *  elsewhere, because no other target can guarantee the embed renders. */
export interface EmbedBlock {
  id: string;
  type: 'embed';
  url: string;
}

/**
 * A table.
 *
 * X Articles have no table primitive, so this is the first block that exercises
 * the image escape hatch: a real <table> on the node page, a markdown table on
 * Nostr, and a rendered PNG for X. One source, three appropriate renderings.
 */
export interface TableBlock {
  id: string;
  type: 'table';
  /** rows[0] is the header row when `header` is true. */
  rows: Inline[][][];
  header: boolean;
  caption?: string;
}

/**
 * Monospace character art — diagrams, ASCII pictures, box drawings.
 *
 * As TEXT this is unusable anywhere with a proportional font: every row shifts
 * and the picture collapses. X renders proportional. So art is ALWAYS an image
 * on X, and a <pre> everywhere the font can be controlled.
 */
export interface ArtBlock {
  id: string;
  type: 'art';
  text: string;
  caption?: string;
}

export type Block =
  | TextBlock | ListBlock | ImageBlock | RuleBlock | EmbedBlock | TableBlock | ArtBlock;

export interface Doc {
  title: string;
  subtitle: string;
  /** Cover image URL. Becomes the X Article cover and the OG image fallback. */
  cover: string;
  blocks: Block[];
}

export const emptyDoc = (): Doc => ({
  title: '',
  subtitle: '',
  cover: '',
  blocks: [{ id: bid(), type: 'p', content: [] }],
});

let counter = 0;
export function bid(): string {
  counter += 1;
  return `b${counter.toString(36)}${Math.floor(performance.now() * 1000).toString(36)}`;
}

/* ------------------------------------------------------------------ */
/* Plain-text helpers — used for summaries, OG descriptions, previews  */
/* ------------------------------------------------------------------ */

export function inlineText(content: Inline[]): string {
  return content.map((i) => i.text).join('');
}

export function blockText(b: Block): string {
  switch (b.type) {
    case 'ul': case 'ol': return b.items.map(inlineText).join(' ');
    case 'img': return b.caption ?? b.alt ?? '';
    case 'hr': return '';
    case 'embed': return b.url;
    case 'table': return b.rows.flat().map(inlineText).join(' ');
    // Art contributes its caption, not its glyphs — counting box-drawing
    // characters as words would wreck the reading-time estimate.
    case 'art': return b.caption ?? '';
    default: return inlineText(b.content);
  }
}

export function isTable(b: Block): b is TableBlock { return b.type === 'table'; }
export function isArt(b: Block): b is ArtBlock { return b.type === 'art'; }

export function newTable(cols = 3, rows = 3): TableBlock {
  return {
    id: bid(),
    type: 'table',
    header: true,
    rows: Array.from({ length: rows }, () => Array.from({ length: cols }, () => [] as Inline[])),
  };
}

export function newArt(text = ''): ArtBlock {
  return { id: bid(), type: 'art', text };
}

/** Blocks that cannot render natively on X and must be exported as images. */
export function needsImageForX(b: Block): boolean {
  return b.type === 'table' || b.type === 'art' || b.type === 'img';
}

export function docText(doc: Doc): string {
  return doc.blocks.map(blockText).filter(Boolean).join('\n\n');
}

/** First ~200 characters of prose, for OG description and the Nostr summary tag. */
export function docSummary(doc: Doc, max = 200): string {
  if (doc.subtitle.trim()) return truncate(doc.subtitle.trim(), max);
  const prose = doc.blocks
    .filter((b) => b.type === 'p' || b.type === 'quote')
    .map(blockText)
    .filter(Boolean)
    .join(' ');
  return truncate(prose, max);
}

function truncate(s: string, max: number): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1).replace(/\s\S*$/, '') + '…';
}

/** First image in the document — the OG image when no cover is set. */
export function firstImage(doc: Doc): string | undefined {
  if (doc.cover) return doc.cover;
  const img = doc.blocks.find((b): b is ImageBlock => b.type === 'img');
  return img?.src;
}

export function wordCount(doc: Doc): number {
  const t = docText(doc).trim();
  return t ? t.split(/\s+/).length : 0;
}

export function readingMinutes(doc: Doc): number {
  return Math.max(1, Math.round(wordCount(doc) / 220));
}

/** URL-safe slug from the title, used for the node page path and the `d` tag. */
export function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || 'untitled';
}
