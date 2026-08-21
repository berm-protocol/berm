/**
 * Assemble the public tree for xonly.ai.
 *
 * Nothing here is authored except the front page. Everything else is copied
 * from a package that built and tested it, so this file cannot silently become
 * a second source of truth for content that already has one.
 *
 * It also emits the CSP the apex must serve. The house pattern, taken from
 * graph/dist/csp.txt: pin every inline script by hash, allow inline styles.
 * Styles cannot exfiltrate without script, and hashing thirteen documentation
 * pages' stylesheets would break the site every time a word changed.
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = resolve(root, 'public');

mkdirSync(out, { recursive: true });

// 1. the front page
writeFileSync(join(out, 'index.html'), readFileSync(join(here, 'index.template.html'), 'utf8'));

// 2. documentation, as built and hash-manifested by docs/
cpSync(resolve(root, 'docs/dist'), join(out, 'docs'), { recursive: true });

// 3. the verification tools, each from its own package
const tools = [
  ['explorer/dist/who.html', 'who.html'],
  ['graph/dist/import.html', 'import.html'],
  ['prf-check/dist/prf-check.html', 'prf-check.html'],
];
for (const [src, dst] of tools) cpSync(resolve(root, src), join(out, dst));

// 4. the CSP, derived from what is actually in the tree
const files = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.html')) files.push(p);
  }
})(out);

const b64 = (s) => createHash('sha256').update(s, 'utf8').digest('base64');
const hashes = new Set();
let scripts = 0;
for (const f of files) {
  const html = readFileSync(f, 'utf8');
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    scripts++;
    hashes.add(`'sha256-${b64(m[1])}'`);
  }
  // An external script would escape the hash pin entirely.
  if (/<script[^>]*\bsrc=/.test(html)) throw new Error(`external script in ${relative(out, f)} — the CSP pins inline scripts only`);
}

const csp =
  `default-src 'self'; script-src 'self' ${[...hashes].join(' ')}; ` +
  `style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; ` +
  `connect-src 'self' wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'`;
writeFileSync(join(out, 'csp.txt'), csp + '\n');

console.log(`wrote ${out}`);
console.log(`  pages  : ${files.length}`);
console.log(`  scripts: ${scripts} inline, ${hashes.size} distinct hash${hashes.size === 1 ? '' : 'es'}`);
console.log(`  csp    : public/csp.txt`);
for (const f of files.slice(0, 3)) console.log(`           ${relative(out, f)}`);
