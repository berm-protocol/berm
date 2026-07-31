/**
 * Tier 0 — a NIP-07 browser extension (Alby, nos2x, Nostore, …).
 *
 * The user already made a custody decision before meeting us. We touch none of
 * it: no key is created, none is stored, and disconnecting leaves nothing
 * behind. This is the tier with the least product surface and the most respect
 * for the user, and it is the reason `connect()` prefers it when present.
 */

import { nip19 } from 'nostr-tools';
import { DEFAULT_RELAYS, publishEvent, queryRelays } from '../relay.js';
import { fetchProfile } from '../profile.js';
import { SignerUnavailableError, UserDeclinedError } from '../errors.js';
import type {
  ConnectOptions, EventTemplate, PublishReceipt, Session, SignedEvent, XnsbSdk,
} from '../types.js';

interface Nip07 {
  getPublicKey(): Promise<string>;
  signEvent(e: EventTemplate): Promise<SignedEvent>;
  getRelays?(): Promise<Record<string, { read: boolean; write: boolean }>>;
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
}

export function hasNip07(): boolean {
  return typeof globalThis === 'object'
    && typeof (globalThis as { nostr?: unknown }).nostr === 'object'
    && (globalThis as { nostr?: Nip07 }).nostr !== null;
}

function ext(): Nip07 {
  const n = (globalThis as { nostr?: Nip07 }).nostr;
  if (!n) throw new SignerUnavailableError('no NIP-07 extension on this page');
  return n;
}

/**
 * Extensions signal a declined prompt by rejecting, but the message is theirs
 * and differs across implementations. Normalise it so apps can branch on a
 * type rather than on somebody's copywriting.
 */
function normalise(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (/denied|declin|reject|cancel|refus/i.test(msg)) return new UserDeclinedError();
  return e instanceof Error ? e : new Error(msg);
}

export function createNip07Signer(relays?: string[]): XnsbSdk {
  let relayList = relays?.length ? [...relays] : [...DEFAULT_RELAYS];
  let current: Session | null = null;

  const need = (): Session => {
    if (!current) throw new SignerUnavailableError('not connected — call connect() first');
    return current;
  };

  return {
    version: '0.1.0',
    backend: 'nip07',

    async connect(_opts: ConnectOptions = {}) {
      let pubkeyHex: string;
      try { pubkeyHex = await ext().getPublicKey(); }
      catch (e) { throw normalise(e); }

      // The user's own NIP-65 list beats our defaults. Publishing to relays the
      // user does not read is a very quiet way to lose their data.
      if (!relays?.length) {
        try {
          const declared = await ext().getRelays?.();
          const writable = Object.entries(declared ?? {})
            .filter(([, v]) => v.write).map(([url]) => url);
          if (writable.length) relayList = writable;
        } catch { /* getRelays is optional in NIP-07 */ }
      }

      const p = await fetchProfile(pubkeyHex, relayList);
      current = {
        tier: 0,
        pubkeyHex,
        npub: nip19.npubEncode(pubkeyHex),
        displayName: p.displayName,
        picture: p.picture,
        binding: p.binding,
        custody: 'Your browser extension holds the key. Berm never sees it.',
      };
      return current;
    },

    session: () => current,
    async disconnect() { current = null; },

    async getPublicKey() { return need().pubkeyHex; },
    async getNpub() { return need().npub; },

    async signEvent(t: EventTemplate): Promise<SignedEvent> {
      need();
      try { return await ext().signEvent(t); }
      catch (e) { throw normalise(e); }
    },

    async encrypt(peer, plaintext) {
      need();
      const n44 = ext().nip44;
      if (!n44) {
        // NIP-04 is prohibited repo-wide, so there is no fallback to offer.
        // Failing loudly beats silently encrypting with a broken scheme.
        throw new SignerUnavailableError(
          'This extension does not support NIP-44. Update it, or use the Berm signer.',
        );
      }
      try { return await n44.encrypt(peer, plaintext); }
      catch (e) { throw normalise(e); }
    },

    async decrypt(peer, ciphertext) {
      need();
      const n44 = ext().nip44;
      if (!n44) throw new SignerUnavailableError('This extension does not support NIP-44.');
      try { return await n44.decrypt(peer, ciphertext); }
      catch (e) { throw normalise(e); }
    },

    publish(event: SignedEvent, r?: string[]): Promise<PublishReceipt> {
      return publishEvent(event, r?.length ? r : relayList);
    },
    query(filters, r) { return queryRelays(filters, r?.length ? r : relayList); },
    relays: () => [...relayList],
  };
}
