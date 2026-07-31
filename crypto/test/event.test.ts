/**
 * §4 conformance guards — the rules that stop independently built mini-apps
 * from corrupting each other's state or spamming the public network.
 */

import { describe, it, expect } from 'vitest';
import { assertConformantDTag, assertCommentKind, KIND, eventId } from '../src/event.js';
import { buildClaimTag, parseClaimTags, proofTextMatches, proofText } from '../src/nip39.js';

describe('kind register (§4.1)', () => {
  it('pins the event kinds the spec depends on', () => {
    expect(KIND.METADATA).toBe(0);
    expect(KIND.DELETION).toBe(5);
    expect(KIND.GIFT_WRAP).toBe(1059);
    expect(KIND.COMMENT).toBe(1111);
    expect(KIND.RELAY_LIST).toBe(10002);
    expect(KIND.FOLLOW_SET).toBe(30000);
    expect(KIND.LONG_FORM).toBe(30023);
    expect(KIND.APP_DATA).toBe(30078);
  });

  it('rejects kind 1 for comments with an explanatory error', () => {
    expect(() => assertCommentKind(1)).toThrow(/NIP-22/);
    expect(() => assertCommentKind(1)).toThrow(/spams global feeds/);
  });

  it('accepts kind 1111', () => {
    expect(() => assertCommentKind(1111)).not.toThrow();
  });

  it('does not use the deprecated NIP-51 generic list kind 30001', () => {
    expect(Object.values(KIND)).not.toContain(30001);
  });
});

describe('addressable `d` tag namespacing (§4.3)', () => {
  it('accepts conformant namespaces', () => {
    for (const d of ['berm:settings:v2', 'berm:wp-shop:v1', 'berm:payout:v1', 'berm:a:b:v10']) {
      expect(() => assertConformantDTag([['d', d]])).not.toThrow();
    }
  });

  it('rejects an unnamespaced tag that would collide across mini-apps', () => {
    for (const d of ['settings', 'my-app', 'berm-settings', 'Berm:settings:v1', 'berm:settings']) {
      expect(() => assertConformantDTag([['d', d]])).toThrow();
    }
  });

  it('rejects a missing `d` tag', () => {
    expect(() => assertConformantDTag([['e', 'abc']])).toThrow(/missing a `d` tag/);
  });
});

describe('NIP-39 claim parsing', () => {
  it('round-trips a built tag', () => {
    const tag = buildClaimTag({ platform: 'twitter', identity: 'alice', proof: '123' });
    const [claim] = parseClaimTags([tag]);
    expect(claim).toEqual({ platform: 'twitter', identity: 'alice', proof: '123' });
  });

  it('refuses to build a claim with no proof — an unprovable claim is decoration', () => {
    expect(() =>
      buildClaimTag({ platform: 'twitter', identity: 'alice', proof: '' }),
    ).toThrow(/not a binding/);
  });

  it('refuses an identity containing the platform separator', () => {
    expect(() =>
      buildClaimTag({ platform: 'twitter', identity: 'ali:ce', proof: '1' }),
    ).toThrow();
  });

  it('drops malformed tags from untrusted events instead of throwing', () => {
    const tags = [
      ['i'],
      ['i', 'twitter'],
      ['i', 'twitter:'],
      ['i', ':alice', '1'],
      ['i', 'twitter:alice'],
      ['i', 'twitter:alice', '999'],
      ['p', 'not-an-i-tag', 'x'],
    ];
    expect(parseClaimTags(tags)).toEqual([
      { platform: 'twitter', identity: 'alice', proof: '999' },
    ]);
  });
});

describe('NIP-39 proof text matching', () => {
  const npub = 'npub1dxwfgy5wda3530mwhuatfh94yl6ty635znmkendp9pdjhlgr7c9qm5fe94';

  it('matches the exact NIP-39 text', () => {
    expect(proofTextMatches(proofText(npub), npub)).toBe(true);
  });

  it('matches when the proof is embedded in a longer post', () => {
    expect(proofTextMatches(`gm everyone. ${proofText(npub)} — see you there`, npub)).toBe(true);
  });

  it('does NOT match a post that merely mentions the npub', () => {
    expect(proofTextMatches(`check out ${npub}, great account`, npub)).toBe(false);
  });

  it('does NOT match a proof for a different npub', () => {
    const other = 'npub1zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';
    expect(proofTextMatches(proofText(other), npub)).toBe(false);
  });

  it('does NOT match if the quotes are dropped', () => {
    expect(
      proofTextMatches(`Verifying my account on nostr My Public Key: ${npub}`, npub),
    ).toBe(false);
  });
});

describe('event id determinism', () => {
  const base = { pubkey: 'aa'.repeat(32), created_at: 1785000000, kind: 1111, tags: [], content: 'hi' };

  it('is stable across calls', () => {
    expect(eventId(base)).toBe(eventId(base));
  });

  it('changes with content', () => {
    expect(eventId(base)).not.toBe(eventId({ ...base, content: 'hi ' }));
  });

  it('changes with created_at', () => {
    expect(eventId(base)).not.toBe(eventId({ ...base, created_at: base.created_at + 1 }));
  });

  it('changes with kind', () => {
    expect(eventId(base)).not.toBe(eventId({ ...base, kind: 1 }));
  });

  it('is 32 bytes of hex', () => {
    expect(eventId(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});
