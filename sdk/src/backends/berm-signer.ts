/**
 * Tier 1 — the Berm passkey signer.
 *
 * STATUS: the client half is complete and is what you are reading. The signer
 * *origin* it talks to is not yet deployed, so `detect()` returns false unless
 * you configure one explicitly. That is deliberate — a tier that auto-selects
 * and then fails is worse than one that says it is not ready.
 *
 * WHY A SEPARATE ORIGIN. WebAuthn credentials are bound to an RP ID, which is
 * derived from the origin. If every app could invoke the passkey, every app
 * would be a phishing surface. So the key exists at exactly one origin, apps
 * reach it through a popup, and the postMessage handshake below checks
 * `event.origin` on every single message — the one check whose absence turns
 * this design from a security boundary into decoration.
 *
 * The key never crosses the boundary. Only signatures do.
 */

import { nip19 } from 'nostr-tools';
import { DEFAULT_RELAYS, publishEvent, queryRelays } from '../relay.js';
import { fetchProfile } from '../profile.js';
import { SignerUnavailableError, UserDeclinedError } from '../errors.js';
import type {
  ConnectOptions, EventTemplate, Session, SignedEvent, XnsbSdk,
} from '../types.js';

export interface XnsbSignerOptions {
  /** e.g. `https://signer.xonly.ai`. No trailing slash. */
  signerOrigin: string;
  relays?: string[];
  appName?: string;
  timeoutMs?: number;
}

type Rpc = 'connect' | 'getPublicKey' | 'signEvent' | 'nip44Encrypt' | 'nip44Decrypt';

interface Pending { resolve(v: unknown): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }

/** True only when a signer origin was configured. See STATUS above. */
export function hasXnsbSigner(opts?: Partial<XnsbSignerOptions>): boolean {
  return Boolean(opts?.signerOrigin);
}

export function createXnsbSigner(opts: XnsbSignerOptions): XnsbSdk {
  const origin = opts.signerOrigin.replace(/\/+$/, '');
  const relayList = opts.relays?.length ? [...opts.relays] : [...DEFAULT_RELAYS];
  const timeout = opts.timeoutMs ?? 120_000;   // a human has to touch a key

  let popup: Window | null = null;
  let current: Session | null = null;
  let seq = 0;
  const pending = new Map<string, Pending>();
  let listening = false;

  function listen(): void {
    if (listening) return;
    listening = true;
    globalThis.addEventListener?.('message', (ev: MessageEvent) => {
      // THE check. Without it any page could answer for the signer.
      if (ev.origin !== origin) return;
      const d = ev.data as { id?: string; ok?: boolean; result?: unknown; error?: string };
      if (!d?.id) return;
      const p = pending.get(d.id);
      if (!p) return;
      pending.delete(d.id);
      clearTimeout(p.timer);
      if (d.ok) p.resolve(d.result);
      else p.reject(/declin|denied|cancel/i.test(d.error ?? '')
        ? new UserDeclinedError()
        : new SignerUnavailableError(d.error ?? 'signer error'));
    });
  }

  function call<T>(method: Rpc, params: unknown = {}): Promise<T> {
    listen();
    if (!popup || popup.closed) {
      throw new SignerUnavailableError('signer window is not open — call connect() first');
    }
    const id = `${++seq}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new SignerUnavailableError(`signer did not answer ${method} within ${timeout}ms`));
      }, timeout);
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      popup!.postMessage({ id, method, params, app: opts.appName }, origin);
    });
  }

  const need = (): Session => {
    if (!current) throw new SignerUnavailableError('not connected — call connect() first');
    return current;
  };

  return {
    version: '0.1.0',
    backend: 'berm-signer',

    async connect(_o: ConnectOptions = {}) {
      const open = (globalThis as { open?: typeof window.open }).open;
      if (!open) throw new SignerUnavailableError('no window.open — tier 1 needs a browser');

      popup = open(`${origin}/connect`, 'berm-signer', 'width=420,height=620');
      if (!popup) {
        // Popup blockers fire when the call is not inside a user gesture. Say
        // that, because "signer unavailable" sends developers hunting for hours.
        throw new SignerUnavailableError(
          'The signer window was blocked. Call connect() directly from a click handler.',
        );
      }

      const pubkeyHex = await call<string>('connect', { app: opts.appName });
      const p = await fetchProfile(pubkeyHex, relayList);
      current = {
        tier: 1,
        pubkeyHex,
        npub: nip19.npubEncode(pubkeyHex),
        displayName: p.displayName,
        picture: p.picture,
        binding: p.binding,
        custody: `Your passkey holds the key at ${origin}. It never enters this page.`,
      };
      return current;
    },

    session: () => current,

    async disconnect() {
      try { popup?.close(); } catch { /* already closed */ }
      popup = null;
      current = null;
      for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new SignerUnavailableError('disconnected')); }
      pending.clear();
    },

    async getPublicKey() { return need().pubkeyHex; },
    async getNpub() { return need().npub; },

    signEvent(t: EventTemplate) { need(); return call<SignedEvent>('signEvent', t); },
    encrypt(peer, plaintext) { need(); return call<string>('nip44Encrypt', { peer, plaintext }); },
    decrypt(peer, ciphertext) { need(); return call<string>('nip44Decrypt', { peer, ciphertext }); },

    publish(event, r) { return publishEvent(event, r?.length ? r : relayList); },
    query(filters, r) { return queryRelays(filters, r?.length ? r : relayList); },
    relays: () => [...relayList],
  };
}
