/**
 * The four privacy claims, as assertions.
 *
 * Everything else in this project has a command attached; a privacy guarantee
 * should not be the exception. These are the claims we would put in front of a
 * data-sovereignty organisation, written so they can run them.
 *
 *   1. Importing an archive needs no network at all.
 *   2. The published follow list is ciphertext and leaks no member.
 *   3. Two readers receive byte-identical article pages.
 *   4. The import origin's CSP forbids every outbound connection.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { generateSecretKey, getPublicKey, nip19, nip44 } from 'nostr-tools';

import { parseFollowing, parseAccount, parseMentionMap, ForbiddenFileError, ArchiveParseError } from '../src/archive.js';
import { matchFollowing, expectedUniformMatches, type ClaimantIndex } from '../src/claimants.js';
import {
  buildPrivateFollowSet, readPrivateFollowSet, mergePublicContacts,
  describeGraphEvent, GRAPH_D_TAG, KIND_FOLLOW_SET,
} from '../src/list.js';
import { socialProof, describeSocialProof, type EmbeddedReactions } from '../src/widget.js';
import { importCsp, auditCsp } from '../src/csp.js';
import { renderArticle } from '../node-render.mjs';

/* ---------- fixtures ---------- */

const alice = generateSecretKey();
const alicePub = getPublicKey(alice);

function claimant(uid: string, verified = true) {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  return { uid, pubkey, npub: nip19.npubEncode(pubkey), handle: `user${uid}`, verified };
}

const C1 = claimant('1000000001');
const C2 = claimant('1000000002');
const C3 = claimant('1000000003', false);   // claimed, not verified

const INDEX: ClaimantIndex = {
  v: 1, generated_at: 1785000000, claimants: [C1, C2, C3],
};

const FOLLOWING_JS = `window.YTD.following.part0 = ${JSON.stringify([
  { following: { accountId: '1000000001', userLink: 'https://twitter.com/intent/user?user_id=1000000001' } },
  { following: { accountId: '1000000002', userLink: '' } },
  { following: { accountId: '1000000003', userLink: '' } },
  { following: { accountId: '9999999999', userLink: '' } },
  { following: { accountId: 'not-an-id', userLink: '' } },
])}`;

/** NIP-44 to self, standing in for the signer. Local crypto, no network. */
const selfEncrypt = async (peer: string, plain: string) =>
  nip44.v2.encrypt(plain, nip44.v2.utils.getConversationKey(alice, peer));
const selfDecrypt = async (peer: string, ct: string) =>
  nip44.v2.decrypt(ct, nip44.v2.utils.getConversationKey(alice, peer));

/* ================================================================== */
/* CLAIM 1 — importing needs no network                                */
/* ================================================================== */

describe('claim 1: the archive never leaves the device', () => {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  // `navigator` is getter-only in Node, so plain assignment throws — which is
  // itself worth knowing: a naive "disable the network" stub silently fails to
  // cover sendBeacon, the one API designed to survive page unload.
  const NET = ['fetch', 'WebSocket', 'XMLHttpRequest', 'EventSource', 'navigator'];

  const poison = new Proxy(function () {} as object, {
    get(_t, prop) { throw new Error(`network is disabled (touched ${String(prop)})`); },
    apply() { throw new Error('network is disabled'); },
    construct() { throw new Error('network is disabled'); },
  });

  function cutTheWires() {
    for (const k of NET) {
      saved.set(k, Object.getOwnPropertyDescriptor(globalThis, k));
      Object.defineProperty(globalThis, k, { value: poison, configurable: true, writable: true });
    }
  }

  afterEach(() => {
    for (const [k, desc] of saved) {
      if (desc) Object.defineProperty(globalThis, k, desc);
      else delete (globalThis as Record<string, unknown>)[k];
    }
    saved.clear();
  });

  it('parses, matches and builds the list with every network API poisoned', async () => {
    cutTheWires();

    const { uids, skipped } = parseFollowing(FOLLOWING_JS);
    expect(uids).toHaveLength(4);
    expect(skipped).toBe(1);

    const result = matchFollowing(uids, INDEX);
    expect(result.matched.map((m) => m.uid).sort()).toEqual(['1000000001', '1000000002']);

    const event = await buildPrivateFollowSet(result.matched, {
      selfPubkey: alicePub, encrypt: selfEncrypt, now: 1785000001,
    });
    expect(event.kind).toBe(KIND_FOLLOW_SET);
    expect(event.content.length).toBeGreaterThan(0);
  });

  it('the parser never evaluates the file', () => {
    // If this were eval'd, the assignment would run and the marker would appear.
    (globalThis as Record<string, unknown>).__pwned = false;
    const hostile = 'window.YTD.following.part0 = (globalThis.__pwned = true, [])';
    expect(() => parseFollowing(hostile)).toThrow(ArchiveParseError);
    expect((globalThis as Record<string, unknown>).__pwned).toBe(false);
    delete (globalThis as Record<string, unknown>).__pwned;
  });

  it('refuses direct messages by name, before parsing', () => {
    for (const name of ['direct-messages.js', 'direct_messages_group.js', 'DM-inbox.js']) {
      expect(() => parseFollowing('window.YTD.x = []', name)).toThrow(ForbiddenFileError);
    }
  });
});

/* ================================================================== */
/* CLAIM 2 — the published list is ciphertext                          */
/* ================================================================== */

describe('claim 2: the follow list leaks no member', () => {
  it('publishes no p tag and no pubkey in plaintext', async () => {
    const { matched } = matchFollowing(parseFollowing(FOLLOWING_JS).uids, INDEX);
    const event = await buildPrivateFollowSet(matched, {
      selfPubkey: alicePub, encrypt: selfEncrypt, now: 1785000001,
    });

    // Public tags carry the addressable d tag and nothing identifying.
    expect(event.tags.some((t) => t[0] === 'p')).toBe(false);
    expect(event.tags.find((t) => t[0] === 'd')?.[1]).toBe(GRAPH_D_TAG);

    // Nothing about a member survives anywhere a relay can read it.
    const wire = JSON.stringify(event);
    for (const m of matched) {
      expect(wire).not.toContain(m.pubkey);
      expect(wire).not.toContain(m.npub);
      expect(wire).not.toContain(m.handle);
      expect(wire).not.toContain(m.uid);
    }
  });

  it('round-trips for the owner', async () => {
    const { matched } = matchFollowing(parseFollowing(FOLLOWING_JS).uids, INDEX);
    const event = await buildPrivateFollowSet(matched, { selfPubkey: alicePub, encrypt: selfEncrypt });
    const back = await readPrivateFollowSet(event, alicePub, selfDecrypt);
    expect(back.sort()).toEqual(matched.map((m) => m.pubkey).sort());
  });

  it('is unreadable by anyone else', async () => {
    const { matched } = matchFollowing(parseFollowing(FOLLOWING_JS).uids, INDEX);
    const event = await buildPrivateFollowSet(matched, { selfPubkey: alicePub, encrypt: selfEncrypt });

    const mallory = generateSecretKey();
    const wrong = async (peer: string, ct: string) =>
      nip44.v2.decrypt(ct, nip44.v2.utils.getConversationKey(mallory, peer));

    await expect(readPrivateFollowSet(event, alicePub, wrong)).rejects.toThrow();
  });

  it('names the consequence differently for private and public', async () => {
    const { matched } = matchFollowing(parseFollowing(FOLLOWING_JS).uids, INDEX);
    const priv = await buildPrivateFollowSet(matched, { selfPubkey: alicePub, encrypt: selfEncrypt });
    const pub = mergePublicContacts([], matched);

    expect(describeGraphEvent(priv)).toMatch(/private.*only you/i);
    // The private prompt must never contain a publishing verb at all — a user
    // skimming two similar sentences will act on the first familiar word.
    expect(describeGraphEvent(priv)).not.toMatch(/\bpublish(ed|es|ing)?\b/i);
    expect(describeGraphEvent(pub.event, { added: pub.added.length, kept: 0 }))
      .toMatch(/PUBLISH.*permanently/);
  });
});

/* ================================================================== */
/* CLAIM 3 — every reader gets identical bytes                         */
/* ================================================================== */

describe('claim 3: the node cannot personalise', () => {
  const article = {
    address: '30023:abcd:on-sovereignty',
    title: 'On Sovereignty',
    html: '<p>Body.</p>',
    author: 'abcd',
  };
  const reactions: EmbeddedReactions = {
    address: article.address,
    fetched_at: 1785000000,
    events: [
      { id: 'b'.repeat(64), pubkey: C1.pubkey, kind: 7, content: '+', created_at: 1785000000 },
      { id: 'a'.repeat(64), pubkey: C2.pubkey, kind: 1111, content: 'good', created_at: 1785000001 },
    ],
  };

  it('renderArticle takes no reader argument at all', () => {
    // The structural guarantee. If someone adds a third parameter to
    // personalise the page, this fails and the reviewer has to justify it.
    expect(renderArticle.length).toBe(2);
  });

  it('is byte-identical across calls, and stable against relay ordering', () => {
    const a = renderArticle(article, reactions);
    const b = renderArticle(article, { ...reactions, events: [...reactions.events].reverse() });
    expect(a).toBe(b);
  });

  it('embeds the public set without marking anyone as followed', () => {
    const html = renderArticle(article, reactions);
    expect(html).toContain(C1.pubkey);
    expect(html).toContain(C2.pubkey);

    // Comments explain the design and are not served content; what matters is
    // that nothing in the MARKUP or the payload records a follow relationship.
    const served = html.replace(/<!--[\s\S]*?-->/g, '');
    expect(served).not.toMatch(/follow/i);
    expect(served).not.toMatch(/data-(followed|reader|viewer|session)/i);
  });

  it('computes the proof locally, from the embedded set only', () => {
    const follows = new Set([C1.pubkey]);
    const proof = socialProof(reactions, follows);
    expect(proof.total).toBe(1);
    expect(proof.reacted).toEqual([C1.pubkey]);
    expect(proof.commented).toEqual([]);

    // Two readers, same page, different results — computed client-side.
    const other = socialProof(reactions, new Set([C1.pubkey, C2.pubkey]));
    expect(other.total).toBe(2);
  });

  it('renders nothing rather than a zero', () => {
    expect(describeSocialProof(socialProof(reactions, new Set()))).toBeNull();
    expect(describeSocialProof(socialProof(reactions, new Set([C1.pubkey])),
      new Map([[C1.pubkey, 'dorian']]))).toMatch(/@dorian/);
  });
});

/* ================================================================== */
/* CLAIM 4 — the browser enforces it, not us                           */
/* ================================================================== */

describe('claim 4: CSP forbids every outbound connection', () => {
  it('the default policy is connect-src none and audits clean', () => {
    const policy = importCsp();
    expect(policy).toContain("connect-src 'none'");
    const audit = auditCsp(policy);
    expect(audit.problems).toEqual([]);
    expect(audit.ok).toBe(true);
  });

  it('catches the ways a policy gets widened in practice', () => {
    const bad = [
      ["default-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; connect-src *", /wildcard/],
      ["default-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; connect-src https:", /bare scheme/],
      ["default-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; connect-src wss://*.example.com", /wildcard/],
      ["default-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'", /no connect-src/],
      ["default-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none'; script-src 'unsafe-eval'", /unsafe-eval/],
    ] as const;

    for (const [policy, expected] of bad) {
      const audit = auditCsp(policy);
      expect(audit.ok, policy).toBe(false);
      expect(audit.problems.join(' '), policy).toMatch(expected);
    }
  });

  it('an explicit relay allowlist is still exact-origin', () => {
    const audit = auditCsp(importCsp({ relays: ['wss://relay.damus.io', 'wss://nos.lol'] }));
    expect(audit.ok).toBe(true);
  });
});

/* ================================================================== */
/* Matching discipline                                                 */
/* ================================================================== */

describe('matching refuses what it cannot verify', () => {
  it('excludes an unverified claim', () => {
    const r = matchFollowing(parseFollowing(FOLLOWING_JS).uids, INDEX);
    expect(r.rejectedUnverified).toBe(1);
    expect(r.matched.some((m) => m.uid === C3.uid)).toBe(false);
  });

  it('refuses BOTH entries when two verified claims contest one account', () => {
    // Two people claiming the same X account is a dispute, not a tie-break.
    // Picking either silently would auto-follow an impersonator.
    const rival = { ...claimant('1000000001'), verified: true };
    const contested: ClaimantIndex = { v: 1, generated_at: 0, claimants: [C1, rival] };
    const r = matchFollowing(['1000000001'], contested);
    expect(r.matched).toEqual([]);
    expect(r.rejectedUnverified).toBe(1);
  });

  it('separates people already followed from genuinely new ones', () => {
    const r = matchFollowing(parseFollowing(FOLLOWING_JS).uids, INDEX, new Set([C1.pubkey]));
    expect(r.alreadyFollowed.map((m) => m.uid)).toEqual(['1000000001']);
    expect(r.matched.map((m) => m.uid)).toEqual(['1000000002']);
  });

  it('a public merge never removes anyone', () => {
    const existing = [['p', 'ff'.repeat(32), '', 'oldfriend']];
    const { matched } = matchFollowing(parseFollowing(FOLLOWING_JS).uids, INDEX);
    const merged = mergePublicContacts(existing, matched);

    expect(merged.removed).toEqual([]);
    expect(merged.event.tags.some((t) => t[1] === 'ff'.repeat(32))).toBe(true);
    expect(merged.added).toHaveLength(2);
  });

  it('tells the user why the result is empty', () => {
    // 500 follows, 1000 claimants, 500M accounts → below one. The cold start is
    // arithmetic, not a bug, and the UI has to be able to say so.
    expect(expectedUniformMatches(500, 1000)).toBeLessThan(1);
    expect(expectedUniformMatches(500, 50_000_000)).toBeGreaterThan(1);
  });
});

describe('archive extras', () => {
  it('reads the importer’s own account', () => {
    const js = `window.YTD.account.part0 = ${JSON.stringify([
      { account: { accountId: '42', username: 'dorian', email: 'x@y.z' } },
    ])}`;
    expect(parseAccount(js)).toEqual({ uid: '42', username: 'dorian' });
  });

  it('builds a partial id→handle map from mentions', () => {
    const js = `window.YTD.tweets.part0 = ${JSON.stringify([
      { tweet: { entities: { user_mentions: [{ id_str: '77', screen_name: 'someone' }] } } },
    ])}`;
    expect(parseMentionMap(js).get('77')).toBe('someone');
  });

  it('returns an empty map rather than throwing on a junk tweets file', () => {
    expect(parseMentionMap('not an archive file').size).toBe(0);
  });
});

describe('the direct-message guard cannot be routed around', () => {
  it('rejects at intake, independent of any parser', async () => {
    const { assertReadable } = await import('../src/archive.js');
    // The bug this covers: the guard used to live only inside the parsers, so a
    // filename the router did not recognise reached a "not used" branch and was
    // never checked. Intake is now the choke point.
    for (const name of ['direct-messages.js', 'DMs-part1.js', 'my-inbox-backup.js']) {
      expect(() => assertReadable(name), name).toThrow(ForbiddenFileError);
    }
    for (const ok of ['following.js', 'account.js', 'tweets.js']) {
      expect(() => assertReadable(ok), ok).not.toThrow();
    }
  });
});
