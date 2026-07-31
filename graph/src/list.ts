/**
 * The follow list, built private by default.
 *
 * THE DEFAULT MATTERS MORE THAN THE FEATURE. A kind 3 contact list (NIP-02) is
 * public, permanent and plaintext, so "import my X follows" published as kind 3
 * republishes a slice of the user's X social graph to open relays forever. That
 * is not a leak — it is what kind 3 IS — but nobody clicking an import button is
 * thinking it, and letting them discover it later is the whole story someone
 * writes about us.
 *
 * So the default is a NIP-51 follow set (kind 30000) whose entries live in
 * NIP-44-encrypted `content`. The relay stores ciphertext. The widget still
 * works, because decryption happens in the reader's browser.
 *
 * Publishing publicly stays available and stays a separate, explicit choice.
 */

import type { Match } from './claimants.js';

export const GRAPH_D_TAG = 'berm:graph:v1';

/** NIP-51 follow set. Private entries are encrypted into `content`. */
export const KIND_FOLLOW_SET = 30000;
/** NIP-02 contact list. Public, plaintext, replaceable. */
export const KIND_CONTACTS = 3;

export interface EventTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

/** Supplied by the signer. Never takes a raw key — this module cannot see one. */
export type EncryptFn = (peerPubkey: string, plaintext: string) => Promise<string>;

export interface BuildOptions {
  /** The user's own pubkey — NIP-44 to self. */
  selfPubkey: string;
  encrypt: EncryptFn;
  now?: number;
}

/**
 * Build the private follow set.
 *
 * The public `tags` carry the `d` tag and nothing else. Every `p` tag goes into
 * the encrypted payload — a "private" list that leaked its members through
 * public tags would be worse than an honest public one, because the user would
 * believe they were protected.
 */
export async function buildPrivateFollowSet(
  matches: readonly Match[],
  opts: BuildOptions,
): Promise<EventTemplate> {
  const privateTags = matches.map((m) => ['p', m.pubkey, '', m.handle]);
  const ciphertext = await opts.encrypt(opts.selfPubkey, JSON.stringify(privateTags));

  return {
    kind: KIND_FOLLOW_SET,
    created_at: opts.now ?? Math.floor(Date.now() / 1000),
    tags: [
      ['d', GRAPH_D_TAG],
      ['title', 'Imported from X'],
    ],
    content: ciphertext,
  };
}

export type DecryptFn = (peerPubkey: string, ciphertext: string) => Promise<string>;

/** Read a private follow set back. Returns pubkeys only — the handle is a label
 *  and must never be treated as identity. */
export async function readPrivateFollowSet(
  event: { tags: string[][]; content: string },
  selfPubkey: string,
  decrypt: DecryptFn,
): Promise<string[]> {
  if (!event.content) return [];
  const raw = await decrypt(selfPubkey, event.content);
  let tags: unknown;
  try { tags = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((t): t is string[] => Array.isArray(t) && t[0] === 'p' && typeof t[1] === 'string')
    .map((t) => t[1]!);
}

export interface MergeResult {
  event: EventTemplate;
  added: string[];
  kept: string[];
  /** Always empty. Present so the approval prompt can state it. */
  removed: string[];
}

/**
 * Build a PUBLIC kind 3 by merging into whatever the user already had.
 *
 * Kind 3 is replaceable, so a naive publish REPLACES the existing contact list —
 * silently destroying the Nostr graph of exactly the sophisticated early adopter
 * you least want to annoy. This merges, reports a diff, and never removes.
 */
export function mergePublicContacts(
  existing: readonly string[][],
  matches: readonly Match[],
  now = Math.floor(Date.now() / 1000),
): MergeResult {
  const kept = existing.filter((t) => t[0] === 'p' && typeof t[1] === 'string');
  const have = new Set(kept.map((t) => t[1]!));

  const added: string[] = [];
  const tags = [...kept];
  for (const m of matches) {
    if (have.has(m.pubkey)) continue;
    have.add(m.pubkey);
    tags.push(['p', m.pubkey, '', m.handle]);
    added.push(m.pubkey);
  }

  return {
    event: { kind: KIND_CONTACTS, created_at: now, tags, content: '' },
    added,
    kept: kept.map((t) => t[1]!),
    removed: [],
  };
}

/**
 * The approval prompt for these events.
 *
 * The private and public cases must read as obviously different, because they
 * ARE obviously different and the user is about to make that choice once.
 */
export function describeGraphEvent(t: EventTemplate, counts?: { added: number; kept: number }): string {
  const d = t.tags.find((x) => x[0] === 'd')?.[1];

  if (t.kind === KIND_FOLLOW_SET && d === GRAPH_D_TAG) {
    // Deliberately contains no publishing verb. A user skimming two similar
    // sentences acts on the first familiar word, and these two choices are not
    // similar at all.
    return 'Save a private follow list — encrypted so only you can read it. ' +
           'Relays store ciphertext; nobody else can see who you follow.';
  }
  if (t.kind === KIND_CONTACTS) {
    const p = t.tags.filter((x) => x[0] === 'p').length;
    const detail = counts ? `${counts.added} new, ${counts.kept} kept, 0 removed` : `${p} people`;
    return `PUBLISH your follow list publicly and permanently — ${detail}. ` +
           'Anyone will be able to see who you follow.';
  }
  return `Sign a kind ${t.kind} event`;
}
