/**
 * Dynamic card image, 1200×630.
 *
 * Rendered on canvas so the prototype needs no backend. In production the same
 * layout runs server-side at the node (satori/resvg or node-canvas) at the URL
 * in `og:image`, because X's crawler will not execute JavaScript.
 *
 * The crawler is also anonymous — no cookies, no session — so this can never be
 * personalised per VIEWER. It is personalised per URL, which is all that's
 * needed: a unique path yields a unique image.
 */

export interface CardData {
  title: string;
  subtitle?: string;
  authorName: string;
  handle?: string;
  readingMinutes: number;
  /** Shown as a small sovereignty mark in the corner. */
  npubShort?: string;
  domain: string;
}

const W = 1200;
const H = 630;

export function renderCard(canvas: HTMLCanvasElement, d: CardData): void {
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;

  // Background
  g.fillStyle = '#0a0b0d';
  g.fillRect(0, 0, W, H);

  // Accent wash — subtle, so the type stays the subject
  const grad = g.createLinearGradient(0, H, W, 0);
  grad.addColorStop(0, 'rgba(124,156,255,0.16)');
  grad.addColorStop(0.55, 'rgba(62,207,142,0.07)');
  grad.addColorStop(1, 'rgba(10,11,13,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  // Top rule
  const bar = g.createLinearGradient(0, 0, W, 0);
  bar.addColorStop(0, '#7c9cff');
  bar.addColorStop(1, '#3ecf8e');
  g.fillStyle = bar;
  g.fillRect(0, 0, W, 6);

  const PAD = 80;
  let y = 150;

  // Eyebrow
  g.fillStyle = '#8b919c';
  g.font = '500 24px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
  g.letterSpacing = '3px';
  g.fillText(d.domain.toUpperCase(), PAD, y);
  g.letterSpacing = '0px';
  y += 58;

  // Title — the whole card is really just this
  g.fillStyle = '#f3f4f6';
  const titleLines = wrap(g, d.title || 'Untitled', W - PAD * 2, '700 66px ui-sans-serif, system-ui, sans-serif', 3);
  g.font = '700 66px ui-sans-serif, system-ui, sans-serif';
  for (const line of titleLines) {
    g.fillText(line, PAD, y);
    y += 80;
  }

  // Subtitle
  if (d.subtitle?.trim()) {
    y += 12;
    g.fillStyle = '#9aa1ad';
    g.font = '400 32px ui-sans-serif, system-ui, sans-serif';
    const subLines = wrap(g, d.subtitle, W - PAD * 2, '400 32px ui-sans-serif, system-ui, sans-serif', 2);
    for (const line of subLines) {
      g.fillText(line, PAD, y);
      y += 44;
    }
  }

  // Footer rule
  g.strokeStyle = 'rgba(255,255,255,0.10)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(PAD, H - 118);
  g.lineTo(W - PAD, H - 118);
  g.stroke();

  // Byline
  g.fillStyle = '#e8eaed';
  g.font = '600 30px ui-sans-serif, system-ui, sans-serif';
  const by = d.handle ? `${d.authorName}  ·  @${d.handle.replace(/^@/, '')}` : d.authorName;
  g.fillText(by, PAD, H - 62);

  // Right-hand meta
  g.fillStyle = '#8b919c';
  g.font = '400 26px ui-sans-serif, system-ui, sans-serif';
  const meta = `${d.readingMinutes} min read`;
  g.textAlign = 'right';
  g.fillText(meta, W - PAD, H - 62);

  if (d.npubShort) {
    g.font = '400 20px ui-monospace, Menlo, Consolas, monospace';
    g.fillStyle = '#5a606b';
    g.fillText(d.npubShort, W - PAD, H - 26);
  }
  g.textAlign = 'left';
}

/** Greedy word wrap with an ellipsis on overflow. */
function wrap(
  g: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  font: string,
  maxLines: number,
): string[] {
  g.font = font;
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';

  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (g.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = w;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);

  if (lines.length === maxLines) {
    let last = lines[maxLines - 1]!;
    const consumed = lines.join(' ').length;
    if (consumed < text.trim().length) {
      while (g.measureText(last + '…').width > maxWidth && last.length > 1) {
        last = last.slice(0, -1);
      }
      lines[maxLines - 1] = last.replace(/\s+\S*$/, '') + '…';
    }
  }
  return lines;
}

export function cardToDataUrl(d: CardData): string {
  const canvas = document.createElement('canvas');
  renderCard(canvas, d);
  return canvas.toDataURL('image/png');
}
