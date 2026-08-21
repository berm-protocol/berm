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
for (const bad of ['cdn.', 'unpkg', 'jsdelivr', 'googleapis']) {
  if (html.includes(bad)) throw new Error(`external origin "${bad}" leaked into the bundle`);
}

/*
 * CSP HASHES — see signer/build.mjs for the full reasoning.
 *
 * The deployed editor is served with `script-src 'self'` and no 'unsafe-inline',
 * which makes a single self-contained file inert. Pinning the exact inline bytes
 * keeps one file and is stricter than 'self': the origin may serve only these
 * bytes, not merely any script of its own.
 */
const b64 = (s) => createHash('sha256').update(s, 'utf8').digest('base64');
const inline = (tag) => [...html.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]);
const scriptHashes = inline('script').map((c) => `'sha256-${b64(c)}'`);
const styleHashes = inline('style').map((c) => `'sha256-${b64(c)}'`);
if (/style="/.test(html)) throw new Error('inline style attribute present — a CSP style hash cannot cover it');

mkdirSync(resolve(here, 'dist'), { recursive: true });
const out = resolve(here, 'dist/xonly-editor.html');
writeFileSync(out, html);

console.log(`wrote ${out}`);
console.log(`  js    : ${(js.length / 1024).toFixed(1)} KB`);
console.log(`  total : ${(html.length / 1024).toFixed(1)} KB`);
const csp =
  `default-src 'self'; script-src 'self' ${scriptHashes.join(' ')}; ` +
  `style-src 'self' ${styleHashes.join(' ')}; img-src 'self' data: blob:; ` +
  `connect-src 'self' wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`;
writeFileSync(resolve(here, 'dist/csp.txt'), csp + '\n');
console.log(`  sha256: ${createHash('sha256').update(html).digest('hex')}`);
console.log(`  csp   : dist/csp.txt — ${scriptHashes.length} script hash, ${styleHashes.length} style hash`);
