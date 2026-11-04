import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, cp, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeDisposableEvidence, verifyRecordedExample, runExample } from './example.mjs';
import { artifactId } from './runtime/bermProtocolR13aEvidence.js';
import { verifyMirror, verifyVectors, root } from './verify.mjs';

test('byte-exact installed mirror and all 97 normative vectors', async () => { assert.equal((await verifyVectors()).vectors, 97); });
test('source drift is refused outside the example directory', async () => {
  const copy = await mkdtemp(join(tmpdir(), 'berm-mirror-'));
  try {
    await cp(join(root, 'spec/external-binding-v2'), join(copy, 'spec/external-binding-v2'), { recursive: true });
    await cp(join(root, 'sdk/external-binding-v2'), join(copy, 'sdk/external-binding-v2'), { recursive: true });
    verifyMirror(copy);
    const target = join(copy, 'spec/external-binding-v2/authority/method/spec/ACQUISITION_PROFILE.md');
    await writeFile(target, Buffer.concat([await readFile(target), Buffer.from('\n')]));
    assert.throws(() => verifyMirror(copy), /source drift/);
  } finally { await rm(copy, { recursive: true, force: true }); }
});
test('same original signed evidence exports to disk and re-verifies', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'berm-offline-export-'));
  try { assert.equal((await runExample(dir)).status, 'PASS_DISPOSABLE_OFFLINE_EXAMPLE'); }
  finally { await rm(dir, { recursive: true, force: true }); }
});
test('private-key guard exemption is exact-path and exact-byte only', async () => {
  const copy = await mkdtemp(join(tmpdir(), 'berm-supply-'));
  const put = async (path, bytes) => { const target = join(copy, path); await mkdir(join(target, '..'), { recursive: true }); await writeFile(target, bytes); };
  const negativePath = 'spec/external-binding-v2/vectors/XB-087.json';
  const original = await readFile(join(root, negativePath));
  const run = () => spawnSync(process.execPath, ['scripts/check-supply-chain.mjs'], { cwd: copy, encoding: 'utf8' });
  try {
    await put('scripts/check-supply-chain.mjs', await readFile(join(root, 'scripts/check-supply-chain.mjs')));
    // Preserve the check's mandatory demonstration-import invariants.
    await put('crypto/test/negative.test.ts', await readFile(join(root, 'crypto/test/negative.test.ts')));
    await put('demo/src/main.ts', await readFile(join(root, 'demo/src/main.ts')));
    for (const needed of ['crypto/src/index.ts', 'crypto/tsconfig.json']) await put(needed, await readFile(join(root, needed)));
    await put(negativePath, original);
    const positive = run(); assert.equal(positive.status, 0, positive.stdout + positive.stderr);
    await put(negativePath, Buffer.concat([original, Buffer.from('\n')]));
    assert.notEqual(run().status, 0, 'changed normative bytes must refuse');
    await put(negativePath, original);
    await put('spec/external-binding-v2/vectors/OTHER.json', original);
    assert.notEqual(run().status, 0, 'another file must refuse');
  } finally { await rm(copy, { recursive: true, force: true }); }
});
test('identity, time, signature, authorization and incomplete evidence refuse', async () => {
  const original = await makeDisposableEvidence();
  const trust = { applicationKey: original.evidence.policy.applicationKey, policyHash: await artifactId(original.evidence.policy) };
  assert.equal((await verifyRecordedExample(original, trust)).accepted, true);
  const mutations = {
    subject: (r) => { r.evidence.claim.subjectKey = '00'.repeat(32); },
    handle: (r) => { r.evidence.claim.binding.handle = 'wrong'; },
    npub: (r) => { r.expectedNpub = r.evidence.operatorClaims[0].binding.npub; },
    capture: (r) => { r.capture.body = '7b7d'; },
    observedTime: (r) => { r.observedAt += 300000; },
    signature: (r) => { r.evidence.claim.sig = '00'.repeat(64); },
    missingObservation: (r) => { r.evidence.observations = []; },
    missingAuthorization: (r) => { r.evidence.authorizations = []; },
    missingOperator: (r) => { r.evidence.operatorClaims = []; },
    observationSignature: (r) => { r.evidence.observations[0].sig = '00'.repeat(64); },
    authorizationSignature: (r) => { r.evidence.authorizations[0].sig = '00'.repeat(64); },
    policy: (r) => { r.evidence.policy.matching.requiredKeys = []; },
    receipt: (r) => { r.evidence.receipt.bindingHash = 'sha256:' + '00'.repeat(32); },
  };
  for (const [label, mutate] of Object.entries(mutations)) {
    const value = structuredClone(original); mutate(value);
    await assert.rejects(() => verifyRecordedExample(value, trust), undefined, label);
  }
  await assert.rejects(() => verifyRecordedExample(original), /independently_selected_policy_required/);
  await assert.rejects(() => verifyRecordedExample(original, { ...trust, applicationKey: '00'.repeat(32) }), /application_key_not_trusted/);
});
