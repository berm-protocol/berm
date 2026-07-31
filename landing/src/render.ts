/**
 * The page a card leads to.
 *
 * THE ONE RULE. A visitor clicked a table, so they get the table — above the
 * fold, ungated, no modal on load, no interstitial, no "read the rest by signing
 * up". The risk of putting a link on X is not marketing, it is DESTINATION
 * MISMATCH: a page that leads with a pitch is a bait-and-switch reached from a
 * post, and that is what gets a domain flagged. `test/render.test.ts` asserts the
 * order of the document, so this stays a structural property rather than an
 * intention.
 *
 * WHO IT IS FOR, both at once. Someone who has never heard of Nostr sees a clean
 * page by an author, with a quiet line saying it was verified. Someone who knows
 * what that line means sees the whole argument. Neither audience is served a
 * compromise, and the page never explains itself in the first screen.
 *
 * THE BEST ARGUMENT ON THE PAGE IS NOT COPY. It is the verdict line — computed in
 * the visitor's own browser against relays they can change. A demonstration
 * beats a headline, converts better, and costs no space.
 *
 * IT MUST HAND THEM A WAY TO LEAVE. The `nevent` is printed on the page. If the
 * same content does not resolve anywhere else, "sovereign" is a sticker on a
 * hosted page, so the exit is part of the deliverable rather than a courtesy.
 */

import { buildImeta, type ImetaFields } from './blossom.js';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface LandingArtifact {
  kind: 'table' | 'code' | 'art' | 'quote' | 'none';
  /** Real, copyable text. The card is a picture; this is the original. */
  text: string;
  /** Parsed rows, for a `table` — so the page emits a real <table>. */
  rows?: string[][];
  header?: boolean;
  language?: string;
  attribution?: string;
  caption?: string;
}

export interface LandingData {
  /** Prose the author wrote. */
  text: string;
  heading?: string;
  artifact: LandingArtifact;

  authorName: string;
  handle?: string;
  npub: string;
  pubkeyHex: string;
  createdAt: number;

  canonicalUrl: string;
  /** nevent1… so the same post resolves in any client. */
  nevent: string;
  eventId: string;
  /** Exact signed content, so the browser can compare byte-for-byte. */
  signedContent: string;

  cardUrl?: string;
  cardSha256?: string;
  cardSize?: { w: number; h: number };
  cardAlt?: string;
  /** Every host that may hold the card, for the fallback chain. */
  cardUrls?: string[];

  /** The author's NIP-65 write relays — where the data actually lives. */
  relays: string[];
  /** Profile page for this author on this host. */
  profileUrl?: string;
  /** Where "Try it" goes. */
  ctaUrl?: string;
}

export function metaTags(d: LandingData): string {
  const title = d.heading?.trim() || firstLine(d.text) || describeArtifact(d.artifact);
  const desc = (d.text.trim() || d.cardAlt || '').replace(/\s+/g, ' ').slice(0, 190);

  const tags = [
    `<meta name="description" content="${esc(desc)}">`,
    `<link rel="canonical" href="${esc(d.canonicalUrl)}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(d.canonicalUrl)}">`,
    `<meta name="twitter:card" content="${d.cardUrl ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
  ];

  if (d.cardUrl) {
    // Declared dimensions describe the BYTES a crawler fetches, not the layout
    // box — a 2x render is 2400×1260 and saying 1200×630 is metadata that
    // contradicts the asset.
    const size = d.cardSize ?? { w: 1200, h: 630 };
    tags.push(
      `<meta property="og:image" content="${esc(d.cardUrl)}">`,
      `<meta property="og:image:width" content="${size.w}">`,
      `<meta property="og:image:height" content="${size.h}">`,
      `<meta name="twitter:image" content="${esc(d.cardUrl)}">`,
      `<meta name="twitter:image:alt" content="${esc(d.cardAlt ?? title)}">`,
    );
  }
  if (d.handle) tags.push(`<meta name="twitter:creator" content="@${esc(d.handle.replace(/^@/, ''))}">`);

  tags.push(`<meta name="nostr:pubkey" content="${esc(d.npub)}">`);
  tags.push(`<meta name="nostr:event" content="${esc(d.nevent)}">`);
  return tags.join('\n');
}

const firstLine = (s: string) => {
  const l = s.trim().split('\n')[0]?.trim() ?? '';
  return l.length > 90 ? l.slice(0, 89) + '…' : l;
};

const describeArtifact = (a: LandingArtifact) =>
  ({ table: 'A table', code: 'A code snippet', art: 'A diagram', quote: 'A quote', none: 'A post' })[a.kind];

/** The artifact as real markup — selectable, searchable, screen-reader navigable. */
function artifactHtml(a: LandingArtifact): string {
  switch (a.kind) {
    case 'none':
      return '';
    case 'table': {
      const rows = a.rows ?? [];
      if (!rows.length) return '';
      const head = a.header
        ? `<thead><tr>${rows[0]!.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>`
        : '';
      const body = (a.header ? rows.slice(1) : rows)
        .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
        .join('');
      return (
        `<figure class="tbl"><table>${head}<tbody>${body}</tbody></table>` +
        (a.caption ? `<figcaption>${esc(a.caption)}</figcaption>` : '') +
        `</figure>` +
        // A picture of a table cannot be pasted into a spreadsheet.
        `<details class="copy"><summary>Copy as markdown</summary><pre>${esc(a.text)}</pre></details>`
      );
    }
    case 'code':
      return `<figure><pre class="code"><code>${esc(a.text)}</code></pre>` +
             (a.caption ? `<figcaption>${esc(a.caption)}</figcaption>` : '') + `</figure>`;
    case 'art':
      return `<figure><pre class="art" aria-label="${esc(a.caption ?? 'character diagram')}">${esc(a.text)}</pre>` +
             (a.caption ? `<figcaption>${esc(a.caption)}</figcaption>` : '') + `</figure>`;
    case 'quote':
      return `<blockquote>${esc(a.text)}` +
             (a.attribution ? `<footer>— ${esc(a.attribution)}</footer>` : '') + `</blockquote>`;
  }
}

/**
 * Data the hydration script needs, as JSON in the document.
 *
 * Embedded rather than fetched so the check can start immediately, and so the
 * page carries its own claims — a visitor viewing source sees exactly what the
 * page asserts about itself before any script runs.
 */
export function claimJson(d: LandingData): string {
  // Emitted whenever there IS an image, with the hash only if the author
  // committed to one. The distinction matters and was originally collapsed: a
  // post with no card at all has nothing to verify and is legitimately verified,
  // while a post that DISPLAYS a card nobody committed to is showing the visitor
  // bytes that cannot be checked. Skipping the check in the second case reported
  // it as verified — caught by the browser suite.
  const urls = d.cardUrls ?? (d.cardUrl ? [d.cardUrl] : []);
  const imeta: ImetaFields | null = urls.length
    ? (d.cardSha256 ? { urls, sha256: d.cardSha256 } : { urls })
    : null;
  return JSON.stringify({
    eventId: d.eventId,
    pubkeyHex: d.pubkeyHex,
    signedContent: d.signedContent,
    relays: d.relays,
    nevent: d.nevent,
    card: imeta,
    imetaTag: imeta ? buildImeta(imeta) : null,
  });
}

export function renderLanding(d: LandingData, opts: { hydrateScript?: string } = {}): string {
  const title = d.heading?.trim() || firstLine(d.text) || describeArtifact(d.artifact);
  const date = new Date(d.createdAt * 1000).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${metaTags(d)}
<style>
  :root { --ink:#16181c; --dim:#5b6270; --faint:#8b919c; --line:#e6e8ec; --bg:#fff;
          --accent:#3b5bdb; --good:#2f9e6e; --warn:#b3701a; --bad:#c62b45;
          --sans:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,system-ui,sans-serif; }
  @media (prefers-color-scheme: dark) {
    :root { --ink:#e8eaed; --dim:#9aa1ad; --faint:#787f8b; --line:#242832; --bg:#0d0e11;
            --accent:#7c9cff; --good:#3ecf8e; --warn:#f5a524; --bad:#f5556d; }
  }
  *{box-sizing:border-box}
  body { margin:0; background:var(--bg); color:var(--ink);
         font:18px/1.7 ui-serif,Georgia,serif; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:660px; margin:0 auto; padding:54px 22px 90px; }
  .who { display:flex; gap:9px; align-items:baseline; flex-wrap:wrap;
         font:14px var(--sans); color:var(--dim); margin-bottom:24px; }
  .who a { color:var(--ink); font-weight:600; font-size:15px; text-decoration:none; }
  .who a:hover { text-decoration:underline; }
  h1 { font:700 34px/1.2 var(--sans); letter-spacing:-.02em; margin:0 0 18px; }
  p.body { margin:0 0 20px; white-space:pre-wrap; }
  a { color:var(--accent); }
  figure { margin:28px 0; }
  .tbl { overflow-x:auto; }
  table { border-collapse:collapse; width:100%; font:15px/1.5 var(--sans); }
  th,td { text-align:left; padding:10px 13px; border-bottom:1px solid var(--line); }
  th { font-weight:600; border-bottom:2px solid var(--accent); }
  td { color:var(--dim); }
  pre { background:rgba(127,127,127,.09); border:1px solid var(--line); border-radius:8px;
        padding:14px; overflow-x:auto; font:14px/1.6 ui-monospace,Menlo,Consolas,monospace;
        white-space:pre; }
  blockquote { margin:28px 0; padding:4px 0 4px 20px; border-left:3px solid var(--accent);
               font-size:22px; line-height:1.5; }
  blockquote footer { font:15px var(--sans); color:var(--dim); margin-top:11px; }
  figcaption { font:14px var(--sans); color:var(--dim); text-align:center; margin-top:9px; }
  details.copy { margin:-14px 0 28px; font:14px var(--sans); }
  details.copy summary { cursor:pointer; color:var(--accent); }

  /* ---- the machinery. present, quiet, below the content ---- */
  .attest { margin:44px 0 0; padding:14px 0 0; border-top:1px solid var(--line);
            font:14px/1.6 var(--sans); }
  .vline { display:flex; gap:8px; align-items:center; font-weight:600; color:var(--faint); }
  .vline .dot { width:8px; height:8px; border-radius:50%; background:var(--faint); flex:none; }
  .attest[data-state=verified]  .vline { color:var(--good); }
  .attest[data-state=verified]  .dot  { background:var(--good); }
  .attest[data-state=unverified] .vline { color:var(--warn); }
  .attest[data-state=unverified] .dot  { background:var(--warn); }
  .attest[data-state=mismatch]  .vline { color:var(--bad); }
  .attest[data-state=mismatch]  .dot  { background:var(--bad); }
  .attest .detail { color:var(--dim); margin:8px 0 0; }
  .attest[data-state=mismatch] .detail { color:var(--bad); font-weight:600; }
  .exit { margin:16px 0 0; font:13px/1.7 var(--sans); color:var(--dim); }
  .exit code { font-size:12px; word-break:break-all; background:rgba(127,127,127,.1);
               padding:2px 5px; border-radius:4px; }
  .exit ul { margin:6px 0 0; padding-left:18px; }
  .exit li { margin:2px 0; }

  /* ---- the pitch. last. ---- */
  .cta { margin:40px 0 0; padding:18px 20px; border:1px solid var(--line); border-radius:12px;
         font:15px/1.6 var(--sans); }
  .cta h2 { font:700 16px var(--sans); margin:0 0 6px; }
  .cta p { margin:0 0 14px; color:var(--dim); }
  .cta a.btn { display:inline-block; background:var(--accent); color:#fff; text-decoration:none;
               padding:9px 16px; border-radius:8px; font-weight:600; font-size:14px; }
</style>
</head>
<body>
<div class="wrap">

<!-- CONTENT FIRST. No gate, no modal, no interstitial. See the module header. -->
<article>
  <div class="who">
    ${d.profileUrl ? `<a href="${esc(d.profileUrl)}">${esc(d.authorName)}</a>` : `<span>${esc(d.authorName)}</span>`}
    ${d.handle ? `<span>@${esc(d.handle.replace(/^@/, ''))}</span>` : ''}
    <span>·</span><span>${date}</span>
  </div>
  ${d.heading?.trim() ? `<h1>${esc(d.heading)}</h1>` : ''}
  ${d.text.trim() ? `<p class="body">${esc(d.text.trim())}</p>` : ''}
  ${artifactHtml(d.artifact)}
</article>

<!-- The strongest argument on this page, and it is evidence rather than copy.
     Starts as "checking" and is replaced by whatever the visitor's own browser
     concludes. It is never pre-set to a pass. -->
<div class="attest" id="attest" data-state="checking">
  <div class="vline"><span class="dot"></span><span id="vline">Checking against relays…</span></div>
  <p class="detail" id="vdetail">Fetching the signed original in your browser.</p>
  <div class="exit">
    This page is a rendering. The post itself is signed and stored on Nostr — open it anywhere:
    <ul>
      <li><code>${esc(d.nevent)}</code></li>
      <li>author <code>${esc(d.npub)}</code></li>
      ${d.relays.length ? `<li>relays ${d.relays.map((r) => `<code>${esc(r)}</code>`).join(' ')}</li>` : ''}
    </ul>
  </div>
</div>

<!-- The pitch, last, in the reader's terms rather than ours. -->
<div class="cta">
  <h2>Made with the XOnly editor</h2>
  <p>Post tables and code to X without them turning into mush — and keep the original
     somewhere that does not depend on X staying friendly.</p>
  <a class="btn" href="${esc(d.ctaUrl ?? '/')}">Try it</a>
</div>

</div>
<script type="application/json" id="claim">${claimJson(d).replace(/</g, '\\u003c')}</script>
<script>${opts.hydrateScript ?? ''}</script>
</body>
</html>`;
}
