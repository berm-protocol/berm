/**
 * Two builds, because there are two kinds of developer here.
 *
 *   berm-sdk.global.js   a <script> tag and a global. Someone with an HTML file
 *                        and ten minutes. This is the on-ramp, and it has to be
 *                        the path of least resistance or it does not exist.
 *   berm-sdk.esm.js      an import. Someone with a build step.
 *
 * The global build is deliberately NOT minified past readability — the whole
 * pitch is "everything public and verifiable", and a developer who wants to
 * read what they are about to give a signing surface to should be able to.
 */

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const shared = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  // `ws` is the Node fallback in relay.ts. Browsers have WebSocket, so it must
  // never be pulled into a browser bundle.
  external: ['ws'],
  legalComments: 'inline',
};

await build({ ...shared, format: 'iife', globalName: 'Berm', outfile: 'dist/berm-sdk.global.js' });
await build({ ...shared, format: 'esm', outfile: 'dist/berm-sdk.esm.js' });
await build({ ...shared, format: 'iife', globalName: 'Berm', minify: true, outfile: 'dist/berm-sdk.global.min.js' });
await build({ ...shared, format: 'esm', minify: true, outfile: 'dist/berm-sdk.esm.min.js' });

const { gzipSync } = await import('node:zlib');

for (const f of [
  'dist/berm-sdk.global.js', 'dist/berm-sdk.esm.js',
  'dist/berm-sdk.global.min.js', 'dist/berm-sdk.esm.min.js',
]) {
  const buf = await readFile(f);
  const sha = createHash('sha256').update(buf).digest('hex');
  const sri = `sha256-${createHash('sha256').update(buf).digest('base64')}`;
  const gz = gzipSync(buf).length;
  console.log(
    `${f}\n  ${(buf.length / 1024).toFixed(1)} KB raw, ${(gz / 1024).toFixed(1)} KB gzip` +
    `\n  sha256 ${sha}\n  SRI    ${sri}`,
  );
  await writeFile(`${f}.sha256`, `${sha}  ${f.split('/').pop()}\n`);
}
