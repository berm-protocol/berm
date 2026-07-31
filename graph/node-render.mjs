/**
 * The node's article renderer.
 *
 * THE PROPERTY THIS FILE EXISTS TO HAVE: `renderArticle` takes an article and a
 * public reaction set, and NOTHING about the reader. Not a session, not a
 * cookie, not an identity. It cannot personalise, because it is not given
 * anything to personalise with.
 *
 * That is why two readers get byte-identical responses, and why the page is
 * fully cacheable. The social-proof line is computed in the browser afterwards,
 * against a follow list the node never sees.
 *
 * If someone later adds a reader argument here to "improve" the widget, the
 * privacy property dies quietly. The byte-identity test is there to make that
 * change loud.
 */

import { createHash } from 'node:crypto';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/**
 * @param {{address: string, title: string, html: string, author: string}} article
 * @param {{address: string, events: Array, fetched_at: number}} reactions  public, article-scoped
 */
export function renderArticle(article, reactions) {
  // Sorted so the output is stable regardless of relay ordering — an unstable
  // byte stream would break both caching and the byte-identity check, and would
  // do it intermittently, which is the worst way for a test to fail.
  const events = [...reactions.events].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const payload = JSON.stringify({
    address: reactions.address,
    fetched_at: reactions.fetched_at,
    events,
  });

  return `<!doctype html>
<meta charset="utf-8">
<title>${esc(article.title)}</title>
<link rel="canonical" href="/a/${esc(article.address)}">
<meta property="og:title" content="${esc(article.title)}">
<meta property="og:type" content="article">
<article data-address="${esc(article.address)}">
<h1>${esc(article.title)}</h1>
${article.html}
</article>

<!-- Public reaction set for this article. Identical for every reader; the
     node cannot know which of these you follow, because the intersection
     happens in your browser. -->
<script type="application/json" id="berm-reactions">${payload.replace(/</g, '\\u003c')}</script>
<div id="social-proof" hidden></div>
<script src="/widget.js"></script>
`;
}

/** Convenience for tests and for the reconcile job. */
export function renderHash(article, reactions) {
  return createHash('sha256').update(renderArticle(article, reactions)).digest('hex');
}
