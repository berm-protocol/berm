/**
 * Bundles the demo into ONE self-contained HTML file.
 *
 * No CDN, no external requests, inline everything — the same supply-chain rule
 * the spec imposes on the real signer (§6). If this page needed a third-party
 * script origin, the "open devtools and check" claim would be unverifiable.
 */

import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));

const result = await esbuild.build({
  entryPoints: [resolve(here, 'src/main.ts')],
  bundle: true,
  format: 'iife',
  target: ['es2022'],
  minify: true,
  write: false,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
});

const js = result.outputFiles[0].text;
const template = readFileSync(resolve(here, 'template.html'), 'utf8');

if (!template.includes('/*BUNDLE*/')) throw new Error('template is missing the /*BUNDLE*/ marker');
const html = template.replace('/*BUNDLE*/', () => js);

// Fail loudly if anything survived that would make an external request.
for (const bad of ['cdn.', 'unpkg', 'jsdelivr', 'googleapis', 'http://', 'src="http']) {
  const hits = html.split(bad).length - 1;
  // wss:// relay URLs and https:// links in copy are expected; block script origins only.
  if (bad !== 'http://' && hits > 0) throw new Error(`external origin "${bad}" leaked into the bundle`);
}

mkdirSync(resolve(here, 'dist'), { recursive: true });
const out = resolve(here, 'dist/berm-live-proof.html');
writeFileSync(out, html);

const sha = createHash('sha256').update(html).digest('hex');
console.log(`wrote ${out}`);
console.log(`  bundle js : ${(js.length / 1024).toFixed(1)} KB`);
console.log(`  total html: ${(html.length / 1024).toFixed(1)} KB`);
console.log(`  sha256    : ${sha}`);
