/**
 * The image escape hatch.
 *
 * X Articles support headings, bold/italic/strike, lists, quotes, links, and
 * images. That's the whole set — no tables, no monospace, no layout. But images
 * are unrestricted, so anything X cannot render structurally, we render as a
 * picture.
 *
 * The same source block becomes a real <table> on the node page and a markdown
 * table on Nostr. Only X gets the picture, and only because it has to.
 *
 * Rendered on canvas here for preview and download. The node runs the identical
 * layout server-side (GD/satori), because X's crawler and X's editor both need
 * a URL, not a data blob.
 *
 * Two costs worth stating plainly: text inside an image isn't selectable or
 * searchable on X, and screen readers get only the alt text. Both are solved on
 * the node page, where it stays real HTML — which is another argument for the
 * node page being the canonical copy.
 */

import type { TableBlock, ArtBlock, Inline } from '../model.js';
import { inlineText } from '../model.js';

export interface PngTheme {
  bg: string;
  ink: string;
  dim: string;
  line: string;
  accent: string;
  headerBg: string;
  /** Device pixel ratio for the render. 2 keeps it crisp on retina and in-feed. */
  scale: number;
}

export const DARK: PngTheme = {
  bg: '#0d0e11', ink: '#e8eaed', dim: '#9aa1ad', line: '#2c313c',
  accent: '#7c9cff', headerBg: '#171a21', scale: 2,
};

export const LIGHT: PngTheme = {
  bg: '#ffffff', ink: '#16181c', dim: '#5b6270', line: '#e2e5ea',
  accent: '#3b5bdb', headerBg: '#f5f6f8', scale: 2,
};

const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

export interface RenderedImage {
  dataUrl: string;
  width: number;
  height: number;
  /** Alt text, so the image is not a dead end for screen readers. */
  alt: string;
}

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

export function renderTablePng(t: TableBlock, theme: PngTheme = DARK): RenderedImage {
  const S = theme.scale;
  const PAD_X = 18;
  const PAD_Y = 13;
  const FONT = 16;
  const CAPTION = 14;
  const MARGIN = 28;
  const MAX_W = 1200;

  const probe = document.createElement('canvas').getContext('2d')!;
  const cells = t.rows.map((row) => row.map((c) => inlineText(c)));
  const cols = Math.max(1, ...cells.map((r) => r.length));

  // Natural column widths from the widest cell, then scaled down together if
  // the table would overflow. Scaling the whole table keeps relative widths.
  const colW: number[] = [];
  for (let c = 0; c < cols; c++) {
    let w = 0;
    for (let r = 0; r < cells.length; r++) {
      const isHead = t.header && r === 0;
      probe.font = `${isHead ? 600 : 400} ${FONT}px ${SANS}`;
      w = Math.max(w, probe.measureText(cells[r]?.[c] ?? '').width);
    }
    colW.push(Math.ceil(w) + PAD_X * 2);
  }

  let totalW = colW.reduce((a, b) => a + b, 0);
  if (totalW > MAX_W - MARGIN * 2) {
    const k = (MAX_W - MARGIN * 2) / totalW;
    for (let i = 0; i < colW.length; i++) colW[i] = Math.floor(colW[i]! * k);
    totalW = colW.reduce((a, b) => a + b, 0);
  }

  const rowH = FONT + PAD_Y * 2;
  const capH = t.caption ? CAPTION + 16 : 0;
  const W = totalW + MARGIN * 2;
  const H = rowH * cells.length + MARGIN * 2 + capH;

  const canvas = document.createElement('canvas');
  canvas.width = W * S;
  canvas.height = H * S;
  const g = canvas.getContext('2d')!;
  g.scale(S, S);

  g.fillStyle = theme.bg;
  g.fillRect(0, 0, W, H);

  let y = MARGIN;
  for (let r = 0; r < cells.length; r++) {
    const isHead = t.header && r === 0;
    let x = MARGIN;

    if (isHead) {
      g.fillStyle = theme.headerBg;
      g.fillRect(MARGIN, y, totalW, rowH);
    }

    for (let c = 0; c < cols; c++) {
      const text = cells[r]?.[c] ?? '';
      g.font = `${isHead ? 600 : 400} ${FONT}px ${SANS}`;
      g.fillStyle = isHead ? theme.ink : theme.dim;
      g.textBaseline = 'middle';
      g.fillText(clip(g, text, colW[c]! - PAD_X * 2), x + PAD_X, y + rowH / 2);
      x += colW[c]!;
    }

    // Rule under the header is accent-coloured; body rules are quiet.
    g.strokeStyle = isHead ? theme.accent : theme.line;
    g.lineWidth = isHead ? 1.5 : 1;
    g.beginPath();
    g.moveTo(MARGIN, y + rowH);
    g.lineTo(MARGIN + totalW, y + rowH);
    g.stroke();

    y += rowH;
  }

  if (t.caption) {
    g.font = `400 ${CAPTION}px ${SANS}`;
    g.fillStyle = theme.dim;
    g.textBaseline = 'top';
    g.fillText(t.caption, MARGIN, y + 12);
  }

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: W,
    height: H,
    alt: tableAlt(t),
  };
}

/** Screen-readable description, so the X copy isn't a dead end. */
export function tableAlt(t: TableBlock): string {
  const rows = t.rows.map((r) => r.map(inlineText).join(', '));
  const head = t.header ? `Columns: ${rows[0]}. ` : '';
  const body = (t.header ? rows.slice(1) : rows).join('; ');
  return `Table. ${head}${body}`.slice(0, 900);
}

function clip(g: CanvasRenderingContext2D, text: string, max: number): string {
  if (g.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && g.measureText(s + '…').width > max) s = s.slice(0, -1);
  return s + '…';
}

/* ------------------------------------------------------------------ */
/* Monospace: character art and code                                   */
/* ------------------------------------------------------------------ */

export interface MonoOptions {
  theme?: PngTheme;
  fontSize?: number;
  caption?: string;
  /** Colour the text as code rather than art. */
  accentFirstLine?: boolean;
}

/**
 * Render monospace text as an image.
 *
 * This is the only way character art survives X: alignment depends on a
 * fixed-width font, X renders proportional, so as text every row shifts and the
 * picture falls apart. As an image it is exact.
 */
export function renderMonoPng(text: string, opts: MonoOptions = {}): RenderedImage {
  const theme = opts.theme ?? DARK;
  const S = theme.scale;
  const FONT = opts.fontSize ?? 15;
  const LH = Math.round(FONT * 1.45);
  const MARGIN = 26;
  const CAPTION = 14;

  const lines = text.replace(/\t/g, '    ').split('\n');
  // Trim trailing blank lines so art doesn't sit in a pool of empty space.
  while (lines.length > 1 && lines[lines.length - 1]!.trim() === '') lines.pop();

  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = `400 ${FONT}px ${MONO}`;
  // Measure a wide glyph rather than assuming a ratio — monospace advance
  // widths differ between the fallback fonts on different platforms.
  const chW = probe.measureText('M').width;
  const maxCols = Math.max(1, ...lines.map((l) => l.length));

  const capH = opts.caption ? CAPTION + 16 : 0;
  const W = Math.ceil(maxCols * chW) + MARGIN * 2;
  const H = lines.length * LH + MARGIN * 2 + capH;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, W) * S;
  canvas.height = Math.max(1, H) * S;
  const g = canvas.getContext('2d')!;
  g.scale(S, S);

  g.fillStyle = theme.bg;
  g.fillRect(0, 0, W, H);

  g.strokeStyle = theme.line;
  g.lineWidth = 1;
  g.strokeRect(0.5, 0.5, W - 1, H - 1);

  g.font = `400 ${FONT}px ${MONO}`;
  g.textBaseline = 'top';

  lines.forEach((line, i) => {
    g.fillStyle = opts.accentFirstLine && i === 0 ? theme.accent : theme.ink;
    // Draw the whole line in one call: per-character positioning would fight
    // the font's own advance and produce visible drift on long rows.
    g.fillText(line, MARGIN, MARGIN + i * LH);
  });

  if (opts.caption) {
    g.font = `400 ${CAPTION}px ${SANS}`;
    g.fillStyle = theme.dim;
    g.fillText(opts.caption, MARGIN, MARGIN + lines.length * LH + 10);
  }

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: W,
    height: H,
    alt: opts.caption
      ? `Diagram: ${opts.caption}`
      : `Monospace diagram, ${lines.length} lines`,
  };
}

export function renderArtPng(a: ArtBlock, theme: PngTheme = DARK): RenderedImage {
  return renderMonoPng(a.text, { theme, caption: a.caption, fontSize: 16 });
}

export function renderCodePng(content: Inline[], theme: PngTheme = DARK): RenderedImage {
  return renderMonoPng(inlineText(content), { theme, fontSize: 14 });
}

/** data: URL -> Blob, for downloads. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',');
  const mime = head!.match(/:(.*?);/)![1]!;
  const bin = atob(b64!);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
