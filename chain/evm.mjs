/**
 * Run BermRoot in a real EVM.
 *
 * The compile step proves the ABI and bytecode contain no privileged surface.
 * That is a shape check. This one DEPLOYS the contract and calls it, because the
 * properties that matter are behavioural: that a stranger cannot update someone
 * else's record, that a revocation cannot be undone, and that a handover cannot
 * be completed early. A contract cannot be patched after deployment, so a claim
 * about it that has not been executed is a claim nobody should accept.
 *
 * No network, no testnet, no keys. @ethereumjs/vm in-process.
 */

import { VM } from '@ethereumjs/vm';
import { Address, Account, hexToBytes, bytesToHex } from '@ethereumjs/util';
import { keccak256 } from 'ethereum-cryptography/keccak.js';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const art = JSON.parse(readFileSync(resolve(HERE, 'build/BermRoot.json'), 'utf8'));

let pass = 0, fail = 0;
const ck = (name, ok, note = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(60)} ${note}`);
  ok ? pass++ : fail++;
};

/* ---------- minimal ABI encoding, so the test has no framework ---------- */

const selector = (sig) => bytesToHex(keccak256(Buffer.from(sig))).slice(0, 10);
const pad = (hex) => hex.replace(/^0x/, '').padStart(64, '0');
const encAddr = (a) => pad(a.toString());
const encB32 = (h) => pad(h);
const encU = (n) => pad(BigInt(n).toString(16));

const SEL = {
  claim: selector('claim(bytes32,bytes32)'),
  update: selector('update(bytes32,bytes32)'),
  startHandover: selector('startHandover(bytes32,address)'),
  cancelHandover: selector('cancelHandover(bytes32)'),
  completeHandover: selector('completeHandover(bytes32)'),
  revoke: selector('revoke(bytes32)'),
  get: selector('get(bytes32)'),
  pendingHandover: selector('pendingHandover(bytes32)'),
  isClaimed: selector('isClaimed(bytes32)'),
};

/** Custom-error selectors, so a revert can be identified rather than just counted. */
const ERR = Object.fromEntries(
  ['AlreadyClaimed()', 'NotClaimed()', 'NotController()', 'IsRevoked()', 'ZeroPubkey()',
   'ZeroPointer()', 'ZeroAddress()', 'NoHandover()', 'TooEarly()', 'NotPendingController()']
    .map((s) => [selector(s), s.replace('()', '')]),
);

/* ---------- accounts ---------- */
const alice = new Address(hexToBytes('0x' + '11'.repeat(20)));
const mallory = new Address(hexToBytes('0x' + '22'.repeat(20)));
const bob = new Address(hexToBytes('0x' + '33'.repeat(20)));

const PUBKEY = '0x' + 'ab'.repeat(32);
const OTHER_PUBKEY = '0x' + 'cd'.repeat(32);
const POINTER_A = '0x' + '01'.repeat(32);
const POINTER_B = '0x' + '02'.repeat(32);

const vm = await VM.create();
for (const a of [alice, mallory, bob]) {
  await vm.stateManager.putAccount(a, new Account(0n, 10n ** 20n));
}

/* ---------- deploy ---------- */
let timestamp = 1_780_000_000n;

async function call(from, to, data, { value = 0n } = {}) {
  const res = await vm.evm.runCall({
    caller: from, origin: from, to, value,
    data: hexToBytes(data.startsWith('0x') ? data : '0x' + data),
    gasLimit: 5_000_000n,
    block: { header: { number: 1n, timestamp, difficulty: 0n, gasLimit: 30_000_000n, baseFeePerGas: 0n, coinbase: Address.zero(), prevRandao: new Uint8Array(32) } },
  });
  const out = res.execResult;
  const returned = bytesToHex(out.returnValue ?? new Uint8Array());
  return {
    ok: !out.exceptionError,
    error: out.exceptionError?.error,
    returned,
    revert: ERR[returned.slice(0, 10)] ?? (out.exceptionError ? 'unknown' : null),
    createdAddress: res.createdAddress,
  };
}

const deploy = await vm.evm.runCall({
  caller: alice, origin: alice, value: 0n,
  data: hexToBytes('0x' + art.bytecode),
  gasLimit: 8_000_000n,
  block: { header: { number: 1n, timestamp, difficulty: 0n, gasLimit: 30_000_000n, baseFeePerGas: 0n, coinbase: Address.zero(), prevRandao: new Uint8Array(32) } },
});

const CONTRACT = deploy.createdAddress;

console.log('\nBermRoot — executed in a real EVM');
console.log('-'.repeat(80));
ck('deploys', !deploy.execResult.exceptionError && CONTRACT != null,
   CONTRACT ? CONTRACT.toString().slice(0, 14) + '…' : deploy.execResult.exceptionError?.error);

const send = (from, sel, args = '') => call(from, CONTRACT, sel + args);
const read = async (sel, args = '') => (await call(alice, CONTRACT, sel + args)).returned;

const getRecord = async (pk) => {
  const r = await read(SEL.get, encB32(pk));
  const w = (i) => r.slice(2 + i * 64, 2 + (i + 1) * 64);
  return {
    controller: '0x' + w(0).slice(24),
    claimedAt: BigInt('0x' + w(1)),
    updatedAt: BigInt('0x' + w(2)),
    version: Number(BigInt('0x' + w(3))),
    revoked: BigInt('0x' + w(4)) === 1n,
    pointer: '0x' + w(5),
  };
};

/* ---------- 1. claiming ---------- */
let r = await send(alice, SEL.claim, encB32(PUBKEY) + encB32(POINTER_A));
ck('alice can claim an unclaimed pubkey', r.ok, r.revert ?? '');

let rec = await getRecord(PUBKEY);
ck('the record names alice as controller',
   rec.controller.toLowerCase() === alice.toString().toLowerCase(), rec.controller.slice(0, 12) + '…');
ck('version starts at 1', rec.version === 1);
ck('claimedAt is recorded', rec.claimedAt === timestamp, String(rec.claimedAt));

r = await send(mallory, SEL.claim, encB32(PUBKEY) + encB32(POINTER_B));
ck('FIRST CLAIM WINS — mallory cannot re-claim it', !r.ok && r.revert === 'AlreadyClaimed', r.revert);

r = await send(alice, SEL.claim, encB32('0x' + '00'.repeat(32)) + encB32(POINTER_A));
ck('the zero pubkey is refused', !r.ok && r.revert === 'ZeroPubkey', r.revert);

r = await send(alice, SEL.claim, encB32(OTHER_PUBKEY) + encB32('0x' + '00'.repeat(32)));
ck('an empty pointer is refused', !r.ok && r.revert === 'ZeroPointer', r.revert);

/* ---------- 2. only the controller writes ---------- */
r = await send(mallory, SEL.update, encB32(PUBKEY) + encB32(POINTER_B));
ck('A STRANGER CANNOT UPDATE the record', !r.ok && r.revert === 'NotController', r.revert);

r = await send(mallory, SEL.revoke, encB32(PUBKEY));
ck('a stranger cannot revoke it', !r.ok && r.revert === 'NotController', r.revert);

r = await send(mallory, SEL.startHandover, encB32(PUBKEY) + encAddr(mallory));
ck('a stranger cannot start a handover to themselves',
   !r.ok && r.revert === 'NotController', r.revert);

timestamp += 60n;
r = await send(alice, SEL.update, encB32(PUBKEY) + encB32(POINTER_B));
ck('the controller can update', r.ok, r.revert ?? '');
rec = await getRecord(PUBKEY);
ck('version increments and the pointer moves',
   rec.version === 2 && rec.pointer === POINTER_B, `v${rec.version}`);
ck('claimedAt does NOT move on update — it is the ordering anchor',
   rec.claimedAt === 1_780_000_000n, String(rec.claimedAt));

r = await send(alice, SEL.update, encB32(OTHER_PUBKEY) + encB32(POINTER_A));
ck('updating an unclaimed record is refused', !r.ok && r.revert === 'NotClaimed', r.revert);

/* ---------- 3. the handover delay ---------- */
r = await send(alice, SEL.startHandover, encB32(PUBKEY) + encAddr(bob));
ck('the controller can announce a handover', r.ok, r.revert ?? '');

const pend = await read(SEL.pendingHandover, encB32(PUBKEY));
ck('the pending transfer is PUBLICLY READABLE before it lands',
   pend.slice(26, 66).toLowerCase() === bob.toString().slice(2).toLowerCase(),
   '0x' + pend.slice(26, 66).slice(0, 10) + '…');

r = await send(bob, SEL.completeHandover, encB32(PUBKEY));
ck('bob CANNOT complete it early', !r.ok && r.revert === 'TooEarly', r.revert);

r = await send(mallory, SEL.completeHandover, encB32(PUBKEY));
ck('a third party cannot complete someone else’s handover',
   !r.ok && r.revert === 'NotPendingController', r.revert);

r = await send(alice, SEL.cancelHandover, encB32(PUBKEY));
ck('the controller can cancel during the window', r.ok, r.revert ?? '');
r = await send(bob, SEL.completeHandover, encB32(PUBKEY));
ck('a cancelled handover cannot be completed', !r.ok && r.revert === 'NoHandover', r.revert);

// Restart and let the clock run past the delay.
await send(alice, SEL.startHandover, encB32(PUBKEY) + encAddr(bob));
timestamp += 7n * 24n * 3600n + 1n;
r = await send(bob, SEL.completeHandover, encB32(PUBKEY));
ck('after 7 days the incoming controller completes it', r.ok, r.revert ?? '');
rec = await getRecord(PUBKEY);
ck('control moved to bob',
   rec.controller.toLowerCase() === bob.toString().toLowerCase(), rec.controller.slice(0, 12) + '…');
ck('claimedAt STILL does not move across a handover',
   rec.claimedAt === 1_780_000_000n, String(rec.claimedAt));

r = await send(alice, SEL.update, encB32(PUBKEY) + encB32(POINTER_A));
ck('the previous controller loses all power', !r.ok && r.revert === 'NotController', r.revert);

/* ---------- 4. revocation is permanent ---------- */
r = await send(bob, SEL.revoke, encB32(PUBKEY));
ck('the controller can revoke', r.ok, r.revert ?? '');
rec = await getRecord(PUBKEY);
ck('the record reads as revoked', rec.revoked);

r = await send(bob, SEL.update, encB32(PUBKEY) + encB32(POINTER_A));
ck('REVOCATION CANNOT BE UNDONE — even by the controller',
   !r.ok && r.revert === 'IsRevoked', r.revert);
r = await send(bob, SEL.startHandover, encB32(PUBKEY) + encAddr(alice));
ck('a revoked record cannot be handed over', !r.ok && r.revert === 'IsRevoked', r.revert);
r = await send(bob, SEL.claim, encB32(PUBKEY) + encB32(POINTER_A));
ck('a revoked record cannot be re-claimed', !r.ok && r.revert === 'AlreadyClaimed', r.revert);

/* ---------- 5. it holds no value ---------- */
r = await call(alice, CONTRACT, SEL.isClaimed + encB32(PUBKEY), { value: 1n });
ck('sending value to it FAILS — it can never custody funds', !r.ok, r.error ?? 'accepted value');

const acct = await vm.stateManager.getAccount(CONTRACT);
ck('the contract balance is zero', (acct?.balance ?? 0n) === 0n, String(acct?.balance ?? 0n));

console.log('-'.repeat(80));
console.log(`  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
