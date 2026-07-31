/**
 * Tier 2 — a NIP-46 remote signer ("bunker").
 *
 * The key lives on hardware the user controls and never enters the browser.
 * Every operation is a relay round-trip to a device that may be asleep, so this
 * is the tier that makes the async/approvable/failable shape of the SDK
 * non-negotiable rather than theoretical.
 *
 * The client secret here is NOT the identity key. It is an ephemeral key
 * identifying this app to the bunker, and it is generated fresh per session
 * unless the caller persists it deliberately.
 */

import { generateSecretKey, nip19 } from 'nostr-tools';
import { BunkerSigner, parseBunkerInput } from 'nostr-tools/nip46';
import { DEFAULT_RELAYS, publishEvent, queryRelays } from '../relay.js';
import { fetchProfile } from '../profile.js';
import { SignerUnavailableError, UserDeclinedError } from '../errors.js';
import type {
  ConnectOptions, EventTemplate, Session, SignedEvent, XnsbSdk,
} from '../types.js';

export interface Nip46Options {
  /** `bunker://…` URI, or a NIP-05 address the bunker publishes. */
  bunkerUri: string;
  relays?: string[];
  /** Persist across reloads to avoid re-approving. Generated if absent. */
  clientSecret?: Uint8Array;
  /** How long to wait for a sleeping phone before giving up. */
  timeoutMs?: number;
}

function normalise(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (/denied|declin|reject|cancel|refus/i.test(msg)) return new UserDeclinedError();
  if (/timeout|timed out/i.test(msg)) {
    return new SignerUnavailableError(
      'The remote signer did not answer. It may be asleep — wake the device and retry.',
    );
  }
  return e instanceof Error ? e : new Error(msg);
}

export function createNip46Signer(opts: Nip46Options): XnsbSdk {
  const relayList = opts.relays?.length ? [...opts.relays] : [...DEFAULT_RELAYS];
  const clientSecret = opts.clientSecret ?? generateSecretKey();

  let bunker: BunkerSigner | null = null;
  let current: Session | null = null;

  const need = (): BunkerSigner => {
    if (!bunker) throw new SignerUnavailableError('not connected — call connect() first');
    return bunker;
  };

  return {
    version: '0.1.0',
    backend: 'nip46',

    async connect(_o: ConnectOptions = {}) {
      const pointer = await parseBunkerInput(opts.bunkerUri);
      if (!pointer) throw new SignerUnavailableError(`could not parse bunker input: ${opts.bunkerUri}`);

      try {
        // fromBunker, not `new` — the constructor is private in nostr-tools v2.
        const b = BunkerSigner.fromBunker(clientSecret, pointer);
        await b.connect();
        bunker = b;
        const pubkeyHex = await b.getPublicKey();
        const p = await fetchProfile(pubkeyHex, relayList);
        current = {
          tier: 2,
          pubkeyHex,
          npub: nip19.npubEncode(pubkeyHex),
          displayName: p.displayName,
          picture: p.picture,
          binding: p.binding,
          custody: 'A remote signer you control holds the key. It never enters this browser.',
        };
        return current;
      } catch (e) {
        bunker = null;
        throw normalise(e);
      }
    },

    session: () => current,

    async disconnect() {
      try { await bunker?.close(); } catch { /* already gone */ }
      bunker = null;
      current = null;
    },

    async getPublicKey() {
      if (current) return current.pubkeyHex;
      return need().getPublicKey();
    },
    async getNpub() {
      if (current) return current.npub;
      return nip19.npubEncode(await need().getPublicKey());
    },

    async signEvent(t: EventTemplate): Promise<SignedEvent> {
      try { return await need().signEvent(t) as SignedEvent; }
      catch (e) { throw normalise(e); }
    },

    async encrypt(peer, plaintext) {
      try { return await need().nip44Encrypt(peer, plaintext); }
      catch (e) { throw normalise(e); }
    },
    async decrypt(peer, ciphertext) {
      try { return await need().nip44Decrypt(peer, ciphertext); }
      catch (e) { throw normalise(e); }
    },

    publish(event, r) { return publishEvent(event, r?.length ? r : relayList); },
    query(filters, r) { return queryRelays(filters, r?.length ? r : relayList); },
    relays: () => [...relayList],
  };
}
