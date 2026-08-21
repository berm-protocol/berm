import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const result = await esbuild.build({
  entryPoints: [resolve(here, 'src/main.ts')],
  bundle: true, format: 'iife', target: ['es2022'], minify: true, write: false, legalComments: 'none',
});
const js = result.outputFiles[0].text;
const template = readFileSync(resolve(here, 'template.html'), 'utf8');
if (!template.includes('/*BUNDLE*/')) throw new Error('template missing /*BUNDLE*/ marker');
const html = template.replace('/*BUNDLE*/', () => js);

// Zero external origins. The signer holds keys; it fetches nothing.
for (const bad of ['cdn.', 'unpkg', 'jsdelivr', 'googleapis', 'fonts.g']) {
  if (html.includes(bad)) throw new Error(`external origin "${bad}" leaked into the bundle`);
}
mkdirSync(resolve(here, 'dist'), { recursive: true });
const out = resolve(here, 'dist/xonly-signer.html');
writeFileSync(out, html);
/*
 * ATTESTATION INPUT.
 *
 * `signer-log/` exists because a signer origin can serve different JavaScript
 * tomorrow — to one user, from one IP, for one hour — and nothing in the browser
 * will say so. SRI does not help: the same origin controls the page declaring
 * the hash. Transparency does not remove that power; it makes using it leave
 * permanent, third-party-verifiable evidence.
 *
 * The build's only job here is to emit the exact bytes' hash. It deliberately
 * does NOT sign: `signer-log/README.md` — "The attestation key must not live on
 * the web server. If it does, whoever takes the server signs whatever they
 * serve." Signing happens offline, at release, from this file.
 */
/*
 * CSP HASHES.
 *
 * The production Caddyfile serves the signer with `script-src 'self'` and
 * `style-src 'self'` — no 'unsafe-inline'. A single self-contained file is
 * therefore INERT under it, which a browser test caught rather than a reviewer.
 *
 * Two ways out. Split into external .js/.css and satisfy 'self' — which loses
 * the one-file/one-hash property the attestation depends on. Or pin the exact
 * inline bytes with a hash, which keeps the single file AND is strictly
 * stronger: with 'self' the origin may serve any script it likes; with a hash
 * it may serve only these bytes.
 *
 * Hashes cover the CONTENT of a <script>/<style> element. They do not cover
 * style="" attributes — those need 'unsafe-hashes', so the template has none.
 */
const b64 = (s) => createHash('sha256').update(s, 'utf8').digest('base64');
const inline = (tag) => [...html.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]);
const scriptHashes = inline('script').map((c) => `'sha256-${b64(c)}'`);
const styleHashes  = inline('style').map((c) => `'sha256-${b64(c)}'`);
if (/style="/.test(html)) throw new Error('inline style attribute present — a CSP style hash cannot cover it');

const sha256 = createHash('sha256').update(html).digest('hex');
const attestInput = {
  origin: process.env.SIGNER_ORIGIN ?? 'https://signer.xonly.ai',
  version: JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8')).version,
  sha256,
  path: '/',
  build: process.env.GIT_COMMIT ?? undefined,
};
writeFileSync(resolve(here, 'dist/attestation-input.json'), JSON.stringify(attestInput, null, 2) + '\n');

const csp =
  `default-src 'self'; script-src 'self' ${scriptHashes.join(' ')}; ` +
  `style-src 'self' ${styleHashes.join(' ')}; img-src 'self' data:; ` +
  `connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
writeFileSync(resolve(here, 'dist/csp.txt'), csp + '\n');

console.log(`wrote ${out}`);
console.log(`  js    : ${(js.length / 1024).toFixed(1)} KB`);
console.log(`  total : ${(html.length / 1024).toFixed(1)} KB`);
console.log(`  sha256: ${sha256}`);
console.log(`  attest: dist/attestation-input.json — sign OFFLINE, never on the server`);
console.log(`  csp   : dist/csp.txt — ${scriptHashes.length} script hash, ${styleHashes.length} style hash`);
