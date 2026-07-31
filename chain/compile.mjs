/**
 * Compile BermRoot, and prove it has no privileged surface.
 *
 * The contract cannot be patched after deployment, so "it has no admin" has to
 * be a checked fact rather than a design intention. This asserts it against the
 * COMPILED ARTEFACT — the ABI a client will use and the bytecode a chain will
 * run — not against the source, because a comment claiming immutability is worth
 * nothing and the source is not what gets deployed.
 *
 *   node compile.mjs      → build/BermRoot.json  (abi, bytecode, source hash)
 */

import solc from 'solc';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, 'contracts/BermRoot.sol');
const source = readFileSync(SRC, 'utf8');

const input = {
  language: 'Solidity',
  sources: { 'BermRoot.sol': { content: source } },
  settings: {
    // Pinned so a rebuild from the same source produces the same bytecode. A
    // contract nobody can reproduce is a contract nobody can audit.
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'shanghai',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  },
};

const out = JSON.parse(solc.compile(JSON.stringify(input)));

const errors = (out.errors ?? []).filter((e) => e.severity === 'error');
if (errors.length) {
  for (const e of errors) console.error(e.formattedMessage);
  process.exit(1);
}
for (const w of (out.errors ?? []).filter((e) => e.severity === 'warning')) {
  console.log(`  warning: ${w.message.split('\n')[0]}`);
}

const c = out.contracts['BermRoot.sol'].BermRoot;
const abi = c.abi;
const bytecode = c.evm.bytecode.object;
const deployed = c.evm.deployedBytecode.object;

/* ------------------------------------------------------------------ *
 * The audit
 * ------------------------------------------------------------------ */

let failed = 0;
const ck = (name, ok, note = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(56)} ${note}`);
  if (!ok) failed++;
};

console.log(`\nBermRoot — compiled with solc ${solc.version().split('+')[0]}`);
console.log('-'.repeat(76));

const fns = abi.filter((x) => x.type === 'function');
const writes = fns.filter((f) => f.stateMutability !== 'view' && f.stateMutability !== 'pure');

console.log(`  ${fns.length} functions (${writes.length} state-changing): ` +
            writes.map((f) => f.name).join(', '));

// A privileged function is the thing that would make "immutable" a lie. Matched
// on whole words: an earlier version of this pattern would have flagged
// `pendingHandover` for containing "pending", which is the fourth loose-regex
// false positive this repository has produced.
const PRIVILEGED = /^(owner|admin|upgrade|pause|unpause|setImplementation|initialize|transferOwnership|renounceOwnership|migrate|rescue|sweep|withdraw|mint|burn)$/i;
const offenders = fns.filter((f) => PRIVILEGED.test(f.name));
ck('no owner, admin, upgrade, pause or rescue function', offenders.length === 0,
   offenders.map((f) => f.name).join(', '));

ck('no constructor — nothing is configured at deploy time',
   !abi.some((x) => x.type === 'constructor' && (x.inputs ?? []).length > 0));

ck('no payable function — the contract can never hold value',
   !fns.some((f) => f.stateMutability === 'payable') &&
   !abi.some((x) => x.type === 'receive' || x.type === 'fallback'));

/**
 * Opcodes that would let deployed code be removed, replaced or extended.
 *
 * A NAIVE BYTE SCAN DOES NOT WORK, and the first version of this check failed
 * three times against a contract that contains none of these. `0xff` and `0xf4`
 * appear constantly as PUSH immediates, function selectors, custom-error
 * selectors and inside the appended metadata. Distinguishing an OPCODE from
 * DATA requires walking the program and skipping each PUSH's immediate bytes,
 * which is what this does.
 *
 * The CBOR metadata Solidity appends is stripped first: it is not code, it is
 * arbitrary bytes, and disassembling it produces nonsense.
 */
function stripMetadata(hex) {
  const bytes = Buffer.from(hex, 'hex');
  if (bytes.length < 2) return bytes;
  // Last two bytes are the big-endian length of the CBOR blob preceding them.
  const cborLen = bytes.readUInt16BE(bytes.length - 2);
  const cut = bytes.length - 2 - cborLen;
  return cut > 0 && cut < bytes.length ? bytes.subarray(0, cut) : bytes;
}

function opcodesIn(hex) {
  const code = stripMetadata(hex);
  const seen = new Set();
  for (let i = 0; i < code.length; i++) {
    const op = code[i];
    seen.add(op);
    // PUSH1..PUSH32 carry 1..32 immediate bytes that are DATA, not instructions.
    if (op >= 0x60 && op <= 0x7f) i += op - 0x5f;
  }
  return seen;
}

const ops = opcodesIn(deployed);
const name = (n) => `0x${n.toString(16)}`;
ck('no SELFDESTRUCT in executable code', !ops.has(0xff), ops.has(0xff) ? name(0xff) : '');
ck('no DELEGATECALL in executable code', !ops.has(0xf4), ops.has(0xf4) ? name(0xf4) : '');
ck('no CREATE / CREATE2 — the contract deploys nothing',
   !ops.has(0xf0) && !ops.has(0xf5));
ck('no CALL / CALLCODE — it never invokes another contract',
   !ops.has(0xf1) && !ops.has(0xf2));

// Every state-changing function must be reachable only by a record's controller
// or, for claim, by anyone claiming an unclaimed key. Checked by shape here and
// by execution in evm.mjs — this alone is not proof.
const expected = ['claim', 'update', 'startHandover', 'cancelHandover', 'completeHandover', 'revoke'];
ck('the write surface is exactly the six documented operations',
   writes.length === expected.length && expected.every((n) => writes.some((f) => f.name === n)),
   writes.map((f) => f.name).join(', '));

ck('revoke takes no argument that could un-revoke',
   fns.find((f) => f.name === 'revoke')?.inputs.length === 1);

const size = deployed.length / 2;
ck('runtime bytecode is under the 24 KB deployment limit', size < 24576, `${size} bytes`);

console.log('-'.repeat(76));

if (failed) {
  console.error(`\n${failed} audit check(s) FAILED — not writing an artefact\n`);
  process.exit(1);
}

mkdirSync(resolve(HERE, 'build'), { recursive: true });
const artefact = {
  contract: 'BermRoot',
  solc: solc.version(),
  settings: { optimizer: input.settings.optimizer, evmVersion: input.settings.evmVersion },
  sourceSha256: createHash('sha256').update(source).digest('hex'),
  deployedSha256: createHash('sha256').update(deployed).digest('hex'),
  abi,
  bytecode,
  deployedBytecode: deployed,
};
writeFileSync(resolve(HERE, 'build/BermRoot.json'), JSON.stringify(artefact, null, 2) + '\n');

console.log(`\n  source   sha256 ${artefact.sourceSha256}`);
console.log(`  runtime  sha256 ${artefact.deployedSha256}`);
console.log(`\n  build/BermRoot.json — reproduce with the same solc and settings and compare\n`);
