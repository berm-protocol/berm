/**
 * Target 3 — the node page.
 *
 * A standalone HTML document with correct card metadata. This is the canonical
 * URL: the one that survives an X suspension, the one the NIP-23 event points at
 * with an `r` tag, and the one whose OG tags decide what the in-feed card looks
 * like.
 *
 * Personalisation note: X's crawler is anonymous — no cookies, no session — so
 * a card can never be personalised per VIEWER. It can be personalised per URL,
 * which is all that's needed: a unique path renders unique tags and a unique
 * image. That is the mechanism behind every "share your stats" card in a feed.
 */

import type { Doc, Inline, Block } from '../model.js';
import { docSummary, firstImage, readingMinutes, inlineText } from '../model.js';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function inlineToHtml(items: Inline[]): string {
  return items
    .map((i) => {
      if (!i.text) return '';
      let t = esc(i.text);
      const marks = i.marks ?? [];
      if (marks.includes('code')) t = `<code>${t}</code>`;
      if (marks.includes('b')) t = `<strong>${t}</strong>`;
      if (marks.includes('i')) t = `<em>${t}</em>`;
      if (marks.includes('s')) t = `<s>${t}</s>`;
      if (i.href) t = `<a href="${esc(i.href)}" rel="noopener">${t}</a>`;
      return t;
    })
    .join('');
}

export function blockToHtml(b: Block): string {
  switch (b.type) {
    case 'h1': return `<h1>${inlineToHtml(b.content)}</h1>`;
    case 'h2': return `<h2>${inlineToHtml(b.content)}</h2>`;
    case 'h3': return `<h3>${inlineToHtml(b.content)}</h3>`;
    case 'p': {
      const h = inlineToHtml(b.content);
      return h.trim() ? `<p>${h}</p>` : '';
    }
    case 'quote': return `<blockquote>${inlineToHtml(b.content)}</blockquote>`;
    case 'code': return `<pre><code>${esc(inlineText(b.content))}</code></pre>`;
    case 'ul': return `<ul>${b.items.map((i) => `<li>${inlineToHtml(i)}</li>`).join('')}</ul>`;
    case 'ol': return `<ol>${b.items.map((i) => `<li>${inlineToHtml(i)}</li>`).join('')}</ol>`;
    case 'img':
      return `<figure><img src="${esc(b.src)}" alt="${esc(b.alt ?? '')}" loading="lazy">` +
             (b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : '') + `</figure>`;
    case 'hr': return '<hr>';
    case 'embed':
      return `<p class="embed"><a href="${esc(b.url)}" rel="noopener">${esc(b.url)}</a></p>`;

    // A real table: selectable, searchable, screen-reader navigable, and
    // styleable by the site owner. The PNG X receives is the lossy copy.
    case 'table': {
      const head = b.header && b.rows.length
        ? `<thead><tr>${b.rows[0]!.map((c) => `<th>${inlineToHtml(c)}</th>`).join('')}</tr></thead>`
        : '';
      const bodyRows = b.header ? b.rows.slice(1) : b.rows;
      const body = `<tbody>${bodyRows
        .map((r) => `<tr>${r.map((c) => `<td>${inlineToHtml(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody>`;
      return `<figure class="table-wrap"><table>${head}${body}</table>` +
             (b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : '') + `</figure>`;
    }

    // Real monospace, so the alignment survives and the characters stay
    // selectable — the one place character art is not a picture.
    case 'art':
      return `<figure class="art"><pre aria-label="${esc(b.caption ?? 'character diagram')}">` +
             `${esc(b.text)}</pre>` +
             (b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : '') + `</figure>`;
  }
}

export function docToBodyHtml(doc: Doc): string {
  return doc.blocks.map(blockToHtml).filter(Boolean).join('\n');
}

export interface NodePageOptions {
  canonicalUrl: string;
  authorName: string;
  authorHandle?: string;
  npub: string;
  /** Absolute URL of the generated card image. */
  ogImageUrl?: string;
  /** naddr / coordinate so any Nostr client can resolve the same article. */
  nostrCoordinate?: string;
  publishedAt?: number;
}

/**
 * Card metadata.
 *
 * X reads the `twitter:*` tags and falls back to `og:*`, so both are emitted.
 * `summary_large_image` is what produces the full-width card — the one that
 * actually stops a scroll.
 */
export function cardMeta(doc: Doc, o: NodePageOptions): string {
  const title = doc.title.trim() || 'Untitled';
  const desc = docSummary(doc, 180) || 'Published with XOnly.';
  const image = o.ogImageUrl ?? firstImage(doc);

  const tags: string[] = [
    `<meta name="description" content="${esc(desc)}">`,
    `<link rel="canonical" href="${esc(o.canonicalUrl)}">`,

    `<meta property="og:type" content="article">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(o.canonicalUrl)}">`,
    `<meta property="og:site_name" content="XOnly">`,

    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
  ];

  if (image) {
    tags.push(`<meta property="og:image" content="${esc(image)}">`);
    tags.push(`<meta property="og:image:width" content="1200">`);
    tags.push(`<meta property="og:image:height" content="630">`);
    tags.push(`<meta name="twitter:image" content="${esc(image)}">`);
    tags.push(`<meta name="twitter:image:alt" content="${esc(title)}">`);
  }
  if (o.authorHandle) {
    tags.push(`<meta name="twitter:creator" content="@${esc(o.authorHandle.replace(/^@/, ''))}">`);
  }
  if (o.publishedAt) {
    tags.push(`<meta property="article:published_time" content="${new Date(o.publishedAt * 1000).toISOString()}">`);
  }

  // Sovereignty metadata: anyone can resolve this article from relays even if
  // this page disappears. This is the machine-readable form of the promise.
  tags.push(`<meta name="nostr:pubkey" content="${esc(o.npub)}">`);
  if (o.nostrCoordinate) tags.push(`<meta name="nostr:coordinate" content="${esc(o.nostrCoordinate)}">`);

  return tags.join('\n');
}

export function docToNodePage(doc: Doc, o: NodePageOptions): string {
  const title = doc.title.trim() || 'Untitled';
  const mins = readingMinutes(doc);
  const date = new Date((o.publishedAt ?? Math.floor(Date.now() / 1000)) * 1000)
    .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${cardMeta(doc, o)}
<style>
  :root { --ink:#16181c; --dim:#5b6270; --line:#e6e8ec; --bg:#fff; --accent:#3b5bdb; }
  @media (prefers-color-scheme: dark) {
    :root { --ink:#e8eaed; --dim:#9aa1ad; --line:#262a33; --bg:#0d0e11; }
  }
  *{box-sizing:border-box}
  body { margin:0; background:var(--bg); color:var(--ink);
    font:19px/1.72 ui-serif,Georgia,'Times New Roman',serif; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:680px; margin:0 auto; padding:0 22px 120px; }
  header { padding:64px 0 30px; }
  h1 { font-size:44px; line-height:1.13; letter-spacing:-.02em; margin:0 0 14px;
       font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif; font-weight:700; }
  .sub { font-size:21px; color:var(--dim); margin:0 0 26px; line-height:1.5; }
  .byline { display:flex; gap:10px; align-items:center; font:14px/1.4 ui-sans-serif,system-ui,sans-serif;
            color:var(--dim); padding-bottom:26px; border-bottom:1px solid var(--line); }
  .byline strong { color:var(--ink); font-weight:600; }
  .cover { width:100%; border-radius:12px; margin:0 0 34px; display:block; }
  h2 { font-size:29px; letter-spacing:-.015em; margin:44px 0 12px;
       font-family:ui-sans-serif,system-ui,sans-serif; font-weight:700; }
  h3 { font-size:23px; margin:32px 0 10px; font-family:ui-sans-serif,system-ui,sans-serif; font-weight:600; }
  p { margin:0 0 22px; }
  a { color:var(--accent); }
  blockquote { margin:26px 0; padding:2px 0 2px 20px; border-left:3px solid var(--accent);
               color:var(--dim); font-style:italic; }
  pre { background:rgba(127,127,127,.09); border:1px solid var(--line); border-radius:8px; padding:15px;
        overflow-x:auto; font:14px/1.6 ui-monospace,Menlo,Consolas,monospace; }
  code { font:.88em ui-monospace,Menlo,Consolas,monospace; background:rgba(127,127,127,.12);
         padding:2px 5px; border-radius:4px; }
  pre code { background:none; padding:0; }
  ul,ol { margin:0 0 22px; padding-left:26px; } li { margin-bottom:8px; }
  .table-wrap { margin:32px 0; overflow-x:auto; }
  table { border-collapse:collapse; width:100%; font:15px/1.5 ui-sans-serif,system-ui,sans-serif; }
  th,td { text-align:left; padding:11px 14px; border-bottom:1px solid var(--line); }
  th { font-weight:600; border-bottom:2px solid var(--accent); }
  td { color:var(--dim); }
  .art pre { background:rgba(127,127,127,.07); border:1px solid var(--line); border-radius:8px;
             padding:18px; overflow-x:auto; font:14px/1.45 ui-monospace,Menlo,Consolas,monospace;
             white-space:pre; }
  figure { margin:32px 0; } figure img { width:100%; border-radius:10px; display:block; }
  figcaption { font:14px ui-sans-serif,system-ui,sans-serif; color:var(--dim);
               text-align:center; margin-top:10px; }
  hr { border:0; border-top:1px solid var(--line); margin:40px 0; }
  .embed a { font:15px ui-monospace,monospace; word-break:break-all; }
  footer { margin-top:64px; padding-top:26px; border-top:1px solid var(--line);
           font:13.5px/1.7 ui-sans-serif,system-ui,sans-serif; color:var(--dim); }
  footer code { font-size:12px; }
</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>${esc(title)}</h1>
  ${doc.subtitle.trim() ? `<p class="sub">${esc(doc.subtitle)}</p>` : ''}
  <div class="byline">
    <span><strong>${esc(o.authorName)}</strong>${o.authorHandle ? ` · @${esc(o.authorHandle.replace(/^@/, ''))}` : ''}</span>
    <span>·</span><span>${date}</span><span>·</span><span>${mins} min read</span>
  </div>
</header>
${doc.cover ? `<img class="cover" src="${esc(doc.cover)}" alt="">` : ''}
<article>
${docToBodyHtml(doc)}
</article>
<footer>
  This page is a rendering, not the original. The article is signed and stored on the Nostr
  network under <code>${esc(o.npub)}</code>${o.nostrCoordinate ? ` at <code>${esc(o.nostrCoordinate)}</code>` : ''}.
  If this site disappears, the work does not — any Nostr client can still resolve it.
</footer>
</div>
</body>
</html>`;
}
