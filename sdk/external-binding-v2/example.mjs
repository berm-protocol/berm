// Disposable signed evidence only. No network, wallet, production key or relay.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPublicKey, sign } from './test/fixture-secp256k1.mjs';
import { encodeNpub, bytesToHex, hexToBytes, utf8Bytes, sha256Hex } from './runtime/identityCrypto.js';
import { verifyXBinding, r13aExpectedProofLine, bindingHash, jcsCanonicalize, xPostTimestampMs, BERM_R13A_METHOD_ID, BERM_R13A_METHOD_HASH, BERM_R13A_ACQUISITION_ID, BERM_R13A_ACQUISITION_HASH } from './runtime/bermProtocolR13a.js';
import { foldBindingEvidence, artifactSigningDigest, artifactId, parseR13aWireArtifact, R13A_KINDS, R13A_ACCEPTANCE_RULE, R13A_RECEIPT_NOTICE } from './runtime/bermProtocolR13aEvidence.js';

const protocol = { methodId: BERM_R13A_METHOD_ID, methodHash: BERM_R13A_METHOD_HASH, acquisitionId: BERM_R13A_ACQUISITION_ID, acquisitionHash: BERM_R13A_ACQUISITION_HASH };
const postId = '1900000000000000000';
const observedAt = xPostTimestampMs(postId) + 1000;
const fixtureKey = (n) => hexToBytes(n.toString(16).padStart(64, '0'), 32);
const publicKey = (key) => bytesToHex(getPublicKey(key));
async function signed(artifact, key) {
  return { ...artifact, sig: bytesToHex(sign(hexToBytes(await artifactSigningDigest(artifact), 32), key, new Uint8Array(32))) };
}
async function boundClaim(key, accountId, handle) {
  const subjectKey = publicKey(key), npub = encodeNpub(subjectKey);
  const capture = { status: 200, redirects: 0, body: utf8Bytes(JSON.stringify({ text: r13aExpectedProofLine(handle, npub), id_str: postId, user: { id_str: accountId, screen_name: handle } })) };
  const binding = await verifyXBinding(capture, npub, observedAt);
  assert.ok(!('ok' in binding), JSON.stringify(binding));
  const claim = await signed({ kind: R13A_KINDS.CLAIM, namespace: 'x', binding, bindingHash: await bindingHash(binding), subjectKey }, key);
  return { capture, claim };
}
export async function makeDisposableEvidence() {
  const subject = await boundClaim(fixtureKey(17), '44196397', 'alice');
  const operator = await boundClaim(fixtureKey(18), '44196398', 'operator');
  const validator = fixtureKey(19), application = fixtureKey(20);
  const authorization = await signed({ kind: R13A_KINDS.AUTHORIZATION, operatorNpub: operator.claim.binding.npub, operatorBindingHash: await artifactId(operator.claim), validatorKey: publicKey(validator), ...protocol, activatedAt: observedAt - 1 }, fixtureKey(18));
  const authorizationRef = await artifactId(authorization);
  const observation = await signed({ kind: R13A_KINDS.OBSERVATION, namespace: 'x', binding: subject.claim.binding, bindingHash: subject.claim.bindingHash, observedAt, ...protocol, validatorKey: publicKey(validator), authorizationRef }, validator);
  const policy = await signed({ kind: R13A_KINDS.POLICY, application: 'disposable-developer-example', policyVersion: 1, acceptedMethods: [protocol], acceptedValidators: [{ operatorNpub: operator.claim.binding.npub, validatorKey: publicKey(validator), authorizationRef }], matching: { rule: R13A_ACCEPTANCE_RULE, requiredKeys: [publicKey(validator)], distinctOperatorsRequired: 1 }, observationWindowMs: 300000, genesisOperators: [operator.claim.binding.npub], applicationKey: publicKey(application) }, application);
  const receipt = await signed({ kind: R13A_KINDS.RECEIPT, application: policy.application, bindingHash: subject.claim.bindingHash, policyHash: await artifactId(policy), observationRefs: [await artifactId(observation)], acceptedAt: observedAt, notice: R13A_RECEIPT_NOTICE, applicationKey: publicKey(application) }, application);
  return { capture: { ...subject.capture, body: bytesToHex(subject.capture.body) }, expectedNpub: subject.claim.binding.npub, observedAt, evidence: { claim: subject.claim, authorizations: [authorization], observations: [observation], policy, receipt, operatorClaims: [operator.claim] } };
}
export async function verifyRecordedExample(record, trust) {
  // Application trust is explicit: callers must independently pin the policy/key;
  // signature validity alone never makes a self-selected policy trustworthy.
  assert.ok(trust?.applicationKey && trust?.policyHash, 'independently_selected_policy_required');
  assert.equal(record.evidence.policy.applicationKey, trust.applicationKey, 'application_key_not_trusted');
  assert.equal(await artifactId(record.evidence.policy), trust.policyHash, 'application_policy_not_trusted');
  const capture = { ...record.capture, body: hexToBytes(record.capture.body) };
  const binding = await verifyXBinding(capture, record.expectedNpub, record.observedAt);
  assert.deepEqual(binding, record.evidence.claim.binding, 'capture_binding_mismatch');
  for (const artifact of [record.evidence.claim, ...record.evidence.authorizations, ...record.evidence.observations, record.evidence.policy, record.evidence.receipt, ...record.evidence.operatorClaims]) parseR13aWireArtifact(utf8Bytes(jcsCanonicalize(artifact)));
  const folded = await foldBindingEvidence(record.evidence);
  assert.equal(folded.accepted, true, folded.reason ?? JSON.stringify(folded));
  return folded;
}
export async function runExample(outDirectory = null) {
  const record = await makeDisposableEvidence();
  const trust = { applicationKey: record.evidence.policy.applicationKey, policyHash: await artifactId(record.evidence.policy) };
  const result = await verifyRecordedExample(record, trust);
  const bytes = jcsCanonicalize(record), digest = await sha256Hex(utf8Bytes(bytes));
  let readback = JSON.parse(bytes);
  if (outDirectory) {
    await mkdir(outDirectory, { recursive: true });
    await writeFile(join(outDirectory, 'evidence.json'), bytes, { flag: 'wx' });
    await writeFile(join(outDirectory, 'evidence.sha256'), digest + '\n', { flag: 'wx' });
    const saved = await readFile(join(outDirectory, 'evidence.json'));
    assert.equal(await sha256Hex(saved), digest); readback = JSON.parse(saved);
  }
  await verifyRecordedExample(readback, trust);
  return { status: 'PASS_DISPOSABLE_OFFLINE_EXAMPLE', networkCalls: 0, signatureScope: 'public fixture keys only', persistenceScope: outDirectory ? 'file export and re-verification; not a production custody or durable registry' : 'memory roundtrip only', policyTrust: 'explicit disposable application policy; not public validator standing', independentOperatorCertification: false, bindingHash: result.bindingHash, evidenceSha256: digest };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await runExample(process.argv[2] && resolve(process.argv[2])), null, 2));
