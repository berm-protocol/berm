/**
 * A Merkle root that anyone can rebuild — and the three ways that goes wrong.
 *
 * The ordinary assertions here (a proof verifies, a tampered one does not) are
 * the easy half. The half that matters is the attacks: second preimage, odd-node
 * duplication, and ambiguous leaf encoding. Each is a known way to forge a claim
 * against an honest root, each has been shipped in production somewhere, and
 * none of them is caught by testing that the happy path works.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  buildTree, proofFor, verifyProof, leafHash, encodeLeaf,
  distributeEqually, reconcile, MerkleError,
  type Entitlement,
} from '../src/merkle.js';

const A = 'So11111111111111111111111111111111111111112';
const B = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const C = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// index 0 is a placeholder in fixtures — buildTree assigns the real one.
const e = (npub: string, solanaAddress: string, amount: bigint): Entitlement =>
  ({ index: 0, npub, solanaAddress, amount });

const SET: Entitlement[] = [
  e('npub1alice', A, 1000n),
  e('npub1bob', B, 1000n),
  e('npub1carol', C, 1000n),
];

describe('a stranger can rebuild the root', () => {
  it('the same set produces the same root regardless of input order', () => {
    // Relays return events in whatever order they like. Two honest parties
    // fetching the same set must agree or the exercise is pointless.
    const forwards = buildTree(SET).root;
    const backwards = buildTree([...SET].reverse()).root;
    const shuffled = buildTree([SET[1]!, SET[2]!, SET[0]!]).root;
    expect(backwards).toBe(forwards);
    expect(shuffled).toBe(forwards);
  });

  it('every member has a proof that verifies', () => {
    const tree = buildTree(SET);
    for (const entry of tree.entries) {
      expect(verifyProof(entry, proofFor(tree, entry.npub), tree.root)).toBe(true);
    }
  });

  it('a different set produces a different root', () => {
    const other = buildTree([...SET, e('npub1dave', A, 1000n)]).root;
    expect(other).not.toBe(buildTree(SET).root);
  });

  it('changing one amount changes the root', () => {
    const greedy = SET.map((x) => (x.npub === 'npub1bob' ? { ...x, amount: 9999n } : x));
    expect(buildTree(greedy).root).not.toBe(buildTree(SET).root);
  });
});

describe('attack 1 — second preimage', () => {
  it('the leaf and node hash spaces are disjoint', () => {
    // The invariant, tested directly rather than by inspecting a layer.
    //
    // A first draft asserted "nothing in layer 1 is a leaf hash" and failed —
    // correctly. With an odd leaf count the last leaf is PROMOTED unchanged, so
    // it appears in layer 1 by design. That is the CVE-2012-2459 fix working,
    // not a leak: a promoted leaf is still the legitimate leaf, hashed with the
    // leaf prefix. The attack being prevented is presenting a *computed* node —
    // a hash of two children — as a leaf, and the prefixes make that impossible.
    const a = leafHash(SET[0]!);
    const b = leafHash(SET[1]!);

    // Same two hashes, combined as a node, can never collide with any leaf.
    const tree = buildTree(SET);
    const computed = tree.layers[1]![0]!;             // H(0x01 || a || b)
    expect(computed).not.toBe(a);
    expect(computed).not.toBe(b);
    expect(tree.leaves).not.toContain(computed);
  });

  it('an internal node cannot be claimed as an entitlement', () => {
    const tree = buildTree(SET);
    const internalNode = tree.layers[1]![0]!;
    // Try to claim by pretending the node hash is our leaf. verifyProof takes an
    // Entitlement and hashes it itself, so there is no way to inject a raw hash.
    const forged: Entitlement = { index: 0, npub: internalNode, solanaAddress: A, amount: 999_999n };
    expect(verifyProof(forged, [], tree.root)).toBe(false);
    expect(verifyProof(forged, tree.leaves, tree.root)).toBe(false);
  });
});

describe('attack 2 — odd node duplication (CVE-2012-2459)', () => {
  it('an odd node is promoted, not duplicated', () => {
    // Duplicating the last node to pad a level lets a DIFFERENT leaf set produce
    // the SAME root. Three leaves: [a,b,c] -> [H(a,b), c] -> root.
    const tree = buildTree(SET);
    expect(tree.leaves).toHaveLength(3);
    expect(tree.layers[1]).toHaveLength(2);
    // The promoted node is the third leaf unchanged, not a hash of it with itself.
    expect(tree.layers[1]![1]).toBe(tree.leaves[2]);
  });

  it('a five-leaf tree still gives every member a working proof', () => {
    // Odd counts at more than one level is where promotion bugs actually surface.
    const five = ['a', 'b', 'c', 'd', 'e'].map((n, i) => e(`npub1${n}`, A, BigInt(i + 1)));
    const tree = buildTree(five);
    for (const entry of tree.entries) {
      expect(verifyProof(entry, proofFor(tree, entry.npub), tree.root)).toBe(true);
    }
  });

  it('works for every size from 1 to 33', () => {
    for (let n = 1; n <= 33; n++) {
      const set = Array.from({ length: n }, (_, i) =>
        e(`npub1${String(i).padStart(3, '0')}`, A, BigInt(i + 1)));
      const tree = buildTree(set);
      for (const entry of tree.entries) {
        expect(verifyProof(entry, proofFor(tree, entry.npub), tree.root)).toBe(true);
      }
    }
  });
});

describe('attack 3 — ambiguous leaf encoding', () => {
  it('field boundaries cannot be moved', () => {
    // Plain concatenation makes these identical, so a valid proof for one is a
    // valid proof for a leaf that was never in the tree.
    const one = e('npub1a', 'Xyz', 1n);
    const two = e('npub1', 'aXyz', 1n);
    expect(leafHash(one)).not.toBe(leafHash(two));
    expect(Array.from(encodeLeaf(one))).not.toEqual(Array.from(encodeLeaf(two)));
  });

  it('an empty field is still unambiguous', () => {
    expect(leafHash(e('', 'ab', 1n))).not.toBe(leafHash(e('a', 'b', 1n)));
  });

  it('the amount is part of the leaf, so it cannot be raised after the fact', () => {
    const tree = buildTree(SET);
    const bob = tree.entries.find((x) => x.npub === 'npub1bob')!;
    const proof = proofFor(tree, 'npub1bob');
    expect(verifyProof(bob, proof, tree.root)).toBe(true);
    expect(verifyProof({ ...bob, amount: bob.amount + 1n }, proof, tree.root)).toBe(false);
  });

  it('the payout address is part of the leaf, so it cannot be redirected', () => {
    const tree = buildTree(SET);
    const bob = tree.entries.find((x) => x.npub === 'npub1bob')!;
    const proof = proofFor(tree, 'npub1bob');
    expect(verifyProof({ ...bob, solanaAddress: A }, proof, tree.root)).toBe(false);
  });

  it("one member's proof does not verify another member's leaf", () => {
    const tree = buildTree(SET);
    const alice = tree.entries.find((x) => x.npub === 'npub1alice')!;
    expect(verifyProof(alice, proofFor(tree, 'npub1bob'), tree.root)).toBe(false);
  });

  it('a malformed proof element is rejected rather than throwing', () => {
    const tree = buildTree(SET);
    const alice = tree.entries.find((x) => x.npub === 'npub1alice')!;
    for (const junk of ['', 'zz', 'not-hex', 'ab'.repeat(40)]) {
      expect(verifyProof(alice, [junk], tree.root)).toBe(false);
    }
  });
});

describe('refusals', () => {
  it('a duplicate npub is refused, not silently deduplicated', () => {
    // Two leaves for one subscriber is one claim too many, and deduplicating
    // quietly is how a double allocation becomes a double payout nobody saw.
    expect(() => buildTree([e('npub1a', A, 1n), e('npub1a', B, 1n)]))
      .toThrow(/duplicate npub/);
  });

  it('an empty tree is refused', () => {
    expect(() => buildTree([])).toThrow(/no entitlements/);
  });

  it('a negative amount is refused', () => {
    expect(() => buildTree([e('npub1a', A, -1n)])).toThrow(/negative/);
  });

  it('an amount too large for u64 is refused rather than wrapping', () => {
    expect(() => buildTree([e('npub1a', A, 2n ** 64n)])).toThrow(/out of range/);
  });

  it('a proof for someone not in the tree is refused', () => {
    expect(() => proofFor(buildTree(SET), 'npub1nobody')).toThrow(/not in this tree/);
  });
});

describe('splitting the pot', () => {
  it('splits equally at base-unit precision', () => {
    const d = distributeEqually(
      [{ npub: 'npub1a', solanaAddress: A }, { npub: 'npub1b', solanaAddress: B }],
      1000n,
    );
    expect(d.entries.every((x) => x.amount === 500n)).toBe(true);
    expect(d.allocated).toBe(1000n);
    expect(d.dust).toBe(0n);
  });

  it('reports the remainder instead of giving it to someone', () => {
    // Handing dust to "the first by sort order" is deterministic AND a silent
    // decision that somebody gets more. It stays in the vault, visible.
    const d = distributeEqually(
      ['a', 'b', 'c'].map((n) => ({ npub: `npub1${n}`, solanaAddress: A })),
      1000n,
    );
    expect(d.entries.every((x) => x.amount === 333n)).toBe(true);
    expect(d.allocated).toBe(999n);
    expect(d.dust).toBe(1n);
    expect(d.allocated + d.dust).toBe(1000n);
  });

  it('never allocates more than the pot', () => {
    for (const total of [0n, 1n, 7n, 999_999_999n]) {
      const d = distributeEqually(
        Array.from({ length: 7 }, (_, i) => ({ npub: `npub1${i}`, solanaAddress: A })),
        total,
      );
      expect(d.allocated).toBeLessThanOrEqual(total);
      expect(d.allocated + d.dust).toBe(total);
    }
  });
});

describe('reconciliation — the point of the whole exercise', () => {
  const members = ['a', 'b', 'c'].map((n) => ({ npub: `npub1${n}`, solanaAddress: A }));

  it('confirms an honest publication', () => {
    const d = distributeEqually(members, 900n);
    const r = reconcile(d.root, d.entries, members, 900n);
    expect(r.matches).toBe(true);
    expect(r.omitted).toEqual([]);
    expect(r.extra).toEqual([]);
  });

  it('catches a subscriber left out of the published list', () => {
    const shortlist = members.slice(0, 2);
    const d = distributeEqually(shortlist, 900n);
    const r = reconcile(d.root, d.entries, members, 900n);
    expect(r.matches).toBe(false);
    expect(r.omitted).toEqual(['npub1c']);
  });

  it('catches a name added that no relay supports', () => {
    const padded = [...members, { npub: 'npub1ghost', solanaAddress: A }];
    const d = distributeEqually(padded, 900n);
    const r = reconcile(d.root, d.entries, members, 900n);
    expect(r.matches).toBe(false);
    expect(r.extra).toEqual(['npub1ghost']);
  });

  it('reports the difference without accusing anyone', () => {
    // A root can differ because of a late subscription or a relay that was down
    // as easily as an omission. Naming both sets lets a reader tell which; a
    // verdict would be a claim the data cannot carry.
    const d = distributeEqually(members.slice(0, 2), 900n);
    const r = reconcile(d.root, d.entries, members, 900n);
    expect(r.summary).toMatch(/late subscription or a relay that was down/);
    expect(r.summary).not.toMatch(/fraud|stole|cheated|lied/i);
  });
});

describe('an independent implementation gets the same root', () => {
  // The point of publishing a root is that somebody ELSE rebuilds it — and the
  // someone else here will eventually be a Solana program written in Rust, not
  // this file. So this reimplements the scheme from the description in
  // merkle.ts's header, using node:crypto instead of @noble and a different
  // structure, and asserts the roots agree.
  //
  // If this ever fails, either the code changed or the description no longer
  // describes it. Both are the same bug: a commitment nobody can reproduce.
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

  const independentLeaf = (e: Entitlement) => {
    const npub = Buffer.from(e.npub, 'utf8');
    const addr = Buffer.from(e.solanaAddress, 'utf8');
    const len = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
    const amt = Buffer.alloc(8); amt.writeBigUInt64BE(e.amount);
    return sha(Buffer.concat([
      Buffer.from([0x00]), len(e.index), len(npub.length), npub, len(addr.length), addr, amt,
    ]));
  };

  const independentNode = (x: string, y: string) => {
    const [l, r] = x <= y ? [x, y] : [y, x];
    return sha(Buffer.concat([Buffer.from([0x01]), Buffer.from(l, 'hex'), Buffer.from(r, 'hex')]));
  };

  const independentRoot = (entries: Entitlement[]) => {
    // BYTEWISE, matching production. This used localeCompare('en'), which
    // disagrees with code-unit order on case and diacritics — so the differential
    // test proved agreement on exactly the ASCII inputs where agreement was never
    // in doubt, and would have diverged silently on anything else. R1 found it.
    const sorted = [...entries]
      .sort((a, b) => (a.npub < b.npub ? -1 : a.npub > b.npub ? 1 : 0))
      .map((e, index) => ({ ...e, index }));
    let level = sorted.map(independentLeaf);
    while (level.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < level.length; i += 2) {
        next.push(i + 1 < level.length ? independentNode(level[i]!, level[i + 1]!) : level[i]!);
      }
      level = next;
    }
    return level[0]!;
  };

  it.each([1, 2, 3, 4, 5, 8, 9, 17])('agrees for %i entitlement(s)', (n) => {
    const set = Array.from({ length: n }, (_, i) =>
      e(`npub1${String(i).padStart(3, '0')}`, [A, B, C][i % 3]!, BigInt((i + 1) * 137)));
    expect(independentRoot(set)).toBe(buildTree(set).root);
  });

  // Fixtures that are NOT tidy ASCII, because the tidy ones could not have failed.
  it.each([
    ['mixed case',        ['npub1Z', 'npub1a', 'npub1A', 'npub1z']],
    ['diacritics',        ['npub1é', 'npub1e', 'npub1E', 'npub1ê']],
    ['non-latin',         ['npub1ω', 'npub1a', 'npub1д', 'npub1中']],
    ['digits vs letters', ['npub19', 'npub1a', 'npub10', 'npub1Z']],
    ['long shared prefix',['npub1aaaaaaaab', 'npub1aaaaaaaaa', 'npub1aaaaaaaac']],
  ])('agrees on %s, where a locale comparator would not', (_name, npubs) => {
    const set = npubs.map((npub, i) => e(npub, [A, B, C][i % 3]!, BigInt(i + 1)));
    expect(independentRoot(set)).toBe(buildTree(set).root);
  });

  it('and those fixtures really do separate the two comparators', () => {
    // Guards against the fixtures quietly becoming ASCII-equivalent again, which
    // would make every assertion above pass for the wrong reason.
    const tricky = ['npub1Z', 'npub1a', 'npub1A', 'npub1z'];
    const bytewise = [...tricky].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const locale = [...tricky].sort((a, b) => a.localeCompare(b, 'en'));
    expect(locale).not.toEqual(bytewise);
  });

  it('agrees on a proof, so a Rust verifier written from the same text will too', () => {
    const tree = buildTree(SET);
    const bob = tree.entries.find((x) => x.npub === 'npub1bob')!;
    let h = independentLeaf(bob);
    for (const sibling of proofFor(tree, 'npub1bob')) h = independentNode(h, sibling);
    expect(h).toBe(tree.root);
  });
});

describe('the claim index — what an on-chain bitmap needs', () => {
  it('is assigned by the tree, in sorted order, starting at 0', () => {
    const tree = buildTree([e('npub1c', C, 1n), e('npub1a', A, 2n), e('npub1b', B, 3n)]);
    expect(tree.entries.map((x) => [x.index, x.npub]))
      .toEqual([[0, 'npub1a'], [1, 'npub1b'], [2, 'npub1c']]);
  });

  it('a caller-supplied index is overwritten, not trusted', () => {
    // Otherwise it is another self-asserted field, and this file already knows
    // how those end. Someone claiming index 0 does not get index 0.
    const tree = buildTree([
      { index: 999, npub: 'npub1z', solanaAddress: A, amount: 1n },
      { index: 0, npub: 'npub1a', solanaAddress: B, amount: 1n },
    ]);
    expect(tree.entries.find((x) => x.npub === 'npub1z')!.index).toBe(1);
  });

  it('claiming with somebody else\'s index fails', () => {
    // THE REASON THE INDEX IS IN THE LEAF. An on-chain distributor sets one bit
    // per claimant to stop double claims. If the index were merely passed
    // alongside a valid proof rather than committed inside it, a claimant could
    // set a stranger's bit and lock them out permanently, for free.
    const tree = buildTree(SET);
    const bob = tree.entries.find((x) => x.npub === 'npub1bob')!;
    const proof = proofFor(tree, 'npub1bob');
    expect(verifyProof(bob, proof, tree.root)).toBe(true);
    for (const stolen of [0, 2, 999]) {
      if (stolen === bob.index) continue;
      expect(verifyProof({ ...bob, index: stolen }, proof, tree.root)).toBe(false);
    }
  });

  it('indices are contiguous and unique across any size', () => {
    for (const n of [1, 2, 7, 33]) {
      const set = Array.from({ length: n }, (_, i) =>
        e(`npub1${String(i).padStart(3, '0')}`, A, BigInt(i + 1)));
      const tree = buildTree(set);
      expect(tree.entries.map((x) => x.index)).toEqual([...Array(n).keys()]);
    }
  });
});
