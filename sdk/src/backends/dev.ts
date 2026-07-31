/**
 * Development signer. NOT A CUSTODY TIER.
 *
 * It holds a raw key in localStorage, which is exactly the thing this whole
 * project exists to stop doing. It is here because building against a fast,
 * always-approving local key produces an app that breaks on the day a real
 * signer arrives — so this one deliberately reproduces the *annoying* parts of
 * a remote signer:
 *
 *   - artificial latency, so the UI must handle a slow signature
 *   - an approval prompt, so the UI must handle a decline
 *   - real failure modes, so the UI must handle them
 *
 * Making development slightly annoying in the same shape production will be
 * annoying is the entire point.
 *
 * THE ORIGIN GUARD: it refuses to be constructed anywhere but localhost, a
 * file:// page, or Node. Not a warning — a thrown error. Every "dev mode" that
 * merely warns eventually ships, and this one leaks a private key when it does.
 */

import {
  finalizeEvent, generateSecretKey, getPublicKey, nip19, nip44, verifyEvent,
} from 'nostr-tools';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { DEFAULT_RELAYS, publishEvent, queryRelays } from '../relay.js';
import { fetchProfile } from '../profile.js';
import { DevSignerMisuseError, SignerUnavailableError, UserDeclinedError } from '../errors.js';
import type {
  ConnectOptions, EventTemplate, Session, SignedEvent, XnsbSdk,
} from '../types.js';

const STORAGE_KEY = 'berm_dev_secret';

export interface DevSignerOptions {
  relays?: string[];
  /** Simulated signer round-trip, ms. Production NIP-46 is comparable. */
  latencyMs?: number;
  /** Ask for approval on each signature, the way a bunker does. */
  requireApproval?: boolean;
  /** Return false to simulate a decline. */
  approve?: (summary: string) => Promise<boolean>;
  displayName?: string;
  handle?: string;
  /**
   * Look the profile up on relays. Off by default: a freshly generated dev key
   * has never published a kind 0, so the lookup is guaranteed to find nothing
   * and costs a full relay timeout to discover that.
   */
  fetchProfile?: boolean;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

/** Exported so an app can decide whether to *offer* dev mode at all. */
export function isLocalOrigin(): boolean {
  const loc = (globalThis as { location?: Location }).location;
  if (!loc) return true;                       // Node: tests and CLI tooling
  if (loc.protocol === 'file:') return true;   // single-file demo builds
  return LOCAL_HOSTS.has(loc.hostname) || loc.hostname.endsWith('.localhost');
}

export function createDevSigner(opts: DevSignerOptions = {}): XnsbSdk {
  if (!isLocalOrigin()) {
    throw new DevSignerMisuseError((globalThis as { location?: Location }).location?.origin ?? '?');
  }

  const relayList = opts.relays?.length ? [...opts.relays] : [...DEFAULT_RELAYS];
  const latency = opts.latencyMs ?? 450;
  const wantApproval = opts.requireApproval ?? true;

  let sk: Uint8Array | null = null;
  let current: Session | null = null;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  function store(): Storage | null {
    try { return (globalThis as { localStorage?: Storage }).localStorage ?? null; }
    catch { return null; }   // Safari in private mode throws on access
  }

  function loadKey(): Uint8Array {
    if (sk) return sk;
    const saved = store()?.getItem(STORAGE_KEY);
    sk = saved ? hexToBytes(saved) : generateSecretKey();
    if (!saved) store()?.setItem(STORAGE_KEY, bytesToHex(sk));
    return sk;
  }

  const need = (): Session => {
    if (!current) throw new SignerUnavailableError('not connected — call connect() first');
    return current;
  };

  return {
    version: '0.1.0',
    backend: 'dev',

    async connect(_o: ConnectOptions = {}) {
      await sleep(latency);
      const key = loadKey();
      const pubkeyHex = getPublicKey(key);
      const npub = nip19.npubEncode(pubkeyHex);

      const handle = opts.handle ?? store()?.getItem('berm_dev_handle') ?? undefined;
      const p = opts.fetchProfile ? await fetchProfile(pubkeyHex, relayList) : null;

      current = {
        tier: 1,
        pubkeyHex,
        npub,
        displayName: opts.displayName ?? p?.displayName ?? 'You',
        picture: p?.picture,
        // No live check can happen in dev, so this can never be 'verified'.
        // Being strict here is what stops a demo screenshot becoming a claim.
        binding: handle ? { state: 'claimed', handle } : (p?.binding ?? { state: 'unlinked' }),
        custody: 'DEVELOPMENT SIGNER — a raw key in localStorage. Never ship this.',
      };
      return current;
    },

    session: () => current,
    async disconnect() { await sleep(80); current = null; },

    async getPublicKey() { return need().pubkeyHex; },
    async getNpub() { return need().npub; },

    async signEvent(t: EventTemplate): Promise<SignedEvent> {
      need();
      if (wantApproval && opts.approve) {
        if (!(await opts.approve(describeForApproval(t)))) throw new UserDeclinedError();
      }
      await sleep(latency);
      const ev = finalizeEvent(
        { kind: t.kind, created_at: t.created_at, tags: t.tags, content: t.content },
        loadKey(),
      ) as SignedEvent;

      // Never hand back an event we have not verified ourselves.
      if (!verifyEvent(ev)) throw new Error('signer produced an invalid signature');
      return ev;
    },

    async encrypt(peer, plaintext) {
      need();
      await sleep(latency / 2);
      return nip44.v2.encrypt(plaintext, nip44.v2.utils.getConversationKey(loadKey(), peer));
    },
    async decrypt(peer, ciphertext) {
      need();
      await sleep(latency / 2);
      return nip44.v2.decrypt(ciphertext, nip44.v2.utils.getConversationKey(loadKey(), peer));
    },

    publish(event, r) { return publishEvent(event, r?.length ? r : relayList); },
    query(filters, r) { return queryRelays(filters, r?.length ? r : relayList); },
    relays: () => [...relayList],
  };
}

/**
 * What the approval dialog shows.
 *
 * A signer that says "sign this?" without saying what "this" is has trained the
 * user to click yes. Exported because tier-1 and tier-2 UIs need the same
 * strings, and because an app adding a new kind should be able to add a line
 * here rather than inventing its own vocabulary.
 */
export function describeForApproval(t: EventTemplate): string {
  const title = t.tags.find((x) => x[0] === 'title')?.[1];
  const d = t.tags.find((x) => x[0] === 'd')?.[1];
  const claim = t.tags.find((x) => x[0] === 'i')?.[1];
  const guardians = t.tags.filter((x) => x[0] === 'guardian').length;
  const threshold = t.tags.find((x) => x[0] === 'threshold')?.[1];
  const at = (c: string) => c.replace(/^(twitter|x):/i, '@');

  switch (t.kind) {
    case 30023: return `Publish long-form article${title ? `: “${title}”` : ''}`;
    case 30024: return `Save a private draft${title ? `: “${title}”` : ''}`;
    case 1: return `Publish a note: “${t.content.slice(0, 60)}${t.content.length > 60 ? '…' : ''}”`;
    case 1111: return 'Publish a comment';
    case 0:
      return claim ? `Update your public profile and claim ${at(claim)}` : 'Update your public profile';
    case 10002: return 'Update your published relay list';
    case 30078:
      // A prompt that says "sign a kind 30078 event" has told the user nothing.
      // Name the actual consequence.
      if (d === 'berm:identity:v1') {
        return `Publish an identity attestation${claim ? ` linking ${at(claim)}` : ''}`;
      }
      if (d === 'berm:archive:v1') return 'Publish an archive attestation';
      if (d === 'berm:recovery:v1') {
        // Public and permanent: it names the people who can vouch for a
        // replacement key. "Save application data" would hide that.
        return guardians
          ? `Publish your recovery guardians — ${guardians} named publicly, ` +
            `${threshold ?? guardians} needed to vouch for a new key`
          : 'Publish your recovery pre-commitment';
      }
      return `Save application data${d ? ` (${d})` : ''}`;
    default: return `Sign a kind ${t.kind} event`;
  }
}
