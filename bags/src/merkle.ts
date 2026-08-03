/**
 * The distribution commitment: one hash that anybody can rebuild.
 *
 * WHAT THIS IS FOR. The subscriber list lives on Nostr relays. A payout — whether
 * a person sends it or a Solana program does — needs a single value that pins
 * exactly who is owed exactly how much. That value is a Merkle root: publish it,
 * and anyone can fetch the same subscriptions, run the same snapshot, rebuild the
 * same tree, and check that the root they computed is the root you published.
 *
 * A mismatch means the published list is not what the relays support. Nobody has
 * to take anyone's word for it and nobody needs cooperation to check.
 *
 * IT DOES NOT ENFORCE ANYTHING. On its own this is the checkable version, not the
 * enforced one — the same distinction `chain/` draws. A Solana program verifying
 * these proofs against a root in a PDA turns it into enforcement later, and the
 * data model does not change when it does. That is the reason to build this part
 * first: it is useful immediately and it is not thrown away.
 *
 * THE TRUST HINGE THAT SURVIVES, stated rather than hidden: somebody publishes
 * the root, and that somebody could omit people. What this design buys is that
 * the omission is provable by a stranger in one command, because the inputs — the
 * relay set, the campaign, the snapshot rule — are all public and the computation
 * is deterministic. Detection, cheap and mechanical. Not prevention.
 *
 * THREE THINGS MERKLE IMPLEMENTATIONS GET WRONG, and what is done here instead:
 *
 *   1. SECOND PREIMAGE. Without domain separation an internal node's hash can be
 *      presented as a leaf, and a forged claim verifies. Leaves are hashed with a
 *      0x00 prefix and nodes with 0x01, so no node hash can ever equal a leaf
 *      hash and the substitution is impossible rather than unlikely.
 *
 *   2. ODD NODES BY DUPLICATION. Duplicating the last node to pad a level is the
 *      Bitcoin-style approach and it lets two different leaf sets produce one
 *      root (CVE-2012-2459). An odd node is promoted unchanged instead.
 *
 *   3. AMBIGUOUS LEAF ENCODING. Concatenating fields means ("npub1a", "Xyz") and
 *      ("npub1", "aXyz") can encode identically, so one claimant's proof
 *      validates another's leaf. Every field is length-prefixed, which makes the
 *      encoding unambiguous by construction rather than by convention.
 */

import { sha256 } from '@noble/hashes/sha2.js';

/* ------------------------------------------------------------------ */

export interface Entitlement {
  /**
   * Position in the sorted set, starting at 0.
   *
   * IN THE LEAF because an on-chain distributor needs one bit per claimant to
   * prevent double claims, and the bit has to be unambiguous. If the index were
   * merely derived rather than proven, a claimant could present a valid proof
   * and set somebody ELSE's bit — a griefing move that costs the attacker
   * nothing and locks a stranger out permanently.
   *
   * Assigned by `buildTree`, never by the caller.
   */
  index: number;
  /** Identity that subscribed. Present for auditing; not what authorises a claim. */
  npub: string;
  /**
   * Where the payout goes, and what actually gates it.
   *
   * A Solana program can verify an ed25519 signature and cannot verify a Nostr
   * one, so the claim is authorised by THIS key. The npub is in the leaf so the
   * list can be reconciled against relays, not so it can sign anything.
   */
  solanaAddress: string;
  /** Base units — lamports or token decimals. Never a float, never a fraction. */
  amount: bigint;
}

export class MerkleError extends Error {
  constructor(msg: string) { super(msg); this.name = 'MerkleError'; }
}

const LEAF_PREFIX = 0x00;
const NODE_PREFIX = 0x01;

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => {
  if (!/^[0-9a-f]*$/.test(s) || s.length % 2) throw new MerkleError(`not hex: ${s.slice(0, 24)}`);
  return Uint8Array.from(s.match(/../g) ?? [], (b) => parseInt(b, 16));
};

/* ---------- canonical encoding ------------------------------------- */

const utf8 = new TextEncoder();

/** Big-endian u32. Length prefixes are fixed-width so they cannot be ambiguous either. */
function u32(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff_ffff) throw new MerkleError(`bad length ${n}`);
  return Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}

/** Big-endian u64. Amounts are bigint so a 53-bit float boundary cannot silently round one. */
function u64(v: bigint): Uint8Array {
  if (v < 0n || v > 0xffff_ffff_ffff_ffffn) throw new MerkleError(`amount ${v} out of range for u64`);
  const out = new Uint8Array(8);
  let x = v;
  for (let i = 7; i >= 0; i--) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
}

/**
 * Length-prefixed, so no two distinct entitlements can encode to the same bytes.
 *
 * The failure this prevents: with plain concatenation, ("npub1a", "Xyz") and
 * ("npub1", "aXyz") produce identical bytes, which means a valid proof for one
 * claimant is a valid proof for a leaf that was never in the tree.
 */
export function encodeLeaf(e: Entitlement): Uint8Array {
  const npub = utf8.encode(e.npub);
  const addr = utf8.encode(e.solanaAddress);
  const amount = u64(e.amount);

  const out = new Uint8Array(4 + 4 + npub.length + 4 + addr.length + 8);
  let o = 0;
  out.set(u32(e.index), o); o += 4;                    // fixed width, first
  out.set(u32(npub.length), o); o += 4;
  out.set(npub, o); o += npub.length;
  out.set(u32(addr.length), o); o += 4;
  out.set(addr, o); o += addr.length;
  out.set(amount, o);
  return out;
}

export function leafHash(e: Entitlement): string {
  const body = encodeLeaf(e);
  const buf = new Uint8Array(1 + body.length);
  buf[0] = LEAF_PREFIX;
  buf.set(body, 1);
  return hex(sha256(buf));
}

/**
 * Hash two children.
 *
 * Commutative — the pair is sorted before hashing — so a proof carries no
 * direction bits and cannot be replayed with the sides swapped. Safe here only
 * because of the prefix separation above: without it, commutative hashing is one
 * of the ways the second-preimage attack gets in.
 */
function nodeHash(a: string, b: string): string {
  const [l, r] = a <= b ? [a, b] : [b, a];
  const buf = new Uint8Array(1 + 32 + 32);
  buf[0] = NODE_PREFIX;
  buf.set(unhex(l), 1);
  buf.set(unhex(r), 33);
  return hex(sha256(buf));
}

/* ---------- the tree ----------------------------------------------- */

export interface Tree {
  root: string;
  /** Leaf hashes, in tree order. */
  leaves: string[];
  /** Every level, leaves first, root last. */
  layers: string[][];
  entries: Entitlement[];
  total: bigint;
}

/**
 * Build the tree.
 *
 * ENTRIES ARE SORTED BY npub HERE, not taken in the order given. Relays return
 * events in whatever order they feel like, and two honest parties fetching the
 * same set must produce the same root or the whole exercise is pointless. This
 * is the same reason `snapshotMembers()` sorts.
 */
export function buildTree(entries: readonly Entitlement[]): Tree {
  if (entries.length === 0) throw new MerkleError('cannot build a tree with no entitlements');

  const seenNpub = new Set<string>();
  for (const e of entries) {
    if (seenNpub.has(e.npub)) {
      // A duplicate npub is two leaves for one subscriber, which is one claim
      // too many. Refuse rather than deduplicate silently — silently is how a
      // double allocation becomes a double payout nobody noticed.
      throw new MerkleError(`duplicate npub in entitlements: ${e.npub}`);
    }
    seenNpub.add(e.npub);
    if (typeof e.amount !== 'bigint') throw new MerkleError(`amount for ${e.npub} is not a bigint`);
    if (e.amount < 0n) throw new MerkleError(`negative amount for ${e.npub}`);
  }

  // Index is assigned HERE, after sorting, so it is a property of the set rather
  // than of whatever order the caller happened to pass. A caller-supplied index
  // would be another self-asserted field, and this file already knows how that ends.
  const sorted = [...entries]
    .sort((a, b) => (a.npub < b.npub ? -1 : a.npub > b.npub ? 1 : 0))
    .map((e, index) => ({ ...e, index }));
  const leaves = sorted.map(leafHash);

  const layers: string[][] = [leaves];
  let level = leaves;
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      // An odd node is PROMOTED, never duplicated. Duplicating it lets a
      // different leaf set produce this same root — CVE-2012-2459.
      next.push(i + 1 < level.length ? nodeHash(level[i]!, level[i + 1]!) : level[i]!);
    }
    layers.push(next);
    level = next;
  }

  return {
    root: level[0]!,
    leaves,
    layers,
    entries: sorted,
    total: sorted.reduce((a, e) => a + e.amount, 0n),
  };
}

/** The sibling path for one entitlement. */
export function proofFor(tree: Tree, npub: string): string[] {
  const index = tree.entries.findIndex((e) => e.npub === npub);
  if (index < 0) throw new MerkleError(`${npub} is not in this tree`);

  const proof: string[] = [];
  let i = index;
  for (let l = 0; l < tree.layers.length - 1; l++) {
    const level = tree.layers[l]!;
    const sibling = i % 2 === 0 ? level[i + 1] : level[i - 1];
    if (sibling !== undefined) proof.push(sibling);       // undefined = promoted, no sibling
    i = Math.floor(i / 2);
  }
  return proof;
}

/**
 * Verify an entitlement against a root, using only public values.
 *
 * Takes the ENTITLEMENT rather than a leaf hash on purpose. Accepting a
 * pre-computed hash would let a caller hand in an internal node and — without
 * the prefix separation — have it verify. Recomputing here means the 0x00 prefix
 * is always applied and that class of forgery cannot be expressed.
 */
export function verifyProof(e: Entitlement, proof: readonly string[], root: string): boolean {
  let h: string;
  try { h = leafHash(e); } catch { return false; }
  for (const sibling of proof) {
    if (!/^[0-9a-f]{64}$/.test(sibling)) return false;
    h = nodeHash(h, sibling);
  }
  return h === root;
}

/* ---------- turning a snapshot into entitlements -------------------- */

export interface Distribution {
  entries: Entitlement[];
  root: string;
  /** Base units allocated. */
  allocated: bigint;
  /**
   * What integer division could not split.
   *
   * Left unallocated rather than pushed onto an arbitrary member. Handing the
   * remainder to "the first N by sort order" is deterministic and it is also a
   * silent decision that somebody gets more, so this reports it and leaves it in
   * the vault where anyone can see it.
   */
  dust: bigint;
}

/**
 * Split a pot equally across members, at base-unit precision.
 *
 * Equal shares because any other rule needs a justification, and a rule nobody
 * can restate is a rule nobody can audit.
 */
export function distributeEqually(
  members: readonly { npub: string; solanaAddress: string }[],
  totalBaseUnits: bigint,
): Distribution {
  if (members.length === 0) throw new MerkleError('no members to distribute to');
  if (totalBaseUnits < 0n) throw new MerkleError('total cannot be negative');

  const each = totalBaseUnits / BigInt(members.length);
  // index 0 is a placeholder — buildTree assigns the real one after sorting.
  const entries: Entitlement[] = members.map((m) => ({ ...m, index: 0, amount: each }));
  const tree = buildTree(entries);

  const allocated = each * BigInt(members.length);
  return { entries: tree.entries, root: tree.root, allocated, dust: totalBaseUnits - allocated };
}

/* ---------- reconciliation ------------------------------------------ */

export interface Reconciliation {
  matches: boolean;
  publishedRoot: string;
  computedRoot: string;
  /** In the published list but not derivable from relays. */
  extra: string[];
  /** On relays but missing from the published list. */
  omitted: string[];
  summary: string;
}

/**
 * Rebuild the root from what the relays actually say and diff it.
 *
 * This is the whole point. `matches: false` is not an accusation and the wording
 * does not make one — a root can differ because of a late subscription, a relay
 * that was down, or an omission. It reports the difference and names both sets so
 * a reader can see WHICH, rather than delivering a verdict the data cannot carry.
 */
export function reconcile(
  publishedRoot: string,
  publishedEntries: readonly Entitlement[],
  fromRelays: readonly { npub: string; solanaAddress: string }[],
  totalBaseUnits: bigint,
): Reconciliation {
  const recomputed = distributeEqually(
    [...fromRelays].sort((a, b) => (a.npub < b.npub ? -1 : a.npub > b.npub ? 1 : 0)),
    totalBaseUnits,
  );

  const pub = new Set(publishedEntries.map((e) => e.npub));
  const rel = new Set(fromRelays.map((m) => m.npub));

  const extra = [...pub].filter((n) => !rel.has(n)).sort();
  const omitted = [...rel].filter((n) => !pub.has(n)).sort();
  const matches = publishedRoot === recomputed.root;

  const summary = matches
    ? `The published root matches the one computed from ${fromRelays.length} subscription(s) on relays.`
    : `The published root does NOT match the one computed from relays. ` +
      `${omitted.length} subscriber(s) are on relays and absent from the published list; ` +
      `${extra.length} are in the published list and not on relays. ` +
      `That can be a late subscription or a relay that was down as easily as an omission — ` +
      `the difference is shown so a reader can tell which, rather than being told.`;

  return { matches, publishedRoot, computedRoot: recomputed.root, extra, omitted, summary };
}
