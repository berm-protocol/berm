import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(root, path), 'utf8');
const plain = text => text.replace(/<[^>]*>/g, ' ').replace(/&[^;]+;/g, ' ').replace(/[`*]/g, '').replace(/\s+/g, ' ').trim();
const required = [
  /encrypted, user-owned portable recovery file/i,
  /\.brm.*recovery password restores the same Berm\/Nostr identity/i,
  /same BRM-derived default EVM destination/i,
  /One secp256k1 root produces both/i,
  /Recovery decrypts the file, rederives npub, public key and EVM address/i,
  /JSON shape validation alone does not prove cryptographic root equality/i,
  /Confirmation checks that the supplied BRM decrypts and matches the current vault/i,
  /does not prove that a file was saved or reopened/i,
  /adds no upload or mandatory file-reselection step/i,
  /existing unlocked NIP-49 identity can be wrapped\/re-encrypted into BRM without changing its root or npub/i,
  /BRM does not prove X identity/i,
  /does not contain X proof archives, campaign positions, financial claims, balances or application receipts/i,
  /includes no Solana\/Zcash keys, passkeys, cloud sync/i,
  /berm\.external_account_binding\.x\/2/i,
];
const forbidden = [
  /all chains are stored in BRM/i, /Berm can reset your BRM/i,
  /X proof is inside the BRM/i, /cloud backup is active by default/i,
  /BRM_RECOVERY_CONFIRMED guarantees.*download/i,
];
function problems(text) {
  const value = plain(text);
  return [...required.filter(re => !re.test(value)).map(String),
    ...forbidden.filter(re => re.test(text)).map(re => `forbidden ${re}`)];
}
const recovery = read('docs/dist/recovery.html');
assert.deepEqual(problems(recovery), [], 'generated Recovery must describe actual BRM behavior');
for (const path of ['README.md', 'docs/content/recovery.md', 'docs/content/current-standard.md', 'docs/CURRENT_STANDARD.md', 'docs/content/developer-current.md',
  'docs/dist/current-standard.html', 'docs/dist/developer-current.html']) {
  const text = read(path);
  assert.match(text, /BRM/); assert.match(text, /recovery\/brm-0\.1|Recovery|recovery guide/);
}
for (const path of ['PROFILE.md', 'schema.json', 'shape-example.json', 'shape-vectors.json', 'IMPLEMENTATION.json']) {
  assert.ok(existsSync(resolve(root, 'recovery/brm-0.1', path)), path);
}
const standard = JSON.parse(read('CURRENT_STANDARD.json'));
assert.equal(standard.currentXMethodImplementation.methodId, 'berm.external_account_binding.x/2');
assert.equal(standard.currentXMethodImplementation.vectorCount, 97);
assert.equal(standard.recoveryProfile.id, 'berm.recovery_module/0.1');
assert.equal(standard.recoveryProfile.newRuntimeOrPin, false);

// Negative controls exercise the checker, not only the current green document.
let negatives = 0;
for (const fragment of ['One secp256k1 root produces both', 'BRM does not prove X',
  'does <strong>not</strong> prove that a file was saved or reopened', 'adds no upload']) {
  assert.ok(recovery.includes(fragment), `mutation target absent: ${fragment}`);
  assert.ok(problems(recovery.replace(fragment, 'MUTATED')).length > 0); negatives++;
}
for (const claim of ['all chains are stored in BRM', 'Berm can reset your BRM', 'X proof is inside the BRM', 'cloud backup is active by default']) {
  assert.ok(problems(recovery + `<p>${claim}</p>`).length > 0); negatives++;
}
console.log(JSON.stringify({ status: 'PASS_BRM_PUBLIC_DOCS', requiredMeanings: required.length, negativeControls: negatives, noNewUserStep: true }));
