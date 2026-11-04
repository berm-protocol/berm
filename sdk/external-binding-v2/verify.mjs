import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyXBinding, BERM_R13A_METHOD_HASH, BERM_R13A_ACQUISITION_HASH, BERM_R13A_VECTOR_SET_HASH } from './runtime/bermProtocolR13a.js';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function verifyMirror(at = root) {
  const manifest = JSON.parse(readFileSync(join(at, 'spec/external-binding-v2/SOURCE_MANIFEST.json')));
  for (const [logical, entry] of Object.entries(manifest.files)) {
    assert.ok(!logical.includes('\\') && !logical.startsWith('/') && !logical.split('/').includes('..'), logical);
    assert.equal(sha(readFileSync(join(at, ...logical.split('/')))), entry.sha256, `source drift: ${logical}`);
  }
  const spec = join(at, 'spec/external-binding-v2');
  assert.equal('sha256:' + sha(readFileSync(join(spec, 'authority/method/spec/METHODSPEC_CANONICAL.md'))), BERM_R13A_METHOD_HASH);
  assert.equal('sha256:' + sha(readFileSync(join(spec, 'authority/method/spec/ACQUISITION_PROFILE.md'))), BERM_R13A_ACQUISITION_HASH);
  const names = readdirSync(join(spec, 'vectors')).filter((x) => /^XB-\d+\.json$/.test(x)).sort();
  assert.equal(names.length, 97);
  assert.equal('sha256:' + sha(names.map((name) => `${name}:sha256:${sha(readFileSync(join(spec, 'vectors', name)))}`).join('\n')), BERM_R13A_VECTOR_SET_HASH);
  return { exactSourceFiles: Object.keys(manifest.files).length, vectorFiles: names };
}

function body(spec) {
  if ('utf8' in spec) return new TextEncoder().encode(spec.utf8);
  if ('base64' in spec) return new Uint8Array(Buffer.from(spec.base64, 'base64'));
  return new Uint8Array(Buffer.concat(Array(spec.repeat.times).fill(Buffer.from(spec.repeat.unit, 'base64'))));
}
const sorted = (value) => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, sorted(value[k])])) : value;
export async function verifyVectors() {
  const result = verifyMirror(); let positive = 0;
  for (const name of result.vectorFiles) {
    const vector = JSON.parse(readFileSync(join(root, 'spec/external-binding-v2/vectors', name)));
    const got = await verifyXBinding(Object.fromEntries(Object.entries(vector.capture).map(([key, value]) => [key, key === 'body' ? body(value) : value])), vector.expectedNpub, vector.observedAt);
    const want = vector.expect.binding ?? vector.expect;
    assert.deepEqual(sorted(got), sorted(want), name);
    if (!('ok' in got)) positive++;
  }
  return { status: 'PASS', exactSourceFiles: result.exactSourceFiles, vectors: 97, positive, refused: 97 - positive, networkCalls: 0 };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await verifyVectors(), null, 2));
