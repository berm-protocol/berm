/**
 * Build the sealed import page.
 *
 * The claimant index is INLINED at build time. That is not an optimisation — it
 * is what allows `connect-src 'none'`. A runtime fetch of the index would force
 * the CSP open, and the privacy claim with it.
 */
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// csp.ts is TypeScript and this is a plain script, so compile it first rather
// than keeping a second copy of the policy. Two copies of a security header is
// one copy that goes stale.

const here = dirname(fileURLToPath(import.meta.url));
const index = JSON.parse(readFileSync(resolve(here, 'fixtures/claimants.json'), 'utf8'));

mkdirSync(resolve(here, 'dist'), { recursive: true });
await esbuild.build({
  entryPoints: [resolve(here, 'src/csp.ts')],
  outfile: resolve(here, 'dist/csp.mjs'),
  format: 'esm', bundle: true, platform: 'neutral',
});
const { importCsp, auditCsp } = await import('./dist/csp.mjs');

const result = await esbuild.build({
  entryPoints: [resolve(here, 'src/main.ts')],
  bundle: true, format: 'iife', target: ['es2022'], minify: true, write: false,
  legalComments: 'none',
  define: { __CLAIMANT_INDEX__: JSON.stringify(index) },
});

const js = result.outputFiles[0].text;

// The script is inline, so the CSP must name it by hash. This is stricter than
// 'self': 'self' permits any script from this origin, a hash permits exactly
// these bytes. Change one character and the browser refuses to run it.
const scriptHash = 'sha256-' + createHash('sha256').update(js, 'utf8').digest('base64');
const csp = importCsp({ scriptHashes: [scriptHash] });

const audit = auditCsp(csp);
if (!audit.ok) throw new Error(`refusing to build with a weak CSP: ${audit.problems.join('; ')}`);

const template = readFileSync(resolve(here, 'template.html'), 'utf8');
if (!template.includes('/*BUNDLE*/')) throw new Error('template missing /*BUNDLE*/ marker');
let html = template.replace('/*BUNDLE*/', () => js);

// The meta tag is a belt-and-braces copy of the header, so the guarantee holds
// even when the page is opened from disk with no server in front of it.
html = html.replace('<meta charset="utf-8">',
  `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${csp}">`);

for (const bad of ['cdn.', 'unpkg', 'jsdelivr', 'googleapis']) {
  if (html.includes(bad)) throw new Error(`external origin "${bad}" leaked into the bundle`);
}

const out = resolve(here, 'dist/import.html');
writeFileSync(out, html);
writeFileSync(resolve(here, 'dist/csp.txt'), csp + '\n');

console.log(`wrote ${out}`);
console.log(`  claimants: ${index.claimants.length}`);
console.log(`  js       : ${(js.length / 1024).toFixed(1)} KB`);
console.log(`  total    : ${(html.length / 1024).toFixed(1)} KB`);
console.log(`  script   : ${scriptHash}`);
console.log(`  csp      : ${csp.split(';').find((d) => d.includes('connect-src')).trim()}`);
console.log(`  sha256   : ${createHash('sha256').update(html).digest('hex')}`);
