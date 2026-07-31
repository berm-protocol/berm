/**
 * Compile the TypeScript this build depends on into plain ESM.
 *
 * Two outputs: the library build.mjs imports, and the hydration script that goes
 * into every rendered page so a visitor's browser re-verifies what it was served.
 */
import * as esbuild from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(resolve(here, 'lib'), { recursive: true });

const lib = await esbuild.build({
  entryPoints: [resolve(here, 'src/lib.ts')],
  bundle: true, format: 'esm', platform: 'node', target: ['node20'],
  external: ['nostr-tools', 'ws'], write: false, legalComments: 'none',
});
writeFileSync(resolve(here, 'lib/berm.mjs'), lib.outputFiles[0].text);

const hyd = await esbuild.build({
  entryPoints: [resolve(here, '../landing/src/boot.ts')],
  bundle: true, format: 'iife', target: ['es2022'],
  minify: true, write: false, legalComments: 'none',
});
const js = hyd.outputFiles[0].text;

// Same rule as every other artifact: nothing a visitor loads comes from a
// third party. A node that pulls a CDN script is a node its author cannot vouch for.
for (const bad of ['cdn.', 'unpkg', 'jsdelivr', 'googleapis', 'fonts.g']) {
  if (js.includes(bad)) throw new Error(`external origin "${bad}" leaked into the page script`);
}
writeFileSync(resolve(here, 'lib/hydrate.js'), js);

console.log('lib/berm.mjs and lib/hydrate.js');
console.log(`  hydrate sha256: ${createHash('sha256').update(js).digest('hex')}`);
