/**
 * V1, V3, V4, V7 — the frozen baseline.
 *
 * These assert that the implementation still produces byte-identical output to
 * vectors/test-vectors.json. A failure here is never "update the fixture" —
 * it means every existing user's identity just changed.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bytesToHex } from '@noble/hashes/utils.js';
import { nip44 } from 'nostr-tools';

import { identityFromPrf, buildInfo } from '../src/derive.js';
import { eventId, serializeEvent, type UnsignedEvent } from '../src/event.js';
import {
  buildClaimTag,
  proofText,
  shareIntentUrl,
  resolveBindingState,
} from '../src/nip39.js';

const here = dirname(fileURLToPath(import.meta.url));
const V = JSON.parse(
  readFileSync(resolve(here, '..', 'vectors', 'test-vectors.json'), 'utf8'),
);

const hexToBytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));

describe('V1 — derivation stability (frozen)', () => {
  for (const c of V.V1_derivation_stability.cases) {
    it(c.label, () => {
      const id = identityFromPrf(hexToBytes(c.prfOutHex), hexToBytes(c.credentialIdHex));
      expect(bytesToHex(id.secretKey)).toBe(c.secretKeyHex);
      expect(id.pubkeyHex).toBe(c.pubkeyHex);
      expect(id.npub).toBe(c.npub);
      expect(id.attempt).toBe(c.attempt);
      if (c.nsec) expect(id.nsec).toBe(c.nsec);
      if (c.infoHex) {
        expect(bytesToHex(buildInfo(hexToBytes(c.credentialIdHex), 0))).toBe(c.infoHex);
      }
    });
  }

  it('distinct PRF outputs yield distinct identities', () => {
    const [a, b] = V.V1_derivation_stability.cases;
    expect(a.pubkeyHex).not.toBe(b.pubkeyHex);
  });

  it('distinct credential ids yield distinct identities (domain separation via info)', () => {
    const [a, , c] = V.V1_derivation_stability.cases;
    expect(a.pubkeyHex).not.toBe(c.pubkeyHex);
  });

  it('derivation is pure — repeated calls are byte-identical', () => {
    const c = V.V1_derivation_stability.cases[0];
    const one = identityFromPrf(hexToBytes(c.prfOutHex), hexToBytes(c.credentialIdHex));
    const two = identityFromPrf(hexToBytes(c.prfOutHex), hexToBytes(c.credentialIdHex));
    expect(bytesToHex(one.secretKey)).toBe(bytesToHex(two.secretKey));
  });
});

describe('V3 — NIP-01 canonical serialization and event id (frozen)', () => {
  const ev = V.V3_event_id.event as UnsignedEvent;

  it('serializes to the frozen canonical string', () => {
    expect(serializeEvent(ev)).toBe(V.V3_event_id.serialized);
  });

  it('computes the frozen event id', () => {
    expect(eventId(ev)).toBe(V.V3_event_id.id);
  });

  it('serialization is the NIP-01 six-element array in fixed order', () => {
    const parsed = JSON.parse(serializeEvent(ev));
    expect(parsed).toHaveLength(6);
    expect(parsed[0]).toBe(0);
    expect(parsed[1]).toBe(ev.pubkey);
    expect(parsed[2]).toBe(ev.created_at);
    expect(parsed[3]).toBe(ev.kind);
  });

  it('kind 0 content is a JSON string, not an object', () => {
    expect(typeof ev.content).toBe('string');
    expect(() => JSON.parse(ev.content)).not.toThrow();
  });

  it('any tag mutation changes the id', () => {
    const mutated: UnsignedEvent = {
      ...ev,
      tags: [...ev.tags, ['i', 'github:someone-else', 'deadbeef']],
    };
    expect(eventId(mutated)).not.toBe(V.V3_event_id.id);
  });
});

describe('V4 — NIP-44 v2', () => {
  it('matches the official cross-implementation conversation-key vectors', () => {
    for (const v of V.V4_nip44.officialConversationKeys) {
      const got = bytesToHex(nip44.v2.utils.getConversationKey(hexToBytes(v.sec1), v.pub2));
      expect(got).toBe(v.conversation_key);
    }
  });

  it('self-encryption conversation key is frozen', () => {
    const c = V.V1_derivation_stability.cases[0];
    const id = identityFromPrf(hexToBytes(c.prfOutHex), hexToBytes(c.credentialIdHex));
    const key = nip44.v2.utils.getConversationKey(id.secretKey, id.pubkeyHex);
    expect(bytesToHex(key)).toBe(V.V4_nip44.selfEncryption.conversationKeyHex);
  });

  it('round-trips kind 30078 app state', () => {
    const c = V.V1_derivation_stability.cases[0];
    const id = identityFromPrf(hexToBytes(c.prfOutHex), hexToBytes(c.credentialIdHex));
    const key = nip44.v2.utils.getConversationKey(id.secretKey, id.pubkeyHex);
    const pt = V.V4_nip44.selfEncryption.plaintext;
    const ct = nip44.v2.encrypt(pt, key);
    expect(ct).not.toContain('theme');            // no plaintext leakage
    expect(nip44.v2.decrypt(ct, key)).toBe(pt);
  });

  it('ciphertext is non-deterministic (fresh nonce per encryption)', () => {
    const c = V.V1_derivation_stability.cases[0];
    const id = identityFromPrf(hexToBytes(c.prfOutHex), hexToBytes(c.credentialIdHex));
    const key = nip44.v2.utils.getConversationKey(id.secretKey, id.pubkeyHex);
    expect(nip44.v2.encrypt('same', key)).not.toBe(nip44.v2.encrypt('same', key));
  });

  it('rejects a tampered ciphertext (payload is authenticated)', () => {
    const c = V.V1_derivation_stability.cases[0];
    const id = identityFromPrf(hexToBytes(c.prfOutHex), hexToBytes(c.credentialIdHex));
    const key = nip44.v2.utils.getConversationKey(id.secretKey, id.pubkeyHex);
    const ct = nip44.v2.encrypt('sensitive app state', key);
    const bad = ct.slice(0, -4) + (ct.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
    expect(() => nip44.v2.decrypt(bad, key)).toThrow();
  });

  it('padding hides exact plaintext length', () => {
    const c = V.V1_derivation_stability.cases[0];
    const id = identityFromPrf(hexToBytes(c.prfOutHex), hexToBytes(c.credentialIdHex));
    const key = nip44.v2.utils.getConversationKey(id.secretKey, id.pubkeyHex);
    expect(nip44.v2.encrypt('a', key).length).toBe(nip44.v2.encrypt('abcdefgh', key).length);
  });
});

describe('V7 — NIP-39 binding (frozen)', () => {
  it('produces the frozen proof text and share intent', () => {
    expect(proofText(V.V7_nip39_binding.npub)).toBe(V.V7_nip39_binding.proofText);
    expect(shareIntentUrl(V.V7_nip39_binding.npub)).toBe(V.V7_nip39_binding.shareIntentUrl);
  });

  it('builds the frozen claim tag', () => {
    expect(
      buildClaimTag({
        platform: 'twitter',
        identity: 'dorian_handle',
        proof: '1789456123456789012',
      }),
    ).toEqual(V.V7_nip39_binding.claimTag);
  });

  for (const s of V.V7_nip39_binding.states) {
    it(`claim=${s.claim} live=${s.liveHandle} -> ${s.expected}`, () => {
      const claim = s.claim
        ? { platform: 'twitter' as const, identity: s.claim, proof: '1' }
        : undefined;
      expect(resolveBindingState(claim, s.liveHandle ?? undefined)).toBe(s.expected);
    });
  }

  it('NEVER reports verified without a live handle', () => {
    const claim = { platform: 'twitter' as const, identity: 'dorian_handle', proof: '1' };
    expect(resolveBindingState(claim, undefined)).not.toBe('verified');
  });
});
