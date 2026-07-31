/**
 * The permalink page — the copyable original, and the source of the card.
 *
 * TWO JOBS, and the second is the one people forget.
 *
 * 1. Carry the OG tags X's crawler reads. `summary_large_image` plus a 1200×630
 *    `og:image` is what produces a full-width card rather than a thumbnail.
 * 2. Carry the artifact as REAL TEXT. The card is a picture of a table, and a
 *    picture cannot be pasted into a spreadsheet or copied into an editor. The
 *    docs pipeline follows the same rule for code: render an image for the
 *    surface that destroys text, always link back to text that does not.
 *
 * NO CLOAKING. This single function generates the page for the crawler and for a
 * human. There is no user-agent branch and there is no place to add one — a page
 * that shows the unfurler something other than what a visitor sees is the
 * behaviour that gets a domain blocked, and it would also make the card a lie.
 */

import type { Post } from './model.js';
import { attachmentText, cardAlt, tableToMarkdown } from './model.js';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface PageOptions {
  canonicalUrl: string;
  authorName: string;
  handle?: string;
  npub: string;
  /** Absolute URL of the card. Content-addressed, so it cannot be swapped later. */
  cardUrl?: string;
  /**
   * ACTUAL pixel dimensions of the card image.
   *
   * Not the logical 1200×630. The card is rendered at a device pixel ratio for
   * crispness, so the file is 2400×1260, and `og:image:width` must describe the
   * bytes a crawler will fetch rather than the box we drew in. Declaring 1200×630
   * for a 2400×1260 file is metadata that contradicts the asset — the browser
   * check caught this, and it would otherwise have shipped.
   *
   * Aspect ratio is what X actually cares about, and 2400×1260 is the same 1.9:1.
   */
  cardSize?: { w: number; h: number };
  /** nevent / note id so any Nostr client resolves the same post. */
  nostrRef?: string;
  createdAt: number;
}

/** Title for the page and the card. Derived, because an untitled card is a blank one. */
export function pageTitle(p: Post): string {
  const h = p.heading?.trim();
  if (h) return h;
  const firstLine = p.text.trim().split('\n')[0]?.trim();
  if (firstLine) return firstLine.length > 90 ? firstLine.slice(0, 89) + '…' : firstLine;
  if (p.attachment) {
    return { table: 'A table', code: 'A code snippet', art: 'A diagram', quote: 'A quote' }[
      p.attachment.kind
    ];
  }
  return 'A post';
}

export function pageDescription(p: Post): string {
  const t = p.text.trim().replace(/\s+/g, ' ');
  if (t) return t.length > 190 ? t.slice(0, 189) + '…' : t;
  return cardAlt(p);
}

export function cardMeta(p: Post, o: PageOptions): string {
  const title = pageTitle(p);
  const desc = pageDescription(p);

  const tags = [
    `<meta name="description" content="${esc(desc)}">`,
    `<link rel="canonical" href="${esc(o.canonicalUrl)}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(o.canonicalUrl)}">`,
    `<meta property="og:site_name" content="XOnly">`,
    `<meta name="twitter:card" content="${o.cardUrl ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
  ];

  if (o.cardUrl) {
    const size = o.cardSize ?? { w: 1200, h: 630 };
    tags.push(
      `<meta property="og:image" content="${esc(o.cardUrl)}">`,
      `<meta property="og:image:width" content="${size.w}">`,
      `<meta property="og:image:height" content="${size.h}">`,
      `<meta name="twitter:image" content="${esc(o.cardUrl)}">`,
      // Alt is not optional here. The image is the entire card.
      `<meta name="twitter:image:alt" content="${esc(cardAlt(p))}">`,
    );
  }
  if (o.handle) {
    tags.push(`<meta name="twitter:creator" content="@${esc(o.handle.replace(/^@/, ''))}">`);
  }

  // Machine-readable form of the promise: this post is resolvable from relays
  // even if this page stops existing.
  tags.push(`<meta name="nostr:pubkey" content="${esc(o.npub)}">`);
  if (o.nostrRef) tags.push(`<meta name="nostr:ref" content="${esc(o.nostrRef)}">`);

  return tags.join('\n');
}

/** The artifact as real, selectable, copyable markup. */
function artifactHtml(p: Post): string {
  const a = p.attachment;
  if (!a) return '';

  switch (a.kind) {
    case 'table': {
      const cell = (c: { text: string }[]) => esc(c.map((i) => i.text).join(''));
      const rows = a.table.rows;
      const head = a.table.header && rows.length
        ? `<thead><tr>${rows[0]!.map((c) => `<th>${cell(c)}</th>`).join('')}</tr></thead>`
        : '';
      const body = (a.table.header ? rows.slice(1) : rows)
        .map((r) => `<tr>${r.map((c) => `<td>${cell(c)}</td>`).join('')}</tr>`)
        .join('');
      return (
        `<figure class="tbl"><table>${head}<tbody>${body}</tbody></table>` +
        (a.table.caption ? `<figcaption>${esc(a.table.caption)}</figcaption>` : '') +
        `</figure>` +
        // The paste-ready form, because a rendered table is not a portable one.
        `<details><summary>Copy as markdown</summary><pre class="md">${esc(tableToMarkdown(a.table))}</pre></details>`
      );
    }
    case 'code':
      return `<figure><pre class="code"><code>${esc(a.text)}</code></pre>` +
             (a.caption ? `<figcaption>${esc(a.caption)}</figcaption>` : '') + `</figure>`;
    case 'art':
      return `<figure><pre class="art" aria-label="${esc(a.art.caption ?? 'character diagram')}">${esc(a.art.text)}</pre>` +
             (a.art.caption ? `<figcaption>${esc(a.art.caption)}</figcaption>` : '') + `</figure>`;
    case 'quote':
      return `<blockquote>${esc(a.text)}` +
             (a.attribution ? `<footer>— ${esc(a.attribution)}</footer>` : '') + `</blockquote>`;
  }
}

export function postToPage(p: Post, o: PageOptions): string {
  const title = pageTitle(p);
  const date = new Date(o.createdAt * 1000).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${cardMeta(p, o)}
<style>
  :root { --ink:#16181c; --dim:#5b6270; --line:#e6e8ec; --bg:#fff; --accent:#3b5bdb; }
  @media (prefers-color-scheme: dark) {
    :root { --ink:#e8eaed; --dim:#9aa1ad; --line:#262a33; --bg:#0d0e11; --accent:#7c9cff; }
  }
  *{box-sizing:border-box}
  body { margin:0; background:var(--bg); color:var(--ink);
    font:18px/1.7 ui-serif,Georgia,serif; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:660px; margin:0 auto; padding:56px 22px 100px; }
  .who { display:flex; gap:9px; align-items:baseline; font:14px ui-sans-serif,system-ui,sans-serif;
         color:var(--dim); margin-bottom:26px; }
  .who strong { color:var(--ink); font-weight:600; font-size:15px; }
  p { margin:0 0 20px; white-space:pre-wrap; }
  a { color:var(--accent); }
  figure { margin:30px 0; }
  .tbl { overflow-x:auto; }
  table { border-collapse:collapse; width:100%; font:15px/1.5 ui-sans-serif,system-ui,sans-serif; }
  th,td { text-align:left; padding:10px 13px; border-bottom:1px solid var(--line); }
  th { font-weight:600; border-bottom:2px solid var(--accent); }
  td { color:var(--dim); }
  pre { background:rgba(127,127,127,.09); border:1px solid var(--line); border-radius:8px;
        padding:15px; overflow-x:auto; font:14px/1.6 ui-monospace,Menlo,Consolas,monospace;
        white-space:pre; }
  pre.md { font-size:13px; }
  blockquote { margin:30px 0; padding:4px 0 4px 20px; border-left:3px solid var(--accent);
               font-size:22px; line-height:1.5; }
  blockquote footer { font:15px ui-sans-serif,system-ui,sans-serif; color:var(--dim); margin-top:12px; }
  figcaption { font:14px ui-sans-serif,system-ui,sans-serif; color:var(--dim);
               text-align:center; margin-top:9px; }
  details { margin:-16px 0 30px; font:14px ui-sans-serif,system-ui,sans-serif; }
  summary { cursor:pointer; color:var(--accent); }
  footer.prov { margin-top:52px; padding-top:22px; border-top:1px solid var(--line);
                font:13.5px/1.7 ui-sans-serif,system-ui,sans-serif; color:var(--dim); }
  footer.prov code { font-size:12px; word-break:break-all; }
</style>
</head>
<body>
<div class="wrap">
<div class="who">
  <strong>${esc(o.authorName)}</strong>${o.handle ? `<span>@${esc(o.handle.replace(/^@/, ''))}</span>` : ''}
  <span>·</span><span>${date}</span>
</div>
${p.text.trim() ? `<p>${esc(p.text.trim())}</p>` : ''}
${artifactHtml(p)}
<footer class="prov">
  This page is a rendering, not the original. The post is signed and stored on the Nostr
  network under <code>${esc(o.npub)}</code>${o.nostrRef ? ` as <code>${esc(o.nostrRef)}</code>` : ''}.
  If this site disappears, the post does not — any Nostr client can still resolve it.
</footer>
</div>
</body>
</html>`;
}
