/**
 * Documentation conformance.
 *
 * Docs rot silently. These checks make the two rules we actually care about
 * mechanical rather than aspirational:
 *
 *   1. Every internal link resolves. A docs site with dead links is arguing
 *      against its own competence on every page.
 *   2. A page marked for X Articles contains nothing X Articles will destroy.
 *      We measured that X strips code blocks, tables and images; a page that
 *      claims it can be published there and cannot is a promise we break in
 *      public, on the showcase.
 */

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, 'content');

const REQUIRED = ['d', 'title', 'summary', 'nav', 'x_article'];

const problems = [];
const warn = [];
const fail = (f, m) => problems.push(`${f}: ${m}`);

/** Deliberately tiny: the frontmatter we emit is flat, and a YAML dependency
 *  here would be a supply-chain surface for a linting script. */
function parseFrontmatter(text, file) {
  if (!text.startsWith('---\n')) { fail(file, 'missing frontmatter'); return null; }
  const end = text.indexOf('\n---\n', 4);
  if (end === -1) { fail(file, 'unterminated frontmatter'); return null; }

  const meta = {};
  for (const line of text.slice(4, end).split('\n')) {
    const m = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      meta[m[1]] = v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (v === 'true' || v === 'false') {
      meta[m[1]] = v === 'true';
    } else if (/^\d+$/.test(v)) {
      meta[m[1]] = Number(v);
    } else {
      meta[m[1]] = v;
    }
  }
  return { meta, body: text.slice(end + 5) };
}

const files = (await readdir(DIR)).filter((f) => f.endsWith('.md')).sort();
const pages = [];

for (const file of files) {
  const raw = await readFile(join(DIR, file), 'utf8');
  const parsed = parseFrontmatter(raw, file);
  if (!parsed) continue;
  const { meta, body } = parsed;

  for (const k of REQUIRED) {
    if (meta[k] === undefined) fail(file, `frontmatter missing "${k}"`);
  }
  if (meta.d && meta.d !== `docs/${file.replace(/\.md$/, '')}`) {
    fail(file, `d tag "${meta.d}" does not match filename`);
  }
  if (meta.summary && meta.summary.length > 160) {
    warn.push(`${file}: summary is ${meta.summary.length} chars — cards truncate around 160`);
  }
  if (!/^#\s+/m.test(body)) fail(file, 'no H1 in body');

  pages.push({ file, meta, body });
}

/* ---- d tags and nav order are unique ---- */
for (const key of ['d', 'nav']) {
  const seen = new Map();
  for (const p of pages) {
    const v = p.meta[key];
    if (seen.has(v)) fail(p.file, `duplicate ${key} "${v}" (also in ${seen.get(v)})`);
    seen.set(v, p.file);
  }
}

/* ---- internal links resolve, anchors included ----
 *
 * The anchor half was missing, and the omission was not harmless: the old
 * pattern required `)` straight after the slug, so every `docs/page#anchor`
 * link was skipped silently. A link checker that quietly ignores a whole link
 * syntax is worse than none, because it reports "no problems".
 */
const slugs = new Set(pages.map((p) => p.meta.d));

/** GitHub-flavoured heading slug — the anchor a rendered doc will actually expose. */
const anchor = (heading) =>
  heading.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');

const headings = new Map(
  pages.map((p) => [
    p.meta.d,
    new Set([...p.body.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((m) => anchor(m[1]))),
  ]),
);

for (const p of pages) {
  for (const m of p.body.matchAll(/\]\((docs\/[a-z0-9-]+)(#[a-z0-9-]+)?\)/g)) {
    const [, slug, frag] = m;
    if (!slugs.has(slug)) { fail(p.file, `dead internal link → ${slug}`); continue; }
    if (frag && !headings.get(slug).has(frag.slice(1))) {
      fail(p.file, `dead anchor → ${slug}${frag} (no such heading in that page)`);
    }
  }
}

/* ---- the tier-1 disclosure must stay put ----
 *
 * This documentation described the three custody tiers as differing only in
 * friction. That was false: WebAuthn binds credentials to an RP ID derived from
 * the signer origin, so whoever holds that DNS name next can obtain the identity
 * key of every tier-1 user who authenticates afterwards. Tiers 0 and 2 have no
 * such dependency.
 *
 * The correction is prose, and prose can be un-corrected by an edit that looks
 * like tidying. So the shape is enforced: the section exists where the anchor
 * points, and every page that could mislead without it points at it.
 *
 * HONEST LIMIT: this proves the section and the pointers are present. It cannot
 * prove the text still says the true thing. Reviewing that is a human job, and
 * pretending a grep does it would be the same class of error as the one being
 * corrected here.
 */
const DISCLOSURE = 'what-tier-1-costs';
const MUST_POINT_AT_IT = ['concepts.md', 'limits.md', 'security.md'];

if (!headings.get('docs/custody')?.has(DISCLOSURE)) {
  fail('custody.md', `the tier-1 disclosure heading (#${DISCLOSURE}) is gone — see docs/check.mjs`);
}
for (const file of MUST_POINT_AT_IT) {
  const p = pages.find((q) => q.file === file);
  if (!p) { fail(file, 'expected page is missing'); continue; }
  if (!p.body.includes(`docs/custody#${DISCLOSURE}`)) {
    fail(file, `must link to docs/custody#${DISCLOSURE} — see docs/check.mjs`);
  }
}

/* ---- X Articles constraint ----
 *
 * Three states, because a binary flag forced a false choice: either publish a
 * prose page and lose the showcase, or publish a reference page to a surface
 * that destroys it.
 *
 *   full     paste as-is; contains nothing X will damage
 *   adapted  an X variant is generated — code blocks become deep links back to
 *            docs.xonly.ai, because a PNG of code cannot be copied
 *   none     node only; the page IS its code
 */
const X_STATES = ['full', 'adapted', 'none'];

for (const p of pages) {
  const state = p.meta.x_article;
  if (!X_STATES.includes(state)) {
    fail(p.file, `x_article must be one of ${X_STATES.join(' | ')}, got "${state}"`);
    continue;
  }

  const fences = (p.body.match(/^```/gm) ?? []).length / 2;
  const tables = (p.body.match(/^\|.+\|$/gm) ?? []).length;
  const images = (p.body.match(/^!\[/gm) ?? []).length;

  if (state === 'full') {
    if (fences > 0) fail(p.file, `x_article: full but has ${fences} code block(s) — mark it "adapted"`);
    if (images > 0) fail(p.file, `x_article: full but has ${images} image(s) — X drops images on paste`);
    if (tables > 0) warn.push(`${p.file}: x_article: full with ${tables} table row(s) — needs the PNG escape hatch`);
  }

  if (state === 'adapted') {
    // An "adapted" page with nothing to adapt means the flag is wrong, and a
    // wrong flag is how a page silently stops being published to X.
    if (fences === 0 && tables === 0 && images === 0) {
      fail(p.file, 'x_article: adapted but nothing needs adapting — mark it "full"');
    }
    // The adaptation replaces code with links, so the reader must be able to
    // get back to the real page.
    if (fences > 0 && !/\]\(docs\//.test(p.body)) {
      fail(p.file, 'x_article: adapted with code blocks but no internal link — the X variant would dead-end');
    }
  }
}

/* ---- report ---- */
console.log(`\n${pages.length} pages\n`);
for (const p of pages.sort((a, b) => a.meta.nav - b.meta.nav)) {
  const words = p.body.split(/\s+/).length;
  console.log(
    `  ${String(p.meta.nav).padStart(2)}. ${p.meta.d.padEnd(16)} ` +
    `${String(words).padStart(5)} words  ` +
    { full: 'X Article: full', adapted: 'X Article: adapted', none: 'node only' }[p.meta.x_article],
  );
}

if (warn.length) {
  console.log('\nwarnings:');
  for (const w of warn) console.log(`  ! ${w}`);
}

console.log(problems.length ? `\nFAILURES:\n${problems.map((p) => `  ✗ ${p}`).join('\n')}\n`
                            : '\nno problems\n');
process.exit(problems.length ? 1 : 0);
