import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docs = ['README.md', 'docs/TECHNICAL_REFERENCE.md', 'sdk/external-binding-v2/README.md', 'docs/content/developer-current.md'];
let paths = 0, commands = 0;
for (const name of docs) {
  const source = readFileSync(join(root, name), 'utf8');
  for (const match of source.matchAll(/`((?:spec|sdk)\/external-binding-v2\/[A-Za-z0-9_./-]+)`/g)) {
    assert.ok(existsSync(join(root, match[1])), `${name}: missing ${match[1]}`); paths++;
  }
  for (const match of source.matchAll(/^node (?:--test )?([A-Za-z0-9_./-]+)(?:\s|$)/gm)) {
    assert.ok(existsSync(join(root, match[1])), `${name}: command target missing ${match[1]}`); commands++;
  }
  assert.doesNotMatch(source, /node e2e\/berm_protocol_/);
}
assert.ok(commands >= 9 && paths >= 10);
console.log(JSON.stringify({ status: 'PASS', documents: docs.length, localPaths: paths, executableCommandTargets: commands }));
