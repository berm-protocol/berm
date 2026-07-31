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
});

const js = result.outputFiles[0].text;
const template = readFileSync(resolve(here, 'template.html'), 'utf8');
if (!template.includes('/*BUNDLE*/')) throw new Error('template missing /*BUNDLE*/ marker');
const html = template.replace('/*BUNDLE*/', () => js);

// Same supply-chain rule the spec imposes on the signer: zero external origins.
for (const bad of ['cdn.', 'unpkg', 'jsdelivr', 'googleapis', 'fonts.g']) {
  if (html.includes(bad)) throw new Error(`external origin "${bad}" leaked into the bundle`);
}
// The one claim this package makes about X: no API is used. Assert it in the
// artifact, not just in the README.
if (/api\.x\.com|oauth2\/token|bearer /i.test(html)) {
  throw new Error('an X API endpoint leaked into a package whose whole point is not needing one');
}

mkdirSync(resolve(here, 'dist'), { recursive: true });
const out = resolve(here, 'dist/xonly-post.html');
writeFileSync(out, html);

console.log(`wrote ${out}`);
console.log(`  js    : ${(js.length / 1024).toFixed(1)} KB`);
console.log(`  total : ${(html.length / 1024).toFixed(1)} KB`);
console.log(`  sha256: ${createHash('sha256').update(html).digest('hex')}`);
