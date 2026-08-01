/**
 * One self-contained HTML file. Same rule as every other page here: no external
 * origin, nothing fetched at runtime, the whole thing readable in one view-source.
 */

import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));

const result = await esbuild.build({
  entryPoints: [resolve(here, 'src/main.ts')],
  bundle: true, format: 'iife', target: ['es2022'], minify: true,
  write: false, legalComments: 'none',
});

const js = result.outputFiles[0].text;
const template = readFileSync(resolve(here, 'template.html'), 'utf8');
if (!template.includes('/*BUNDLE*/')) throw new Error('template missing /*BUNDLE*/ marker');
const html = template.replace('/*BUNDLE*/', () => js);

for (const bad of ['cdn.', 'unpkg', 'jsdelivr', 'googleapis']) {
  if (html.includes(bad)) throw new Error(`external origin "${bad}" leaked into the bundle`);
}

mkdirSync(resolve(here, 'dist'), { recursive: true });
const out = resolve(here, 'dist/dispute.html');
writeFileSync(out, html);

console.log(`wrote ${out}`);
console.log(`  js    : ${(js.length / 1024).toFixed(1)} KB`);
console.log(`  total : ${(html.length / 1024).toFixed(1)} KB`);
console.log(`  sha256: ${createHash('sha256').update(html).digest('hex')}`);
