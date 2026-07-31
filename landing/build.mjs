/**
 * Builds the hydration bundle, then a demo page that embeds it.
 *
 * The bundle is a separate artifact on purpose: in production the node renders
 * the page HTML and references the script by URL with an SRI hash, so the script
 * a visitor runs can be checked independently of the page that served it. The
 * single-file demo exists for local verification.
 */
import * as esbuild from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(resolve(here, 'dist'), { recursive: true });

const out = await esbuild.build({
  entryPoints: [resolve(here, 'src/boot.ts')],
  bundle: true, format: 'iife', target: ['es2022'],
  minify: true, write: false, legalComments: 'none',
});
const js = out.outputFiles[0].text;

for (const bad of ['cdn.', 'unpkg', 'jsdelivr', 'googleapis', 'fonts.g']) {
  if (js.includes(bad)) throw new Error(`external origin "${bad}" leaked into the bundle`);
}

// The renderer is also emitted as ESM so verify.mjs exercises the SAME code the
// node will call, rather than a re-implementation of it in the test.
const rend = await esbuild.build({
  entryPoints: [resolve(here, 'src/render.ts')],
  bundle: true, format: 'esm', target: ['es2022'], write: false, legalComments: 'none',
});
writeFileSync(resolve(here, 'dist/render.mjs'), rend.outputFiles[0].text);

const file = resolve(here, 'dist/hydrate.js');
writeFileSync(file, js);
const sha = createHash('sha256').update(js).digest('base64');

console.log(`wrote ${file}`);
console.log(`  js     : ${(js.length / 1024).toFixed(1)} KB`);
console.log(`  sha256 : ${createHash('sha256').update(js).digest('hex')}`);
console.log(`  sri    : sha256-${sha}`);
