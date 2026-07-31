/**
 * The no-API path to a native X Article.
 *
 * Measured against the real editor, not the docs:
 *   survives  h1, h2, bold, italic, strike, links, lists, blockquote,
 *             long paragraphs, all unicode
 *   lost      h3 (demoted to body text), inline code, code blocks (become
 *             plain text), and EVERY image — hosted URL and data URL alike
 *   also      the title field is not populated by a paste; the h1 lands in
 *             the body and the title stays empty
 *
 * So "copy for X" cannot be a dumb copy. It is a transform that targets what X
 * can actually do, and it hands back an explicit manifest of what the author
 * has to place by hand. Losing things loudly beats losing them silently.
 */

import type { Doc, Block, Inline } from '../model.js';
import { inlineText } from '../model.js';

export interface XImageItem {
  /** 1-based, matching the marker in the pasted body. */
  index: number;
  kind: 'cover' | 'image' | 'table' | 'art';
  label: string;
  /** data: URL for generated blocks, http(s) for author-supplied images. */
  src: string;
  alt: string;
  blockId?: string;
}

export interface XExport {
  /** Paste into X's title field. */
  title: string;
  /** Paste into the body. Rich HTML — X's editor reads text/html. */
  bodyHtml: string;
  /** Plain-text fallback flavour. */
  bodyText: string;
  images: XImageItem[];
  /** Human-readable notes about what was transformed, shown before they click. */
  warnings: string[];
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inlineToHtml(items: Inline[]): string {
  return items
    .map((i) => {
      if (!i.text) return '';
      let t = esc(i.text);
      const marks = i.marks ?? [];
      // No inline-code equivalent survives, so it degrades to plain text
      // rather than arriving as a stray backtick.
      if (marks.includes('b')) t = `<strong>${t}</strong>`;
      if (marks.includes('i')) t = `<em>${t}</em>`;
      if (marks.includes('s')) t = `<s>${t}</s>`;
      if (i.href) t = `<a href="${esc(i.href)}">${t}</a>`;
      return t;
    })
    .join('');
}

/**
 * Rendered images for blocks X cannot express, keyed by block id.
 * Supplied by the caller because rendering needs a canvas.
 */
export type RenderedMap = Record<string, { dataUrl: string; alt: string }>;

export function buildXExport(doc: Doc, rendered: RenderedMap = {}): XExport {
  const images: XImageItem[] = [];
  const warnings: string[] = [];
  const html: string[] = [];
  const text: string[] = [];

  let imgN = 0;
  const marker = (kind: XImageItem['kind'], label: string, src: string, alt: string, blockId?: string) => {
    imgN += 1;
    images.push({ index: imgN, kind, label, src, alt, blockId });
    // A visible marker in the pasted body, so the author knows exactly where
    // each image goes instead of guessing from memory.
    html.push(`<p><strong>[IMAGE ${imgN} — ${esc(label)}]</strong></p>`);
    text.push(`[IMAGE ${imgN} — ${label}]`);
  };

  if (doc.cover) {
    imgN += 1;
    images.push({ index: imgN, kind: 'cover', label: 'Cover image', src: doc.cover, alt: doc.title });
    // The cover is set in X's own header UI, not pasted into the body.
    imgN -= 1;
    images[images.length - 1]!.index = 0;
  }

  let demotedH3 = 0;
  let flattenedCode = 0;

  for (const b of doc.blocks) {
    switch (b.type) {
      case 'h1':
        // The h1 is the title; emitting it again would duplicate it in the body.
        break;
      case 'h2':
        html.push(`<h2>${inlineToHtml(b.content)}</h2>`);
        text.push(inlineText(b.content));
        break;
      case 'h3':
        // X flattens h3 to body text. Flatten it deliberately to bold so it
        // still READS as a heading instead of dissolving into prose.
        demotedH3 += 1;
        html.push(`<p><strong>${inlineToHtml(b.content)}</strong></p>`);
        text.push(inlineText(b.content));
        break;
      case 'p': {
        const h = inlineToHtml(b.content);
        if (h.trim()) { html.push(`<p>${h}</p>`); text.push(inlineText(b.content)); }
        break;
      }
      case 'quote':
        html.push(`<blockquote>${inlineToHtml(b.content)}</blockquote>`);
        text.push(inlineText(b.content));
        break;
      case 'code': {
        // Code blocks arrive as plain text but keep their line breaks, which is
        // readable enough. Rendering them as an image would cost selectability
        // for little gain.
        flattenedCode += 1;
        const raw = inlineText(b.content);
        html.push(`<p>${esc(raw).replace(/\n/g, '<br>')}</p>`);
        text.push(raw);
        break;
      }
      case 'ul':
        html.push(`<ul>${b.items.map((i) => `<li>${inlineToHtml(i)}</li>`).join('')}</ul>`);
        b.items.forEach((i) => text.push('• ' + inlineText(i)));
        break;
      case 'ol':
        html.push(`<ol>${b.items.map((i) => `<li>${inlineToHtml(i)}</li>`).join('')}</ol>`);
        b.items.forEach((i, n) => text.push(`${n + 1}. ` + inlineText(i)));
        break;
      case 'hr':
        // No rule primitive; a blank paragraph is the closest honest analogue.
        html.push('<p></p>');
        text.push('');
        break;
      case 'embed':
        html.push(`<p>${esc(b.url)}</p>`);
        text.push(b.url);
        break;
      case 'img':
        if (b.src) marker('image', b.caption || b.alt || 'Image', b.src, b.alt ?? '', b.id);
        break;
      case 'table': {
        const r = rendered[b.id];
        marker('table', b.caption || 'Table', r?.dataUrl ?? '', r?.alt ?? 'Table', b.id);
        break;
      }
      case 'art': {
        const r = rendered[b.id];
        marker('art', b.caption || 'Diagram', r?.dataUrl ?? '', r?.alt ?? 'Diagram', b.id);
        break;
      }
    }
  }

  if (images.length) {
    warnings.push(
      `${images.length} image${images.length > 1 ? 's' : ''} must be added by hand — ` +
      `pasting into X drops images entirely. Markers show where each one goes.`,
    );
  }
  if (demotedH3) {
    warnings.push(
      `${demotedH3} level-3 heading${demotedH3 > 1 ? 's' : ''} converted to bold — ` +
      `X Articles only have two heading levels.`,
    );
  }
  if (flattenedCode) {
    warnings.push(`${flattenedCode} code block${flattenedCode > 1 ? 's' : ''} flattened to plain text.`);
  }
  warnings.push('Paste the title separately — a body paste leaves X’s title field empty.');

  return {
    title: doc.title.trim() || 'Untitled',
    bodyHtml: html.join('\n'),
    bodyText: text.join('\n\n'),
    images,
    warnings,
  };
}

/**
 * Put the body on the clipboard in both flavours.
 * Rich-text targets read text/html; everything else gets the plain fallback.
 */
export async function copyBody(x: XExport): Promise<void> {
  await navigator.clipboard.write([
    new ClipboardItem({
      'text/html': new Blob([x.bodyHtml], { type: 'text/html' }),
      'text/plain': new Blob([x.bodyText], { type: 'text/plain' }),
    }),
  ]);
}

export async function copyTitle(x: XExport): Promise<void> {
  await navigator.clipboard.writeText(x.title);
}
