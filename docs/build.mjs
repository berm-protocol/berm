/**
 * The docs site, built to static HTML for GitHub Pages.
 *
 * WHY PAGES RATHER THAN A SERVER. The bytes a reader receives come from a public
 * commit anyone can diff against the source. On a VPS nobody can see what was
 * actually uploaded — you take the operator's word for it. This project's whole
 * posture is "every claim has a command," and hosting the documentation somewhere
 * its provenance is checkable is that claim applied to itself.
 *
 * `manifest.json` makes it concrete: SHA-256 of every deployed file, so a reader
 * can hash what they were served and compare. A deploy that lies is detectable
 * rather than merely unlikely.
 *
 * NO EXTERNAL ORIGINS. Same rule as every other artifact here: no CDN, no web
 * fonts, no analytics. A documentation site that loads a third-party script is a
 * supply-chain surface attached to a project whose selling point is not having
 * one, and the build fails rather than shipping it.
 *
 *   node docs/build.mjs            → docs/dist/
 *   node docs/build.mjs --check    → build, then verify nothing is missing
 */

import { readdir, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTENT = join(HERE, 'content');
const OUT = join(HERE, 'dist');

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* ------------------------------------------------------------------ *
 * Frontmatter — the same tiny parser check.mjs uses, for the same reason:
 * a YAML dependency in a docs build is a supply-chain surface for prose.
 * ------------------------------------------------------------------ */
function parseFrontmatter(text) {
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---\n', 4);
  if (end === -1) return null;
  const meta = {};
  for (const line of text.slice(4, end).split('\n')) {
    const m = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      meta[m[1]] = v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (/^\d+$/.test(v)) meta[m[1]] = Number(v);
    else meta[m[1]] = v;
  }
  return { meta, body: text.slice(end + 5) };
}

/* ------------------------------------------------------------------ *
 * Markdown — deliberately small
 *
 * Handles exactly what the documentation uses: headings, fenced code, tables,
 * lists, blockquotes, rules, links, inline code, bold, italic. Anything else is
 * escaped and passed through as a paragraph rather than silently mangled.
 *
 * A full markdown library would be a larger dependency than the site it renders,
 * and `docs/check.mjs` already constrains what the pages may contain.
 * ------------------------------------------------------------------ */

/** GitHub-flavoured heading slug — must match check.mjs's anchor resolution. */
export const anchor = (h) =>
  h.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');

function inline(s) {
  let t = esc(s);
  // Code first: its contents must not be re-processed for emphasis.
  const codes = [];
  t = t.replace(/`([^`]+)`/g, (_, c) => `\x00${codes.push(c) - 1}\x00`);
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, txt, href) => {
    const external = /^https?:\/\//.test(href);
    const to = href.startsWith('docs/') ? `${href.slice(5)}.html` : href;
    return `<a href="${esc(to)}"${external ? ' rel="noopener"' : ''}>${txt}</a>`;
  });
  // Lazy, not [^*]+. Bold containing nested emphasis — **a *word* inside** — has
  // an asterisk in the middle, so a negated-asterisk class cannot span it and the
  // markers render literally. That happened in the first sentence of the story
  // page, which is a good argument for rendering the docs before shipping them.
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[\s(])\*([^*]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/\x00(\d+)\x00/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
  return t;
}

function render(body) {
  const lines = body.split('\n');
  const out = [];
  let i = 0;

  const flushList = (tag, items) =>
    out.push(`<${tag}>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</${tag}>`);

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    // Fenced code — contents escaped, never interpreted.
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++;
      out.push(
        `<pre${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${esc(buf.join('\n'))}</code></pre>`,
      );
      continue;
    }

    const h = /^(#{1,6})\s+(.+)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim();
      const id = anchor(text);
      // Anchors are emitted for every heading because other pages link to them,
      // and docs/check.mjs fails the build on a dead anchor.
      out.push(`<h${level} id="${esc(id)}">${inline(text)}` +
               `<a class="hash" href="#${esc(id)}" aria-label="link to this section">#</a></h${level}>`);
      i++;
      continue;
    }

    // Tables. X destroys these on paste, which is exactly why the docs use them.
    if (line.startsWith('|') && /^\|[\s:|-]+\|$/.test(lines[i + 1] ?? '')) {
      const cells = (l) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(cells(lines[i++]));
      out.push(
        `<div class="tbl"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>` +
        `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,
      );
      continue;
    }

    /**
     * Lists, with continuation lines.
     *
     * A wrapped list item is indented under its bullet:
     *
     *     - **Nodes running the signer gate block a name-holder who cannot
     *       produce a valid attestation** under the pubkey they pinned.
     *
     * Taking only lines that START with a bullet split that into a list item
     * plus a stray paragraph, which broke every emphasis span crossing the wrap
     * — visible as literal asterisks in the rendered page. Continuation lines
     * are absorbed into the item they belong to.
     */
    const collectList = (start) => {
      const items = [];
      while (i < lines.length && start.test(lines[i])) {
        let text = lines[i++].replace(start, '');
        while (
          i < lines.length &&
          lines[i].trim() &&
          /^\s+/.test(lines[i]) &&
          !start.test(lines[i]) &&
          !/^\s*(```|>\s|\|)/.test(lines[i])
        ) {
          text += ' ' + lines[i++].trim();
        }
        items.push(text);
      }
      return items;
    };

    if (/^[-*]\s+/.test(line)) { flushList('ul', collectList(/^[-*]\s+/)); continue; }
    if (/^\d+\.\s+/.test(line)) { flushList('ol', collectList(/^\d+\.\s+/)); continue; }

    if (line.startsWith('> ')) {
      const buf = [];
      while (i < lines.length && lines[i].startsWith('> ')) buf.push(lines[i++].slice(2));
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { out.push('<hr>'); i++; continue; }

    const para = [];
    // Three backticks is a fence; ONE backtick starts a paragraph with inline
    // code, and treating it as a block boundary split every paragraph that
    // opened with `connect()` or similar mid-sentence.
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|>\s|\||```|[-*]\s|\d+\.\s)/.test(lines[i])) {
      para.push(lines[i++]);
    }
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    else i++;
  }

  return out.join('\n');
}

/* ------------------------------------------------------------------ */

const CSS = `
:root{--ink:#16181c;--dim:#5b6270;--faint:#8b919c;--line:#e6e8ec;--bg:#fff;--accent:#3b5bdb;
      --sans:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,system-ui,sans-serif;
      --mono:ui-monospace,'SF Mono',Menlo,Consolas,monospace}
@media(prefers-color-scheme:dark){:root{--ink:#e8eaed;--dim:#9aa1ad;--faint:#787f8b;
      --line:#242832;--bg:#0d0e11;--accent:#7c9cff}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.7 var(--sans)}
.layout{display:grid;grid-template-columns:230px minmax(0,1fr);max-width:1060px;margin:0 auto;gap:44px;padding:0 22px}
@media(max-width:820px){.layout{grid-template-columns:1fr;gap:0}}
nav{padding:40px 0;position:sticky;top:0;align-self:start;max-height:100vh;overflow-y:auto}
@media(max-width:820px){nav{position:static;max-height:none;border-bottom:1px solid var(--line)}}
nav .brand{font-weight:700;font-size:18px;letter-spacing:-.01em;margin-bottom:4px;display:block;color:var(--ink);text-decoration:none}
nav .tag{font-size:12.5px;color:var(--faint);margin-bottom:20px}
nav a.pg{display:block;padding:5px 0;font-size:14.5px;color:var(--dim);text-decoration:none}
nav a.pg:hover{color:var(--ink)}
nav a.pg.on{color:var(--accent);font-weight:600}
main{padding:40px 0 100px;min-width:0}
h1{font-size:34px;line-height:1.2;letter-spacing:-.02em;margin:0 0 8px}
h2{font-size:24px;margin:38px 0 10px;letter-spacing:-.01em}
h3{font-size:19px;margin:28px 0 8px}
.sum{font-size:18px;color:var(--dim);margin:0 0 30px;padding-bottom:22px;border-bottom:1px solid var(--line)}
p{margin:0 0 18px}
a{color:var(--accent)}
a.hash{opacity:0;margin-left:8px;text-decoration:none;font-weight:400;color:var(--faint)}
h1:hover a.hash,h2:hover a.hash,h3:hover a.hash{opacity:1}
pre{background:rgba(127,127,127,.09);border:1px solid var(--line);border-radius:8px;padding:14px;
    overflow-x:auto;font:13.5px/1.6 var(--mono)}
code{font:.88em var(--mono);background:rgba(127,127,127,.12);padding:2px 5px;border-radius:4px}
pre code{background:none;padding:0}
.tbl{overflow-x:auto;margin:22px 0}
table{border-collapse:collapse;width:100%;font-size:14.5px}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-weight:600;border-bottom:2px solid var(--accent)}
td{color:var(--dim)}
blockquote{margin:22px 0;padding:2px 0 2px 18px;border-left:3px solid var(--accent);color:var(--dim)}
ul,ol{margin:0 0 18px;padding-left:24px}li{margin-bottom:6px}
hr{border:0;border-top:1px solid var(--line);margin:34px 0}
footer{margin-top:60px;padding-top:22px;border-top:1px solid var(--line);font-size:13.5px;color:var(--faint)}
footer code{font-size:12px}
`.trim();

function page(p, pages) {
  const nav = pages
    .map((q) => `<a class="pg${q.slug === p.slug ? ' on' : ''}" href="${q.slug}.html">${esc(q.meta.title)}</a>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.meta.title)} · Berm</title>
<meta name="description" content="${esc(p.meta.summary ?? '')}">
<meta property="og:title" content="${esc(p.meta.title)}">
<meta property="og:description" content="${esc(p.meta.summary ?? '')}">
<meta property="og:type" content="article">
<style>${CSS}</style>
</head>
<body>
<div class="layout">
<nav>
  <a class="brand" href="index.html">Berm</a>
  <div class="tag">Identity you hold. X as a claim, not a login.</div>
  ${nav}
</nav>
<main>
  <h1>${esc(p.meta.title)}</h1>
  ${p.meta.summary ? `<p class="sum">${esc(p.meta.summary)}</p>` : ''}
  ${render(p.body.replace(/^#\s+.+$/m, ''))}
  <footer>
    Built from a public commit. Every file's SHA-256 is in
    <a href="manifest.json">manifest.json</a> — hash what you were served and
    compare, rather than taking a deploy's word for it.
  </footer>
</main>
</div>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */

const files = (await readdir(CONTENT)).filter((f) => f.endsWith('.md')).sort();
const pages = [];

for (const file of files) {
  const raw = await readFile(join(CONTENT, file), 'utf8');
  const parsed = parseFrontmatter(raw);
  if (!parsed) throw new Error(`${file}: missing or unterminated frontmatter`);
  pages.push({ slug: file.replace(/\.md$/, ''), ...parsed });
}
pages.sort((a, b) => (a.meta.nav ?? 99) - (b.meta.nav ?? 99));

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const manifest = { built: 'from source in this commit', files: {} };
const write = async (name, body) => {
  await writeFile(join(OUT, name), body);
  manifest.files[name] = createHash('sha256').update(body).digest('hex');
};

for (const p of pages) await write(`${p.slug}.html`, page(p, pages));

// The first page in nav order is the entry point. A docs site whose index is a
// redirect or a stub wastes the one page everybody actually lands on.
await write('index.html', page(pages[0], pages));

// Pages runs Jekyll by default and would silently drop files beginning with an
// underscore. Nothing here starts with one today, and this makes sure a future
// file cannot vanish without anyone noticing.
await write('.nojekyll', '');

await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

/* ---- the no-external-origin rule, enforced rather than intended ---- */
for (const [name, _] of Object.entries(manifest.files)) {
  if (!name.endsWith('.html')) continue;
  const html = await readFile(join(OUT, name), 'utf8');
  for (const bad of ['cdn.', 'unpkg', 'jsdelivr', 'googleapis', 'fonts.g', 'analytics']) {
    if (html.includes(bad)) throw new Error(`${name}: external origin "${bad}" leaked into the docs`);
  }
  if (/<script/i.test(html)) throw new Error(`${name}: the docs site ships no JavaScript`);

  // Unconsumed markdown means the renderer silently mangled something. Two real
  // bugs shipped through this gap before it existed: bold containing nested
  // emphasis, and bold spanning a wrapped list item. Both looked fine in the
  // source and wrong on the page.
  const leftovers = [
    [/\*\*/, 'literal ** (unrendered bold)'],
    [/^\s*[-*]\s+\S/m, 'literal list marker'],
    [/^#{1,6}\s+\S/m, 'literal heading marker'],
  ];
  const body = html.slice(html.indexOf('<main>'));
  for (const [re, why] of leftovers) {
    if (re.test(body)) throw new Error(`${name}: ${why} survived into the output`);
  }
}

console.log(`\ndocs → ${OUT}`);
for (const p of pages) {
  console.log(`  ${String(p.meta.nav).padStart(2)}. ${p.slug.padEnd(10)} ${manifest.files[`${p.slug}.html`].slice(0, 12)}…`);
}
console.log(`\n  ${Object.keys(manifest.files).length} files, no JavaScript, no external origins\n`);
