import { decodeNpub, schnorrVerify, sha256Hex, utf8Bytes } from "./identityCrypto.js";
import {
  BERM_R13A_ACQUISITION_HASH,
  BERM_R13A_ACQUISITION_ID,
  BERM_R13A_METHOD_HASH,
  BERM_R13A_METHOD_ID,
  BERM_R13A_PROTOCOL_ID_RE,
  BERM_R13A_WINDOW_MS,
  assertR13aBinding,
  bindingHash,
  isCanonicalPositiveUint64Decimal,
  isCanonicalR13aNpub,
  jcsCanonicalize,
  xPostTimestampMs,
} from "./bermProtocolR13a.js";
import { R13aStrictJsonError, strictParseR13aJsonBytes } from "./r13aStrictJson.js";

export const R13A_KINDS = Object.freeze({
  CLAIM: "berm.external_binding_claim/1",
  AUTHORIZATION: "berm.validator_authorization/1",
  OBSERVATION: "berm.binding_observation/1",
  POLICY: "berm.application_acceptance_policy/1",
  RECEIPT: "berm.binding_acceptance_receipt/1",
});

export const R13A_ACCEPTANCE_RULE = "all_required_keys_identical_binding_hash";
export const R13A_RECEIPT_NOTICE = "This is an application decision under its own published policy. It is not the source of the identity proof and confers no protocol standing.";

const SHA_RE = /^sha256:[0-9a-f]{64}$/;
const KEY_RE = /^[0-9a-f]{64}$/;
const SIG_RE = /^[0-9a-f]{128}$/;
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

function wireString(value, pattern, code) {
  if (typeof value !== "string" || (pattern && !pattern.test(value))) throw new Error(code);
  return value;
}

function wireInteger(value, minimum, code) {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < minimum) throw new Error(code);
  return value;
}

function wireObservedAt(value, code) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) throw new Error(code);
  return value;
}

function wireArray(value, minimum, code) {
  if (!Array.isArray(value) || value.length < minimum) throw new Error(code);
  return value;
}

function wireExactObject(value, required, optional, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${code}:unexpected:${key}`);
  for (const key of required) if (!Object.hasOwn(value, key)) throw new Error(`${code}:missing:${key}`);
  return value;
}

function wireSha(value, code) {
  return wireString(value, SHA_RE, code);
}

function wireKey(value, code) {
  return wireString(value, KEY_RE, code);
}

function wireSignature(value, code) {
  return wireString(value, SIG_RE, code);
}

function wireNpub(value, code) {
  if (!isCanonicalR13aNpub(value)) throw new Error(code);
  return value;
}

function wireProtocolId(value, code) {
  return wireString(value, BERM_R13A_PROTOCOL_ID_RE, code);
}

function wireBinding(binding, code) {
  wireExactObject(binding, ["npub", "accountId", "handle", "postId", "textHash", "methodHash"], [], code);
  wireNpub(binding.npub, `${code}:npub`);
  if (!isCanonicalPositiveUint64Decimal(binding.accountId)) throw new Error(`${code}:accountId`);
  wireString(binding.handle, HANDLE_RE, `${code}:handle`);
  if (!isCanonicalPositiveUint64Decimal(binding.postId)) throw new Error(`${code}:postId`);
  wireSha(binding.textHash, `${code}:textHash`);
  wireSha(binding.methodHash, `${code}:methodHash`);
}

function wireClaim(claim) {
  wireExactObject(claim, ["kind", "namespace", "binding", "bindingHash", "sig", "subjectKey"], ["claimedAt"], "claim_wire_shape_invalid");
  if (claim.kind !== R13A_KINDS.CLAIM) throw new Error("claim_wire_kind_invalid");
  if (claim.namespace !== "x") throw new Error("claim_wire_namespace_invalid");
  wireBinding(claim.binding, "claim_wire_binding_invalid");
  wireSha(claim.bindingHash, "claim_wire_binding_hash_invalid");
  if (Object.hasOwn(claim, "claimedAt")) wireInteger(claim.claimedAt, 0, "claim_wire_claimed_at_invalid");
  wireSignature(claim.sig, "claim_wire_signature_invalid");
  wireKey(claim.subjectKey, "claim_wire_subject_key_invalid");
}

function wireAuthorization(authorization) {
  wireExactObject(
    authorization,
    ["kind", "operatorNpub", "operatorBindingHash", "validatorKey", "methodId", "methodHash", "acquisitionId", "acquisitionHash", "activatedAt", "sig"],
    ["supersededBy", "revokedAt", "endpoint"],
    "authorization_wire_shape_invalid",
  );
  if (authorization.kind !== R13A_KINDS.AUTHORIZATION) throw new Error("authorization_wire_kind_invalid");
  wireNpub(authorization.operatorNpub, "authorization_wire_operator_npub_invalid");
  wireSha(authorization.operatorBindingHash, "authorization_wire_operator_binding_ref_invalid");
  wireKey(authorization.validatorKey, "authorization_wire_validator_key_invalid");
  wireProtocolId(authorization.methodId, "authorization_wire_method_id_invalid");
  wireSha(authorization.methodHash, "authorization_wire_method_hash_invalid");
  wireProtocolId(authorization.acquisitionId, "authorization_wire_acquisition_id_invalid");
  wireSha(authorization.acquisitionHash, "authorization_wire_acquisition_hash_invalid");
  wireInteger(authorization.activatedAt, 0, "authorization_wire_activated_at_invalid");
  if (Object.hasOwn(authorization, "supersededBy")) wireKey(authorization.supersededBy, "authorization_wire_superseded_by_invalid");
  if (Object.hasOwn(authorization, "revokedAt")) wireInteger(authorization.revokedAt, 0, "authorization_wire_revoked_at_invalid");
  if (Object.hasOwn(authorization, "endpoint")) {
    wireString(authorization.endpoint, null, "authorization_wire_endpoint_invalid");
    try {
      new URL(authorization.endpoint);
    } catch {
      throw new Error("authorization_wire_endpoint_invalid");
    }
  }
  wireSignature(authorization.sig, "authorization_wire_signature_invalid");
}

function wireObservation(observation) {
  wireExactObject(
    observation,
    ["kind", "namespace", "binding", "bindingHash", "observedAt", "methodId", "methodHash", "acquisitionId", "acquisitionHash", "validatorKey", "authorizationRef", "sig"],
    ["captureHash"],
    "observation_wire_shape_invalid",
  );
  if (observation.kind !== R13A_KINDS.OBSERVATION) throw new Error("observation_wire_kind_invalid");
  if (observation.namespace !== "x") throw new Error("observation_wire_namespace_invalid");
  wireBinding(observation.binding, "observation_wire_binding_invalid");
  wireSha(observation.bindingHash, "observation_wire_binding_hash_invalid");
  if (Object.hasOwn(observation, "captureHash")) wireSha(observation.captureHash, "observation_wire_capture_hash_invalid");
  wireObservedAt(observation.observedAt, "observation_wire_observed_at_invalid");
  wireProtocolId(observation.methodId, "observation_wire_method_id_invalid");
  wireSha(observation.methodHash, "observation_wire_method_hash_invalid");
  wireProtocolId(observation.acquisitionId, "observation_wire_acquisition_id_invalid");
  wireSha(observation.acquisitionHash, "observation_wire_acquisition_hash_invalid");
  wireKey(observation.validatorKey, "observation_wire_validator_key_invalid");
  wireSha(observation.authorizationRef, "observation_wire_authorization_ref_invalid");
  wireSignature(observation.sig, "observation_wire_signature_invalid");
}

function wirePolicy(policy) {
  wireExactObject(
    policy,
    ["kind", "application", "policyVersion", "acceptedMethods", "acceptedValidators", "matching", "observationWindowMs", "applicationKey", "sig"],
    ["scope", "genesisOperators"],
    "policy_wire_shape_invalid",
  );
  if (policy.kind !== R13A_KINDS.POLICY) throw new Error("policy_wire_kind_invalid");
  if (typeof policy.application !== "string" || policy.application.length < 1) throw new Error("policy_wire_application_invalid");
  wireInteger(policy.policyVersion, 1, "policy_wire_version_invalid");
  if (Object.hasOwn(policy, "scope")) {
    wireExactObject(policy.scope, [], ["campaignId", "projectId"], "policy_wire_scope_invalid");
    if (Object.hasOwn(policy.scope, "campaignId")) wireString(policy.scope.campaignId, null, "policy_wire_scope_campaign_id_invalid");
    if (Object.hasOwn(policy.scope, "projectId")) wireString(policy.scope.projectId, null, "policy_wire_scope_project_id_invalid");
  }
  wireArray(policy.acceptedMethods, 1, "policy_wire_methods_invalid");
  for (const method of policy.acceptedMethods) {
    wireExactObject(method, ["methodId", "methodHash", "acquisitionId", "acquisitionHash"], [], "policy_wire_method_shape_invalid");
    wireProtocolId(method.methodId, "policy_wire_method_id_invalid");
    wireSha(method.methodHash, "policy_wire_method_hash_invalid");
    wireProtocolId(method.acquisitionId, "policy_wire_acquisition_id_invalid");
    wireSha(method.acquisitionHash, "policy_wire_acquisition_hash_invalid");
  }
  wireArray(policy.acceptedValidators, 1, "policy_wire_validators_invalid");
  for (const validator of policy.acceptedValidators) {
    wireExactObject(validator, ["operatorNpub", "validatorKey", "authorizationRef"], [], "policy_wire_validator_shape_invalid");
    wireNpub(validator.operatorNpub, "policy_wire_validator_operator_npub_invalid");
    wireKey(validator.validatorKey, "policy_wire_validator_key_invalid");
    wireSha(validator.authorizationRef, "policy_wire_validator_authorization_ref_invalid");
  }
  wireExactObject(policy.matching, ["rule", "requiredKeys", "distinctOperatorsRequired"], [], "policy_wire_matching_shape_invalid");
  if (policy.matching.rule !== R13A_ACCEPTANCE_RULE) throw new Error("policy_wire_matching_rule_invalid");
  wireArray(policy.matching.requiredKeys, 1, "policy_wire_required_keys_invalid");
  for (const key of policy.matching.requiredKeys) wireKey(key, "policy_wire_required_key_invalid");
  wireInteger(policy.matching.distinctOperatorsRequired, 1, "policy_wire_distinct_operators_invalid");
  if (policy.observationWindowMs !== BERM_R13A_WINDOW_MS) throw new Error("policy_wire_observation_window_invalid");
  wireKey(policy.applicationKey, "policy_wire_application_key_invalid");
  wireSignature(policy.sig, "policy_wire_signature_invalid");
  if (Object.hasOwn(policy, "genesisOperators")) {
    wireArray(policy.genesisOperators, 0, "policy_wire_genesis_operators_invalid");
    for (const npub of policy.genesisOperators) wireNpub(npub, "policy_wire_genesis_operator_invalid");
  }
}

function wireReceipt(receipt) {
  wireExactObject(
    receipt,
    ["kind", "application", "bindingHash", "policyHash", "observationRefs", "acceptedAt", "notice", "applicationKey", "sig"],
    [],
    "receipt_wire_shape_invalid",
  );
  if (receipt.kind !== R13A_KINDS.RECEIPT) throw new Error("receipt_wire_kind_invalid");
  if (typeof receipt.application !== "string" || receipt.application.length < 1) throw new Error("receipt_wire_application_invalid");
  wireSha(receipt.bindingHash, "receipt_wire_binding_hash_invalid");
  wireSha(receipt.policyHash, "receipt_wire_policy_hash_invalid");
  wireArray(receipt.observationRefs, 1, "receipt_wire_observation_refs_invalid");
  for (const reference of receipt.observationRefs) wireSha(reference, "receipt_wire_observation_ref_invalid");
  wireInteger(receipt.acceptedAt, 0, "receipt_wire_accepted_at_invalid");
  if (receipt.notice !== R13A_RECEIPT_NOTICE) throw new Error("receipt_wire_notice_invalid");
  wireKey(receipt.applicationKey, "receipt_wire_application_key_invalid");
  wireSignature(receipt.sig, "receipt_wire_signature_invalid");
}

export function assertR13aWireArtifact(artifact, expectedKind = artifact?.kind) {
  if (expectedKind === R13A_KINDS.CLAIM) wireClaim(artifact);
  else if (expectedKind === R13A_KINDS.AUTHORIZATION) wireAuthorization(artifact);
  else if (expectedKind === R13A_KINDS.OBSERVATION) wireObservation(artifact);
  else if (expectedKind === R13A_KINDS.POLICY) wirePolicy(artifact);
  else if (expectedKind === R13A_KINDS.RECEIPT) wireReceipt(artifact);
  else throw new Error("artifact_wire_kind_unsupported");
  return artifact;
}

export function admitR13aWireArtifact(bytes, { expectedKind = null, where = "artifact" } = {}) {
  let artifact;
  try {
    artifact = strictParseR13aJsonBytes(bytes);
  } catch (error) {
    const reason = error instanceof R13aStrictJsonError ? error.kind : (error instanceof Error ? error.message : String(error));
    return { ok: false, stage: reason === "body_not_utf8" ? "utf8" : "parse", errors: [`${where}:${reason}`] };
  }
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    return { ok: false, stage: "parse", errors: [`${where}:json_object_required`] };
  }
  const kind = expectedKind ?? artifact.kind;
  try {
    assertR13aWireArtifact(artifact, kind);
  } catch (error) {
    return { ok: false, stage: "structure_or_scalars", errors: [`${where}:${error instanceof Error ? error.message : String(error)}`] };
  }
  if (expectedKind !== null && artifact.kind !== expectedKind) {
    return { ok: false, stage: "structure_or_scalars", errors: [`${where}:artifact_kind_mismatch`] };
  }
  return { ok: true, artifact };
}

export function parseR13aWireArtifact(bytes, options = {}) {
  const result = admitR13aWireArtifact(bytes, options);
  if (!result.ok) throw new Error(result.errors.join(";"));
  return result.artifact;
}

function requireObject(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value;
}

function exactKeys(value, required, optional, code) {
  requireObject(value, code);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${code}:unexpected:${key}`);
  for (const key of required) if (!Object.hasOwn(value, key)) throw new Error(`${code}:missing:${key}`);
}

function requireSha(value, code) {
  if (!SHA_RE.test(String(value ?? ""))) throw new Error(code);
  return value;
}

function requireKey(value, code) {
  if (!KEY_RE.test(String(value ?? ""))) throw new Error(code);
  return value;
}

function requireSafeTime(value, code) {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) throw new Error(code);
  return value;
}

function requireNpubKey(npub, key, code) {
  let decoded;
  try {
    if (typeof npub !== "string" || npub !== npub.toLowerCase()) throw new Error("case");
    decoded = decodeNpub(npub).pubkeyHex;
  } catch {
    throw new Error(code);
  }
  if (decoded !== key) throw new Error(code);
}

function setEquals(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function uniqueStrings(values, code) {
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => typeof value !== "string")) throw new Error(code);
  const set = new Set(values);
  if (set.size !== values.length) throw new Error(`${code}:duplicate`);
  return set;
}

export function unsignedArtifact(artifact) {
  requireObject(artifact, "artifact_required");
  const output = {};
  for (const [key, value] of Object.entries(artifact)) if (key !== "sig") output[key] = value;
  return output;
}

export async function artifactSigningDigest(artifact) {
  return sha256Hex(utf8Bytes(jcsCanonicalize(unsignedArtifact(artifact))));
}

export async function artifactId(artifact) {
  return `sha256:${await artifactSigningDigest(artifact)}`;
}

export async function verifyArtifactSignature(artifact, publicKey) {
  if (!SIG_RE.test(String(artifact?.sig ?? "")) || !KEY_RE.test(String(publicKey ?? ""))) return false;
  return schnorrVerify(await artifactSigningDigest(artifact), publicKey, artifact.sig);
}

async function validateClaim(claim) {
  assertR13aWireArtifact(claim, R13A_KINDS.CLAIM);
  exactKeys(claim, ["kind", "namespace", "binding", "bindingHash", "sig", "subjectKey"], ["claimedAt"], "claim_shape_invalid");
  if (claim.kind !== R13A_KINDS.CLAIM || claim.namespace !== "x") throw new Error("claim_kind_or_namespace_invalid");
  assertR13aBinding(claim.binding);
  requireSha(claim.bindingHash, "claim_binding_hash_invalid");
  if (claim.bindingHash !== await bindingHash(claim.binding)) throw new Error("claim_binding_hash_mismatch");
  requireKey(claim.subjectKey, "claim_subject_key_invalid");
  requireNpubKey(claim.binding.npub, claim.subjectKey, "claim_subject_key_npub_mismatch");
  if (Object.hasOwn(claim, "claimedAt")) requireSafeTime(claim.claimedAt, "claim_claimed_at_invalid");
  if (!(await verifyArtifactSignature(claim, claim.subjectKey))) throw new Error("claim_signature_invalid");
  return { artifact: claim, id: await artifactId(claim) };
}

async function validateAuthorization(authorization) {
  assertR13aWireArtifact(authorization, R13A_KINDS.AUTHORIZATION);
  exactKeys(
    authorization,
    ["kind", "operatorNpub", "operatorBindingHash", "validatorKey", "methodId", "methodHash", "acquisitionId", "acquisitionHash", "activatedAt", "sig"],
    ["supersededBy", "revokedAt", "endpoint"],
    "authorization_shape_invalid",
  );
  if (authorization.kind !== R13A_KINDS.AUTHORIZATION) throw new Error("authorization_kind_invalid");
  requireSha(authorization.operatorBindingHash, "authorization_operator_binding_ref_invalid");
  requireKey(authorization.validatorKey, "authorization_validator_key_invalid");
  requireSafeTime(authorization.activatedAt, "authorization_activated_at_invalid");
  if (Object.hasOwn(authorization, "revokedAt")) requireSafeTime(authorization.revokedAt, "authorization_revoked_at_invalid");
  if (Object.hasOwn(authorization, "supersededBy")) requireKey(authorization.supersededBy, "authorization_superseded_key_invalid");
  if (Object.hasOwn(authorization, "endpoint")) {
    try {
      new URL(authorization.endpoint);
    } catch {
      throw new Error("authorization_endpoint_invalid");
    }
  }
  if (typeof authorization.operatorNpub !== "string" || authorization.operatorNpub !== authorization.operatorNpub.toLowerCase()) {
    throw new Error("authorization_operator_npub_invalid");
  }
  const operatorKey = decodeNpub(authorization.operatorNpub).pubkeyHex;
  if (!(await verifyArtifactSignature(authorization, operatorKey))) throw new Error("authorization_signature_invalid");
  return { artifact: authorization, id: await artifactId(authorization), operatorKey };
}

async function validateObservation(observation) {
  assertR13aWireArtifact(observation, R13A_KINDS.OBSERVATION);
  exactKeys(
    observation,
    ["kind", "namespace", "binding", "bindingHash", "observedAt", "methodId", "methodHash", "acquisitionId", "acquisitionHash", "validatorKey", "authorizationRef", "sig"],
    ["captureHash"],
    "observation_shape_invalid",
  );
  if (observation.kind !== R13A_KINDS.OBSERVATION || observation.namespace !== "x") throw new Error("observation_kind_or_namespace_invalid");
  assertR13aBinding(observation.binding);
  requireSha(observation.bindingHash, "observation_binding_hash_invalid");
  if (observation.bindingHash !== await bindingHash(observation.binding)) throw new Error("observation_binding_hash_mismatch");
  if (observation.binding.methodHash !== observation.methodHash) throw new Error("observation_binding_method_hash_mismatch");
  if (Object.hasOwn(observation, "captureHash")) requireSha(observation.captureHash, "observation_capture_hash_invalid");
  requireSafeTime(observation.observedAt, "observation_observed_at_invalid");
  requireKey(observation.validatorKey, "observation_validator_key_invalid");
  requireSha(observation.authorizationRef, "observation_authorization_ref_invalid");
  if (!(await verifyArtifactSignature(observation, observation.validatorKey))) throw new Error("observation_signature_invalid");
  return { artifact: observation, id: await artifactId(observation) };
}

async function validatePolicy(policy) {
  assertR13aWireArtifact(policy, R13A_KINDS.POLICY);
  exactKeys(
    policy,
    ["kind", "application", "policyVersion", "acceptedMethods", "acceptedValidators", "matching", "observationWindowMs", "applicationKey", "sig"],
    ["scope", "genesisOperators"],
    "policy_shape_invalid",
  );
  if (policy.kind !== R13A_KINDS.POLICY || Object.hasOwn(policy, "policyHash")) throw new Error("policy_kind_or_self_hash_invalid");
  if (typeof policy.application !== "string" || policy.application.length === 0) throw new Error("policy_application_invalid");
  if (!Number.isSafeInteger(policy.policyVersion) || policy.policyVersion < 1) throw new Error("policy_version_invalid");
  if (policy.observationWindowMs !== 300000) throw new Error("policy_observation_window_invalid");
  requireKey(policy.applicationKey, "policy_application_key_invalid");
  if (!Array.isArray(policy.acceptedMethods) || policy.acceptedMethods.length === 0) throw new Error("policy_methods_invalid");
  for (const method of policy.acceptedMethods) {
    exactKeys(method, ["methodId", "methodHash", "acquisitionId", "acquisitionHash"], [], "policy_method_shape_invalid");
    requireSha(method.methodHash, "policy_method_hash_invalid");
    requireSha(method.acquisitionHash, "policy_acquisition_hash_invalid");
  }
  if (!Array.isArray(policy.acceptedValidators) || policy.acceptedValidators.length === 0) throw new Error("policy_validators_invalid");
  const validatorPairs = new Set();
  for (const validator of policy.acceptedValidators) {
    exactKeys(validator, ["operatorNpub", "validatorKey", "authorizationRef"], [], "policy_validator_shape_invalid");
    if (typeof validator.operatorNpub !== "string" || validator.operatorNpub !== validator.operatorNpub.toLowerCase()) {
      throw new Error("policy_validator_operator_npub_invalid");
    }
    decodeNpub(validator.operatorNpub);
    requireKey(validator.validatorKey, "policy_validator_key_invalid");
    requireSha(validator.authorizationRef, "policy_validator_authorization_ref_invalid");
    const pair = `${validator.validatorKey}:${validator.authorizationRef}`;
    if (validatorPairs.has(pair)) throw new Error("policy_validator_duplicate");
    validatorPairs.add(pair);
  }
  exactKeys(policy.matching, ["rule", "requiredKeys", "distinctOperatorsRequired"], [], "policy_matching_shape_invalid");
  if (policy.matching.rule !== R13A_ACCEPTANCE_RULE) throw new Error("policy_matching_rule_invalid");
  const requiredKeys = uniqueStrings(policy.matching.requiredKeys, "policy_required_keys_invalid");
  for (const key of requiredKeys) requireKey(key, "policy_required_key_invalid");
  if (!Number.isSafeInteger(policy.matching.distinctOperatorsRequired) || policy.matching.distinctOperatorsRequired < 1) throw new Error("policy_distinct_operators_invalid");
  const genesis = policy.genesisOperators ?? [];
  if (!Array.isArray(genesis) || new Set(genesis).size !== genesis.length) throw new Error("policy_genesis_operators_invalid");
  for (const npub of genesis) {
    if (typeof npub !== "string" || npub !== npub.toLowerCase()) throw new Error("policy_genesis_operator_npub_invalid");
    decodeNpub(npub);
  }
  if (!(await verifyArtifactSignature(policy, policy.applicationKey))) throw new Error("policy_signature_invalid");
  return { artifact: policy, id: await artifactId(policy), requiredKeys };
}

async function validateReceipt(receipt) {
  assertR13aWireArtifact(receipt, R13A_KINDS.RECEIPT);
  exactKeys(
    receipt,
    ["kind", "application", "bindingHash", "policyHash", "observationRefs", "acceptedAt", "notice", "applicationKey", "sig"],
    [],
    "receipt_shape_invalid",
  );
  if (receipt.kind !== R13A_KINDS.RECEIPT || receipt.notice !== R13A_RECEIPT_NOTICE) throw new Error("receipt_kind_or_notice_invalid");
  if (typeof receipt.application !== "string" || receipt.application.length === 0) throw new Error("receipt_application_invalid");
  requireSha(receipt.bindingHash, "receipt_binding_hash_invalid");
  requireSha(receipt.policyHash, "receipt_policy_hash_invalid");
  uniqueStrings(receipt.observationRefs, "receipt_observation_refs_invalid");
  requireSafeTime(receipt.acceptedAt, "receipt_accepted_at_invalid");
  requireKey(receipt.applicationKey, "receipt_application_key_invalid");
  if (!(await verifyArtifactSignature(receipt, receipt.applicationKey))) throw new Error("receipt_signature_invalid");
  return { artifact: receipt, id: await artifactId(receipt) };
}

function acceptedMethod(policy, observation) {
  return policy.acceptedMethods.some((method) => method.methodId === observation.methodId
    && method.methodHash === observation.methodHash
    && method.acquisitionId === observation.acquisitionId
    && method.acquisitionHash === observation.acquisitionHash);
}

async function evaluateBindingEvidence({
  claim,
  authorizations = [],
  observations = [],
  policy,
  receipt = null,
  operatorClaims = [],
  operatorEvidence = [],
} = {}, { allowedGenesisOperators = null } = {}) {
  const checkedPolicy = await validatePolicy(policy);
  const checkedClaim = await validateClaim(claim);
  const genesisOperators = new Set(policy.genesisOperators ?? []);
  if (allowedGenesisOperators !== null) {
    for (const npub of genesisOperators) {
      if (!allowedGenesisOperators.has(npub)) throw new Error("operator_standing_genesis_not_anchored");
    }
  }

  const authorizationMap = new Map();
  for (const authorization of authorizations) {
    const checked = await validateAuthorization(authorization);
    if (authorizationMap.has(checked.id)) throw new Error("authorization_artifact_duplicate");
    authorizationMap.set(checked.id, checked);
  }
  const operatorClaimMap = new Map();
  for (const operatorClaim of operatorClaims) {
    const checked = await validateClaim(operatorClaim);
    if (operatorClaimMap.has(checked.id)) throw new Error("operator_binding_claim_duplicate");
    operatorClaimMap.set(checked.id, checked);
  }
  const operatorEvidenceMap = new Map();
  for (const evidence of operatorEvidence) {
    const checked = await validateClaim(evidence?.claim);
    if (operatorEvidenceMap.has(checked.id)) throw new Error("operator_standing_evidence_duplicate");
    operatorEvidenceMap.set(checked.id, evidence);
    operatorClaimMap.set(checked.id, checked);
  }
  const policyPairs = new Map(policy.acceptedValidators.map((entry) => [`${entry.validatorKey}:${entry.authorizationRef}`, entry]));

  const classifyObservation = async (observation) => {
    const checked = await validateObservation(observation);
    const postCreatedAt = xPostTimestampMs(observation.binding.postId);
    const delta = observation.observedAt - postCreatedAt;
    if (delta < 0 || delta >= BERM_R13A_WINDOW_MS || delta >= policy.observationWindowMs) {
      throw new Error("observation_outside_post_window");
    }
    if (!acceptedMethod(policy, observation)) {
      return { eligible: false, reason: "observation_method_not_accepted", checked };
    }
    const pair = policyPairs.get(`${observation.validatorKey}:${observation.authorizationRef}`);
    if (!pair) return { eligible: false, reason: "observation_validator_not_accepted", checked };

    const authorization = authorizationMap.get(observation.authorizationRef);
    if (!authorization) throw new Error("observation_authorization_unresolved");
    const auth = authorization.artifact;
    if (auth.validatorKey !== observation.validatorKey || auth.operatorNpub !== pair.operatorNpub) throw new Error("observation_authorization_policy_mismatch");
    if (auth.methodId !== observation.methodId || auth.methodHash !== observation.methodHash
      || auth.acquisitionId !== observation.acquisitionId || auth.acquisitionHash !== observation.acquisitionHash) {
      throw new Error("observation_authorization_method_mismatch");
    }
    if (observation.observedAt < auth.activatedAt) throw new Error("observation_before_authorization");
    if (Object.hasOwn(auth, "revokedAt") && auth.revokedAt <= observation.observedAt) throw new Error("observation_after_revocation");
    if (Object.hasOwn(auth, "supersededBy")) throw new Error("observation_authorization_superseded");
    const operatorClaim = operatorClaimMap.get(auth.operatorBindingHash);
    if (!operatorClaim || operatorClaim.artifact.binding.npub !== auth.operatorNpub) throw new Error("operator_binding_claim_unresolved");

    if (!genesisOperators.has(auth.operatorNpub)) {
      const evidence = operatorEvidenceMap.get(auth.operatorBindingHash);
      if (!evidence) throw new Error("operator_binding_not_witnessed");
      const standing = await evaluateBindingEvidence(evidence, { allowedGenesisOperators: genesisOperators });
      if (standing.receiptArtifactId === null) throw new Error("operator_standing_acceptance_receipt_required");
      if (evidence.receipt.acceptedAt > auth.activatedAt) throw new Error("operator_standing_not_prior_to_authorization");
      if (standing.bindingHash !== operatorClaim.artifact.bindingHash || standing.binding.npub !== auth.operatorNpub) {
        throw new Error("operator_witness_binding_hash_mismatch");
      }
      if (standing.selectedOperatorNpubs.includes(auth.operatorNpub)) throw new Error("operator_self_witness_not_eligible");
    }
    return { eligible: true, checked: { ...checked, operatorNpub: auth.operatorNpub } };
  };

  const byKey = new Map();
  const seenObservationIds = new Set();
  const eligibleObservations = [];
  const ignoredObservations = [];
  for (const observation of observations) {
    const classification = await classifyObservation(observation);
    if (seenObservationIds.has(classification.checked.id)) continue;
    seenObservationIds.add(classification.checked.id);
    if (!classification.eligible) {
      ignoredObservations.push({
        observationRef: classification.checked.id,
        validatorKey: observation.validatorKey,
        reason: classification.reason,
      });
      continue;
    }
    const eligible = classification.checked;
    eligibleObservations.push(eligible);
    if (observation.bindingHash !== checkedClaim.artifact.bindingHash) throw new Error("validator_binding_hash_mismatch");
    const list = byKey.get(observation.validatorKey) ?? [];
    list.push(eligible);
    byKey.set(observation.validatorKey, list);
  }
  const selected = [];
  for (const key of checkedPolicy.requiredKeys) {
    const eligible = byKey.get(key)?.[0];
    if (!eligible) throw new Error("required_validator_missing");
    selected.push(eligible);
  }
  const bindingHashes = new Set(selected.map((entry) => entry.artifact.bindingHash));
  if (bindingHashes.size !== 1) throw new Error("required_validator_binding_hash_mismatch");
  const distinctOperators = new Set(selected.map((entry) => entry.operatorNpub));
  if (distinctOperators.size < policy.matching.distinctOperatorsRequired) throw new Error("distinct_operator_requirement_not_met");

  let checkedReceipt = null;
  if (receipt !== null) {
    checkedReceipt = await validateReceipt(receipt);
    if (receipt.application !== policy.application || receipt.applicationKey !== policy.applicationKey) throw new Error("receipt_application_policy_mismatch");
    if (receipt.policyHash !== checkedPolicy.id) throw new Error("receipt_policy_hash_mismatch");
    if (receipt.bindingHash !== checkedClaim.artifact.bindingHash) throw new Error("receipt_binding_hash_mismatch");
    const selectedRefs = new Set(selected.map((entry) => entry.id));
    if (!setEquals(new Set(receipt.observationRefs), selectedRefs)) throw new Error("receipt_observation_refs_mismatch");
    if (receipt.acceptedAt < Math.max(...selected.map((entry) => entry.artifact.observedAt))) throw new Error("receipt_predates_observation");
  }

  return {
    accepted: true,
    status: "ACCEPTED_R13A_APPLICATION_EVIDENCE",
    namespace: "x",
    binding: checkedClaim.artifact.binding,
    bindingHash: checkedClaim.artifact.bindingHash,
    claimArtifactId: checkedClaim.id,
    policyHash: checkedPolicy.id,
    receiptArtifactId: checkedReceipt?.id ?? null,
    observationRefs: selected.map((entry) => entry.id),
    selectedValidatorKeys: selected.map((entry) => entry.artifact.validatorKey),
    selectedOperatorNpubs: [...distinctOperators].sort(),
    validatorInstanceCount: selected.length,
    distinctOperatorCount: distinctOperators.size,
    eligibleValidatorInstanceCount: eligibleObservations.length,
    eligibleValidatorKeys: [...new Set(eligibleObservations.map((entry) => entry.artifact.validatorKey))].sort(),
    eligibleOperatorCount: new Set(eligibleObservations.map((entry) => entry.operatorNpub)).size,
    ignoredObservationCount: ignoredObservations.length,
    ignoredObservations,
    operatorDisclosure: distinctOperators.size === 1 ? "SAME_OPERATOR_WITNESSED_EVIDENCE" : "MULTI_OPERATOR_WITNESSED_EVIDENCE",
  };
}

export async function foldBindingEvidence(input = {}) {
  try {
    return await evaluateBindingEvidence(input);
  } catch (error) {
    return { accepted: false, status: "NOT_ACCEPTED", reason: error instanceof Error ? error.message : String(error) };
  }
}

export function createBermLaunchApplicationRegistry() {
  const accounts = new Map();
  const accountsByNpub = new Map();
  const campaignPositions = new Map();
  return Object.freeze({
    async acceptPortableEvidence(evidence) {
      const foldResult = await foldBindingEvidence(evidence);
      if (foldResult.accepted !== true || foldResult.namespace !== "x" || foldResult.receiptArtifactId === null) {
        return {
          accepted: false,
          status: "PORTABLE_BINDING_EVIDENCE_REQUIRED",
          reason: foldResult.receiptArtifactId === null ? "binding_acceptance_receipt_required" : (foldResult.reason ?? "evidence_fold_not_accepted"),
        };
      }
      const { binding, bindingHash: hash } = foldResult;
      assertR13aBinding(binding);
      const accountKey = `x:${binding.accountId}`;
      const existing = accounts.get(accountKey);
      if (existing && existing.npub !== binding.npub) {
        return { accepted: false, status: "REJECTED_PERMANENT_ACCOUNT_REBIND", namespace: "x", accountId: binding.accountId, existingNpub: existing.npub, rejectedNpub: binding.npub };
      }
      if (existing?.bindingHash === hash) return { accepted: true, status: "IDEMPOTENT_EXISTING_BINDING", ...existing, evidenceFold: foldResult };
      const version = Object.freeze({
        binding: Object.freeze({ ...binding }),
        bindingHash: hash,
        claimArtifactId: foldResult.claimArtifactId,
        policyHash: foldResult.policyHash,
        receiptArtifactId: foldResult.receiptArtifactId,
        observationRefs: Object.freeze([...foldResult.observationRefs]),
      });
      const versions = Object.freeze([...(existing?.versions ?? []), version]);
      const record = Object.freeze({
        namespace: "x",
        accountId: binding.accountId,
        npub: binding.npub,
        binding: version.binding,
        bindingHash: hash,
        evidenceRefs: Object.freeze({
          claimArtifactId: version.claimArtifactId,
          policyHash: version.policyHash,
          receiptArtifactId: version.receiptArtifactId,
          observationRefs: version.observationRefs,
        }),
        versions,
      });
      accounts.set(accountKey, record);
      if (!existing) {
        const set = accountsByNpub.get(binding.npub) ?? new Set();
        set.add(accountKey);
        accountsByNpub.set(binding.npub, set);
      }
      return {
        accepted: true,
        status: existing ? "ACCEPTED_BINDING_REFRESH" : "ACCEPTED_NEW_EXTERNAL_ACCOUNT",
        ...record,
        evidenceFold: foldResult,
      };
    },
    enrollCampaignPosition({ campaignId, npub, positionRef }) {
      if (!accountsByNpub.has(npub)) return { accepted: false, status: "ACCEPTED_PORTABLE_BINDING_REQUIRED" };
      const key = `${campaignId}:${npub}`;
      const existing = campaignPositions.get(key);
      if (existing) return { accepted: true, status: "IDEMPOTENT_CAMPAIGN_POSITION", position: existing, duplicateWeightAdded: false };
      const position = Object.freeze({ campaignId, npub, positionRef });
      campaignPositions.set(key, position);
      return { accepted: true, status: "ACCEPTED_NEW_CAMPAIGN_POSITION", position, duplicateWeightAdded: false };
    },
    snapshot() {
      return {
        accounts: [...accounts.values()].sort((left, right) => `${left.namespace}:${left.accountId}`.localeCompare(`${right.namespace}:${right.accountId}`)),
        campaignPositions: [...campaignPositions.values()].sort((left, right) => `${left.campaignId}:${left.npub}`.localeCompare(`${right.campaignId}:${right.npub}`)),
      };
    },
  });
}

export const R13A_WIRE_PINS = Object.freeze({
  methodId: BERM_R13A_METHOD_ID,
  methodHash: BERM_R13A_METHOD_HASH,
  acquisitionId: BERM_R13A_ACQUISITION_ID,
  acquisitionHash: BERM_R13A_ACQUISITION_HASH,
});
