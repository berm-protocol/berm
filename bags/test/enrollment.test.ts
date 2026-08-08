/**
 * The enrollment wire contract, tested against F-01's requirement:
 * Path A and Path B must be distinguishable and enforceable FROM THE SIGNED
 * OBJECT ITSELF, not from which button the user clicked.
 *
 * T-01, T-02  Path A parity, both branches, with real EVM control proof
 * T-03, T-04  Path B — explicit wallet mandatory, no derived fallback
 * T-05        mode confusion — every one of these must FAIL
 *
 * The invariant these serve, stated by the review and worth repeating because
 * it is the one that protects money:
 *
 *   No cohort root may commit an EVM destination unless control of that exact
 *   destination has been proven.
 */

import { describe, it, expect } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import {
  buildEnrollment, parseEnrollment, checkMode, controlMessage,
  EnrollmentError, EXECUTION_MODES, dTagFor,
} from '../src/enrollment.js';

const N = secp256k1.Point.CURVE().n;
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
/** noble v2 takes key bytes, not bigints. */
const bytes32 = (d: bigint) => Uint8Array.from(Buffer.from(d.toString(16).padStart(64, '0'), 'hex'));

/** BIP-340: x-only implies even y, so an odd-y raw secret is negated. */
function normalise(d: bigint): bigint {
  const pub = secp256k1.getPublicKey(bytes32(d), true);
  return pub[0] === 0x02 ? d : N - d;
}

function identity(raw: bigint) {
  const d = normalise(raw % N || 1n);
  const pub = secp256k1.getPublicKey(bytes32(d), true);
  const npubHex = hex(pub.slice(1));
  const unc = secp256k1.getPublicKey(bytes32(d), false).slice(1);
  const evm = '0x' + hex(keccak_256(unc)).slice(-40);
  return { d, npubHex, evm, wasNegated: (raw % N) !== d };
}

/** Sign the canonical control message with an EVM key, recoverable form. */
function evmSign(d: bigint, message: string): string {
  const h = keccak_256(new TextEncoder().encode(message));
  const sig = secp256k1.sign(h, bytes32(d), { format: 'recovered' });
  return '0x' + hex(sig);
}

function evmRecover(message: string, signature: string): string | null {
  try {
    const h = keccak_256(new TextEncoder().encode(message));
    const raw = Buffer.from(signature.slice(2), 'hex');
    // recoverPublicKey returns COMPRESSED (33 bytes). Hashing that directly
    // yields a plausible-looking address for the wrong key — the failure is
    // silent, which is exactly the class of bug this whole file exists to catch.
    const comp = secp256k1.recoverPublicKey(raw, h);
    const unc = secp256k1.Point.fromBytes(comp).toBytes(false).slice(1);
    return '0x' + hex(keccak_256(unc)).slice(-40);
  } catch { return null; }
}

/* ------------------------------------------------------------------ */

const CAMPAIGN = 'berm-genesis';
// Chosen so one is even-y raw and one is odd-y raw. Asserted below, not assumed.
const RAW_EVEN = 1n;
const RAW_ODD  = 0x1111111111111111111111111111111111111111111111111111111111111111n;

function enrol(id: ReturnType<typeof identity>, mode: 'derived_v1' | 'bound_wallet_v1',
               address: string, signWith: bigint) {
  const msg = controlMessage(CAMPAIGN, mode, id.npubHex, address);
  return buildEnrollment({
    campaign: CAMPAIGN, mode, evmAddress: address,
    evmProof: evmSign(signWith, msg), createdAt: 1_700_000_000,
  });
}

/* ---------- T-01 / T-02 — Path A, both parity branches -------------- */

describe('T-01/T-02 — Path A, derived_v1, both parity branches', () => {
  for (const [label, raw] of [['even-Y', RAW_EVEN], ['odd-Y', RAW_ODD]] as const) {
    it(`${label}: the persisted secret controls the committed address`, () => {
      const id = identity(raw);
      expect(id.wasNegated).toBe(label === 'odd-Y');   // the branch is real, not assumed

      // The persisted secret is always even-y. This is the property that makes
      // the exported key open the displayed address.
      expect(secp256k1.getPublicKey(bytes32(id.d), true)[0]).toBe(0x02);

      const ev = enrol(id, 'derived_v1', id.evm, id.d);
      const parsed = parseEnrollment({ ...ev }, 'npub-test');
      const r = checkMode(parsed, id.npubHex, () => id.evm, evmRecover);
      expect(r.ok, r.reason).toBe(true);
    });
  }

  it('key 1 anchors to the canonical Ethereum address', () => {
    // Checkable against any Ethereum tool in existence. If this line fails the
    // derivation is wrong and nothing else needs debugging.
    expect(identity(1n).evm.toLowerCase())
      .toBe('0x7e5f4552091a69125d5dfcb7b8c2659029395bdf');
  });

  it('a derived_v1 committing a NON-canonical address is rejected', () => {
    const id = identity(RAW_ODD);
    const other = identity(7n);
    const ev = enrol(id, 'derived_v1', other.evm, other.d);   // proof is valid…
    const parsed = parseEnrollment(ev, 'npub-test');
    const r = checkMode(parsed, id.npubHex, () => id.evm, evmRecover);
    // …but the address is not the one this npub derives to.
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/derives to/);
  });

  it('derived_v1 cannot be validated without a derivation, and unvalidated is not valid', () => {
    const id = identity(RAW_EVEN);
    const parsed = parseEnrollment(enrol(id, 'derived_v1', id.evm, id.d), 'npub-test');
    const r = checkMode(parsed, id.npubHex, () => null, evmRecover);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Unvalidated is not valid/);
  });
});

/* ---------- T-03 / T-04 — Path B ------------------------------------ */

describe('T-03/T-04 — Path B, bound_wallet_v1', () => {
  const id = identity(0x2222222222222222222222222222222222222222222222222222222222222222n);
  const wallet = identity(0x99n);   // an ordinary, unrelated EVM key

  it('an explicit wallet that signed for itself is accepted', () => {
    const parsed = parseEnrollment(enrol(id, 'bound_wallet_v1', wallet.evm, wallet.d), 'npub-b');
    const r = checkMode(parsed, id.npubHex, () => id.evm, evmRecover);
    expect(r.ok, r.reason).toBe(true);
    expect(parsed.evmAddress).toBe(wallet.evm.toLowerCase());
  });

  it('the WRONG wallet signing is rejected', () => {
    const msg = controlMessage(CAMPAIGN, 'bound_wallet_v1', id.npubHex, wallet.evm);
    const ev = buildEnrollment({
      campaign: CAMPAIGN, mode: 'bound_wallet_v1', evmAddress: wallet.evm,
      evmProof: evmSign(identity(0x77n).d, msg),   // someone else's key
      createdAt: 1_700_000_000,
    });
    const r = checkMode(parseEnrollment(ev, 'npub-b'), id.npubHex, () => id.evm, evmRecover);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/DIFFERENT address/);
  });

  it('a bound_wallet_v1 naming the DERIVED address is ACCEPTED — the proof carries the security', () => {
    // G-02, and the inversion of an earlier rule. If the user proved control of
    // the address, a numeric coincidence with derive(npub) is not a reason to
    // reject them; the mode label is provenance, not a security boundary.
    // What the coincidence DOES create is a disclosure duty in the UI, because a
    // Path-B user was never told to back up a key. That belongs in copy, not here.
    const parsed = parseEnrollment(enrol(id, 'bound_wallet_v1', id.evm, id.d), 'npub-b');
    const r = checkMode(parsed, id.npubHex, () => id.evm, evmRecover);
    expect(r.ok).toBe(true);
  });

  it('a bunker user is never assumed able to sign EVM — the proof is a separate key', () => {
    // T-04. Nothing in the contract lets a NIP-46 signature stand in for an EVM
    // one; the wallet proof is its own field and its own key.
    const parsed = parseEnrollment(enrol(id, 'bound_wallet_v1', wallet.evm, wallet.d), 'npub-b');
    expect(parsed.evmProof).toMatch(/^0x[0-9a-f]{130}$/i);
    expect(parsed.evmAddress).not.toBe(id.evm.toLowerCase());
  });
});

/* ---------- T-05 — mode confusion. Every case must FAIL ------------- */

describe('T-05 — mode confusion fails closed', () => {
  const id = identity(0x3333333333333333333333333333333333333333333333333333333333333333n);
  const good = enrol(id, 'derived_v1', id.evm, id.d);
  const drop = (name: string) => ({ ...good, tags: good.tags.filter((t) => t[0] !== name) });
  const set  = (name: string, v: string) => ({
    ...good, tags: good.tags.map((t) => (t[0] === name ? [name, v] : t)),
  });

  it('MISSING mode is rejected — there is no default', () => {
    expect(() => parseEnrollment(drop('mode'), 'n')).toThrow(/missing execution mode/i);
  });

  it('and the rejection says WHY, because the old default was the dangerous one', () => {
    expect(() => parseEnrollment(drop('mode'), 'n')).toThrow(/derive from the npub/i);
  });

  it('UNKNOWN mode is rejected rather than guessed', () => {
    expect(() => parseEnrollment(set('mode', 'derived_v2'), 'n')).toThrow(/unknown execution mode/i);
  });

  it('a legacy addressless event cannot parse at all', () => {
    expect(() => parseEnrollment(drop('address'), 'n')).toThrow(/missing or invalid EVM address/i);
  });

  it('MISSING evm_proof is rejected in BOTH modes', () => {
    expect(() => parseEnrollment(drop('evm_proof'), 'n')).toThrow(/requires evm_proof/i);
    const b = enrol(id, 'bound_wallet_v1', identity(0x55n).evm, identity(0x55n).d);
    expect(() => parseEnrollment({ ...b, tags: b.tags.filter((t) => t[0] !== 'evm_proof') }, 'n'))
      .toThrow(/requires evm_proof/i);
  });

  it('a malformed proof is rejected before any cryptography runs', () => {
    expect(() => parseEnrollment(set('evm_proof', '0xdeadbeef'), 'n')).toThrow(/requires evm_proof/i);
  });

  it('DUPLICATE tags are ambiguity, not redundancy', () => {
    const two = { ...good, tags: [...good.tags, ['mode', 'bound_wallet_v1']] };
    expect(() => parseEnrollment(two, 'n')).toThrow(/duplicate "mode"/i);
  });

  it('a proof bound to one mode does not lift into the other', () => {
    // The mode is inside the signed preimage, so this fails at the cryptographic
    // layer rather than the parsing layer — which is the point of putting it there.
    const wallet = identity(0x66n);
    const msg = controlMessage(CAMPAIGN, 'bound_wallet_v1', id.npubHex, wallet.evm);
    const lifted = buildEnrollment({
      campaign: CAMPAIGN, mode: 'derived_v1', evmAddress: wallet.evm,
      evmProof: evmSign(wallet.d, msg), createdAt: 1_700_000_000,
    });
    const r = checkMode(parseEnrollment(lifted, 'n'), id.npubHex, () => id.evm, evmRecover);
    expect(r.ok).toBe(false);
  });

  it('a proof for a DIFFERENT campaign does not lift either', () => {
    const msg = controlMessage('other-campaign', 'derived_v1', id.npubHex, id.evm);
    const ev = buildEnrollment({
      campaign: CAMPAIGN, mode: 'derived_v1', evmAddress: id.evm,
      evmProof: evmSign(id.d, msg), createdAt: 1_700_000_000,
    });
    const r = checkMode(parseEnrollment(ev, 'n'), id.npubHex, () => id.evm, evmRecover);
    expect(r.ok).toBe(false);
  });

  it('the builder refuses an unknown mode too — not only the parser', () => {
    expect(() => buildEnrollment({
      campaign: CAMPAIGN, mode: 'whatever' as never, evmAddress: id.evm,
      evmProof: '0x' + 'ab'.repeat(65), createdAt: 1,
    })).toThrow(/unknown execution mode/i);
  });

  it('only two modes exist, and they are versioned', () => {
    expect([...EXECUTION_MODES]).toEqual(['derived_v1', 'bound_wallet_v1']);
  });

  it('the d tag binds the campaign, so an event cannot be replayed into another', () => {
    const wrong = { ...good, tags: good.tags.map((t) => (t[0] === 'd' ? ['d', dTagFor('elsewhere')] : t)) };
    expect(() => parseEnrollment(wrong, 'n')).toThrow(/d tag does not match/i);
  });
});
