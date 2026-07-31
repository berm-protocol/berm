/**
 * Block editor — DOM ↔ model.
 *
 * Each block is its own contenteditable element. That is deliberately not one
 * big contenteditable: per-block editing keeps the model clean, makes block
 * type changes trivial, and avoids the tag soup that browsers produce when
 * asked to manage a whole document.
 *
 * Inline formatting still goes through document.execCommand. It is deprecated
 * and universally implemented; the alternative is a custom selection engine,
 * which is a project of its own. The parser below tolerates whatever markup
 * the browser produces, so the mess never reaches the model.
 */

import type { Block, Inline, Mark, TextBlock, ListBlock } from '../model.js';
import { bid, newTable, newArt } from '../model.js';

/* ------------------------------------------------------------------ */
/* DOM -> model                                                        */
/* ------------------------------------------------------------------ */

const MARK_FOR_TAG: Record<string, Mark> = {
  B: 'b', STRONG: 'b',
  I: 'i', EM: 'i',
  S: 's', STRIKE: 's', DEL: 's',
  CODE: 'code',
};

/** Walk a contenteditable subtree into flat inline runs. */
export function parseInline(root: Node): Inline[] {
  const out: Inline[] = [];

  const walk = (node: Node, marks: Mark[], href?: string) => {
    if (node.nodeType === Node.TEXT_NODE) {
      // Browsers insert U+00A0 to keep trailing/collapsing spaces visible.
      // Those are rendering artifacts, not authored content — normalising here
      // keeps them out of the markdown, the DraftJS payload, and the signed event.
      const text = (node.textContent ?? '').replace(/ /g, ' ');
      if (!text) return;
      const run: Inline = { text };
      if (marks.length) run.marks = [...new Set(marks)];
      if (href) run.href = href;
      out.push(run);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as HTMLElement;
    if (el.tagName === 'BR') { out.push({ text: '\n' }); return; }

    const nextMarks = MARK_FOR_TAG[el.tagName] ? [...marks, MARK_FOR_TAG[el.tagName]!] : marks;
    const nextHref = el.tagName === 'A' ? (el as HTMLAnchorElement).getAttribute('href') ?? href : href;

    for (const child of Array.from(el.childNodes)) walk(child, nextMarks, nextHref);
  };

  for (const child of Array.from(root.childNodes)) walk(child, []);
  return mergeRuns(out);
}

/** Collapse adjacent runs with identical formatting. Browsers love to emit
 *  `<b>He</b><b>llo</b>`; the model should not carry that. */
function mergeRuns(runs: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const r of runs) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.href === r.href &&
      JSON.stringify(prev.marks ?? []) === JSON.stringify(r.marks ?? [])
    ) {
      prev.text += r.text;
    } else {
      out.push({ ...r });
    }
  }
  return out.filter((r) => r.text.length > 0);
}

/* ------------------------------------------------------------------ */
/* model -> DOM                                                        */
/* ------------------------------------------------------------------ */

export function inlineToDom(items: Inline[]): string {
  if (!items.length) return '';
  return items
    .map((i) => {
      let html = escapeHtml(i.text).replace(/\n/g, '<br>');
      for (const m of i.marks ?? []) {
        html =
          m === 'b' ? `<strong>${html}</strong>` :
          m === 'i' ? `<em>${html}</em>` :
          m === 's' ? `<s>${html}</s>` :
          `<code>${html}</code>`;
      }
      if (i.href) html = `<a href="${escapeHtml(i.href)}">${html}</a>`;
      return html;
    })
    .join('');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ------------------------------------------------------------------ */
/* Block factories and transforms                                      */
/* ------------------------------------------------------------------ */

export const TEXT_TYPES = ['h1', 'h2', 'h3', 'p', 'quote', 'code'] as const;
export const LIST_TYPES = ['ul', 'ol'] as const;

export function isTextBlock(b: Block): b is TextBlock {
  return (TEXT_TYPES as readonly string[]).includes(b.type);
}
export function isListBlock(b: Block): b is ListBlock {
  return (LIST_TYPES as readonly string[]).includes(b.type);
}

export function newParagraph(content: Inline[] = []): TextBlock {
  return { id: bid(), type: 'p', content };
}

/** Convert a block to another type, preserving as much content as possible. */
export function convertBlock(b: Block, type: Block['type']): Block {
  const content: Inline[] = isTextBlock(b) ? b.content : isListBlock(b) ? b.items.flat() : [];

  if ((TEXT_TYPES as readonly string[]).includes(type)) {
    return { id: b.id, type: type as TextBlock['type'], content };
  }
  if ((LIST_TYPES as readonly string[]).includes(type)) {
    const items = isListBlock(b) ? b.items : content.length ? [content] : [[]];
    return { id: b.id, type: type as ListBlock['type'], items };
  }
  if (type === 'hr') return { id: b.id, type: 'hr' };
  if (type === 'img') return { id: b.id, type: 'img', src: '' };
  if (type === 'embed') return { id: b.id, type: 'embed', url: '' };
  if (type === 'table') return { ...newTable(), id: b.id };
  // Converting text into a diagram keeps the words, so an accidental
  // conversion is one undo rather than a retype.
  if (type === 'art') return { ...newArt(content.map((c) => c.text).join('')), id: b.id };
  return b;
}

/**
 * Markdown-style shortcuts, applied as the user types.
 * "## " becomes a heading, "- " a bullet, and so on — the interaction people
 * already expect from every modern editor.
 */
export function shortcutFor(text: string): { type: Block['type']; strip: number } | null {
  const table: [RegExp, Block['type']][] = [
    [/^# /, 'h1'],
    [/^## /, 'h2'],
    [/^### /, 'h3'],
    [/^> /, 'quote'],
    [/^```/, 'code'],
    [/^[-*] /, 'ul'],
    [/^1\. /, 'ol'],
    [/^---$/, 'hr'],
  ];
  for (const [re, type] of table) {
    const m = text.match(re);
    if (m) return { type, strip: m[0].length };
  }
  return null;
}
