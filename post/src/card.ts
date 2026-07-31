/**
 * The 1200×630 card — the entire visual payload of a post on X.
 *
 * X strips headlines and descriptions from link cards, so this image is not an
 * illustration next to some text. It IS the card. Whatever is not in these pixels
 * does not exist in the feed.
 *
 * TWO STAGES, deliberately. The artifact itself (table, code, diagram) is drawn
 * by the editor's renderers in `editor/src/render/block-png.ts` at whatever size
 * the content needs. This module then *composes* that variable-size image into
 * the fixed 1200×630 frame. Splitting it that way means the table renderer has
 * one job and is shared with the editor, rather than existing twice with
 * different cell padding.
 *
 * TERMS OF SERVICE, since this draws something that appears inside X:
 *   - No X badge, logo, verified tick, or any element of X's chrome is drawn.
 *     A card that imitates X's own UI is passing itself off as X.
 *   - No cloaking. The crawler and a human visiting the permalink receive the
 *     same page and the same image. Serving one thing to the unfurler and
 *     another to people is the line that gets domains blocked.
 *   - The image URL is content-addressed, so a given URL always renders the same
 *     bytes and a card cannot be swapped out after it has been shared.
 */

import {
  renderTablePng,
  renderMonoPng,
  DARK,
  type PngTheme,
  type RenderedImage,
} from '../../editor/src/render/block-png.js';
import type { Post, Attachment } from './model.js';
import { cardAlt } from './model.js';

/**
 * Logical card size — the coordinate space everything is laid out in.
 *
 * NOT the size of the emitted file. The canvas is scaled by the theme's device
 * pixel ratio, so a `scale: 2` render produces a 2400×1260 PNG. `renderPostCard`
 * returns the real dimensions, and the permalink page must declare THOSE in
 * `og:image:width` — metadata that contradicts the asset is worse than none.
 */
export const CARD_W = 1200;
export const CARD_H = 630;

/* ------------------------------------------------------------------ *
 * Layout arithmetic — pure, so it can be tested without a browser
 * ------------------------------------------------------------------ */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Fit a source rectangle inside a destination box without distorting it.
 *
 * `maxScale` is the honest upper bound on enlargement, and 1 is the wrong default
 * for this card. The artifact bitmaps come out of `block-png.ts` rendered at the
 * theme's device pixel ratio, so drawing a 2x bitmap at 2x logical size is still
 * exactly 1:1 in real pixels — no blur. Capping at 1 made a table occupy half the
 * width it should have, which is what the first rendered card actually looked
 * like.
 *
 * Above the artifact's own density it WOULD blur, and unreadable code defeats the
 * entire point of rendering code as an image. So the cap stays; it is just set to
 * the right number.
 */
export function fitBox(srcW: number, srcH: number, dest: Box, maxScale = 1): Box {
  if (srcW <= 0 || srcH <= 0) return { ...dest, w: 0, h: 0 };
  const scale = Math.min(dest.w / srcW, dest.h / srcH, maxScale);
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);
  return {
    x: Math.round(dest.x + (dest.w - w) / 2),
    y: Math.round(dest.y + (dest.h - h) / 2),
    w,
    h,
  };
}

export interface CardChrome {
  /** Space reserved above the artifact for the eyebrow and heading. */
  top: number;
  /** Space reserved below for the byline. */
  bottom: number;
  side: number;
}

export const CHROME: CardChrome = { top: 132, bottom: 96, side: 64 };

/** The region an artifact may occupy. Everything else is frame. */
export function contentBox(chrome: CardChrome = CHROME, hasHeading = true): Box {
  const top = hasHeading ? chrome.top : chrome.top - 46;
  return {
    x: chrome.side,
    y: top,
    w: CARD_W - chrome.side * 2,
    h: CARD_H - top - chrome.bottom,
  };
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

/** Draw the artifact at its natural size. Delegates to the editor's renderers. */
export function renderArtifact(a: Attachment, theme: PngTheme = DARK): RenderedImage {
  switch (a.kind) {
    case 'table':
      return renderTablePng(a.table, theme);
    case 'code':
      return renderMonoPng(a.text, { theme, caption: a.caption, accentFirstLine: true });
    case 'art':
      return renderMonoPng(a.art.text, { theme, caption: a.art.caption });
    case 'quote':
      // A quote is type, not a picture of type, so it is drawn by the composer
      // directly rather than rasterised first.
      return { dataUrl: '', width: 0, height: 0, alt: a.text };
  }
}

export interface CardOptions {
  domain: string;
  authorName: string;
  handle?: string;
  npubShort?: string;
  theme?: PngTheme;
}

const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif';
const SERIF = 'ui-serif, Georgia, "Times New Roman", serif';

/**
 * Compose the card.
 *
 * Returns a data URL plus the alt text, because an image without alt text is an
 * empty post to anyone using a screen reader — and here the image is the post.
 */
export async function renderPostCard(p: Post, o: CardOptions): Promise<RenderedImage> {
  const theme = o.theme ?? DARK;
  const S = theme.scale;

  const canvas = document.createElement('canvas');
  canvas.width = CARD_W * S;
  canvas.height = CARD_H * S;
  const g = canvas.getContext('2d')!;
  g.scale(S, S);

  // Background
  g.fillStyle = theme.bg;
  g.fillRect(0, 0, CARD_W, CARD_H);

  const wash = g.createLinearGradient(0, CARD_H, CARD_W, 0);
  wash.addColorStop(0, 'rgba(124,156,255,0.13)');
  wash.addColorStop(0.6, 'rgba(62,207,142,0.05)');
  wash.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = wash;
  g.fillRect(0, 0, CARD_W, CARD_H);

  const bar = g.createLinearGradient(0, 0, CARD_W, 0);
  bar.addColorStop(0, '#7c9cff');
  bar.addColorStop(1, '#3ecf8e');
  g.fillStyle = bar;
  g.fillRect(0, 0, CARD_W, 5);

  // Eyebrow — the domain, never a badge or a tick.
  g.fillStyle = theme.dim;
  g.font = `500 21px ${SANS}`;
  g.letterSpacing = '3px';
  g.fillText(o.domain.toUpperCase(), CHROME.side, 66);
  g.letterSpacing = '0px';

  const heading = p.heading?.trim();
  if (heading) {
    g.fillStyle = theme.ink;
    g.font = `700 40px ${SANS}`;
    g.fillText(clip(g, heading, CARD_W - CHROME.side * 2), CHROME.side, 116);
  }

  const dest = contentBox(CHROME, Boolean(heading));

  if (p.attachment?.kind === 'quote') {
    drawQuote(g, p.attachment.text, p.attachment.attribution, dest, theme);
  } else if (p.attachment) {
    const art = renderArtifact(p.attachment, theme);
    const img = await loadImage(art.dataUrl);
    // Up to the artifact's own pixel density — see fitBox.
    const at = fitBox(art.width, art.height, dest, S);
    g.drawImage(img, at.x, at.y, at.w, at.h);
  } else {
    // No artifact: the prose is the subject. Set it large — this is the one
    // case where the card competes with a plain X post, and it should look
    // like something made on purpose.
    drawQuote(g, p.text, undefined, dest, theme);
  }

  // Footer
  g.strokeStyle = 'rgba(255,255,255,0.09)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(CHROME.side, CARD_H - 74);
  g.lineTo(CARD_W - CHROME.side, CARD_H - 74);
  g.stroke();

  g.fillStyle = theme.ink;
  g.font = `600 24px ${SANS}`;
  const by = o.handle ? `${o.authorName}  ·  @${o.handle.replace(/^@/, '')}` : o.authorName;
  g.fillText(by, CHROME.side, CARD_H - 34);

  if (o.npubShort) {
    g.textAlign = 'right';
    g.fillStyle = theme.dim;
    g.font = `400 18px ui-monospace, Menlo, Consolas, monospace`;
    g.fillText(o.npubShort, CARD_W - CHROME.side, CARD_H - 34);
    g.textAlign = 'left';
  }

  return {
    dataUrl: canvas.toDataURL('image/png'),
    // The emitted file, not the layout box. See CARD_W.
    width: canvas.width,
    height: canvas.height,
    alt: cardAlt(p),
  };
}

/** Large wrapped type, used for quotes and for prose-only cards. */
function drawQuote(
  g: CanvasRenderingContext2D,
  text: string,
  attribution: string | undefined,
  box: Box,
  theme: PngTheme,
): void {
  const body = text.trim();
  if (!body) return;

  // Step the size down until it fits rather than truncating. A quote that ends
  // mid-sentence is worse than a quote set slightly smaller.
  for (const size of [52, 46, 40, 34, 29, 25]) {
    const lh = Math.round(size * 1.34);
    const lines = wrapText(g, body, box.w - 34, `400 ${size}px ${SERIF}`, 99);
    const needed = lines.length * lh + (attribution ? 42 : 0);
    if (needed > box.h && size !== 25) continue;

    const start = box.y + Math.max(0, Math.round((box.h - needed) / 2)) + size;

    g.fillStyle = theme.accent;
    g.fillRect(box.x, start - size + 4, 4, lines.length * lh - 6);

    g.fillStyle = theme.ink;
    g.font = `400 ${size}px ${SERIF}`;
    let y = start;
    const maxLines = Math.floor((box.h - (attribution ? 42 : 0)) / lh);
    for (const line of lines.slice(0, Math.max(1, maxLines))) {
      g.fillText(line, box.x + 26, y);
      y += lh;
    }
    if (attribution) {
      g.fillStyle = theme.dim;
      g.font = `500 22px ${SANS}`;
      g.fillText(`— ${attribution}`, box.x + 26, y + 14);
    }
    return;
  }
}

function wrapText(
  g: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  font: string,
  maxLines: number,
): string[] {
  g.font = font;
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const w of para.trim().split(/\s+/)) {
      const c = line ? `${line} ${w}` : w;
      if (g.measureText(c).width <= maxWidth) { line = c; continue; }
      if (line) lines.push(line);
      line = w;
      if (lines.length >= maxLines) return lines;
    }
    lines.push(line);
  }
  return lines;
}

function clip(g: CanvasRenderingContext2D, s: string, max: number): string {
  if (g.measureText(s).width <= max) return s;
  let t = s;
  while (t.length > 1 && g.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('card artifact failed to rasterise'));
    img.src = src;
  });
}
