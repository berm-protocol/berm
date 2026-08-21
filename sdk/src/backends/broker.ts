/**
 * Tier 1 client — talks to the signer origin over `signer/1`.
 *
 * The client half of `spec/signer-broker.md`. It opens a TOP-LEVEL POPUP, not an
 * iframe: an iframe sits inside this page, so this page could cover it, shrink it
 * to a sliver, or wrap it in convincing chrome. A popup shows the browser's own
 * address bar reading `signer.xonly.ai`, and that address is the entire
 * anti-phishing story.
 *
 * Popups need a user gesture. `connect()` must therefore be called from a click
 * handler. That is a real constraint on callers and it is written into the API
 * rather than worked around.
 *
 * This file never sees a secret key, and there is no code path by which it could.
 */

import type { XnsbSdk, Session, EventTemplate, SignedEvent, ConnectOptions } from '../types.js';
import { UserDeclinedError, SignerUnavailableError } from '../errors.js';
import { DEFAULT_RELAYS, publishEvent, queryRelays } from '../relay.js';
import { npubEncode } from 'nostr-tools/nip19';

export const PROTOCOL = 'signer/1';
export const DEFAULT_SIGNER_ORIGIN = 'https://signer.xonly.ai';

export interface BrokerOptions {
  signerOrigin?: string;
  relays?: string[];
  appName?: string;
  /** Registered-client key. Buys a display name at the signer. Never permission. */
  appKey?: string;
  /** How long to wait for the popup to come up before giving up. */
  readyTimeoutMs?: number;
  /** How long to wait for a human to answer an approval. */
  requestTimeoutMs?: number;
}

interface Pending { resolve: (v: unknown) => void; reject: (e: Error) => void; }

let seq = 0;
const rid = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function createBrokerSigner(opts: BrokerOptions = {}): XnsbSdk {
  const signerOrigin = (opts.signerOrigin ?? DEFAULT_SIGNER_ORIGIN).replace(/\/$/, '');
  const relayList = opts.relays?.length ? [...opts.relays] : [...DEFAULT_RELAYS];
  const readyTimeout = opts.readyTimeoutMs ?? 30_000;
  const requestTimeout = opts.requestTimeoutMs ?? 180_000;   // a human is reading

  let popup: Window | null = null;
  let current: Session | null = null;
  const pending = new Map<string, Pending>();

  function onMessage(ev: MessageEvent): void {
    if (ev.origin !== signerOrigin) return;              // browser-set; unforgeable
    const d = ev.data as { berm?: string; id?: string; result?: unknown; error?: { code: string; message?: string } };
    if (!d || d.berm !== PROTOCOL || typeof d.id !== 'string') return;
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    if (d.error) {
      p.reject(d.error.code === 'declined'
        ? new UserDeclinedError()
        : new SignerUnavailableError(`${d.error.code}${d.error.message ? `: ${d.error.message}` : ''}`));
    } else p.resolve(d.result);
  }
  window.addEventListener('message', onMessage);

  function send(method: string, params: Record<string, unknown> | undefined, human: string, timeoutMs: number): Promise<unknown> {
    if (!popup || popup.closed) return Promise.reject(new SignerUnavailableError('the signer window is not open'));
    const id = rid();
    const msg = { berm: PROTOCOL, id, method, params, human, appKey: opts.appKey };
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      // Explicit targetOrigin, every time. Never '*'.
      popup!.postMessage(msg, signerOrigin);
      setTimeout(() => {
        if (pending.delete(id)) reject(new SignerUnavailableError('timeout — the signer did not answer'));
      }, timeoutMs);
    });
  }

  /**
   * The signer deliberately does not announce readiness — it cannot know our
   * origin yet, and announcing would require targetOrigin '*'. So we poll.
   */
  async function waitReady(): Promise<void> {
    const deadline = Date.now() + readyTimeout;
    while (Date.now() < deadline) {
      if (!popup || popup.closed) throw new SignerUnavailableError('the signer window was closed');
      try {
        const pong = await send('ping', undefined, 'Checking the signer is awake', 1500);
        if (pong === 'pong') return;
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 350));
    }
    throw new SignerUnavailableError('the signer did not come up');
  }

  const need = (): Session => {
    if (!current) throw new SignerUnavailableError('not connected — call connect() first');
    return current;
  };

  return {
    version: '0.1.0',
    backend: 'broker',

    async connect(_o?: ConnectOptions): Promise<Session> {
      // MUST be called from a click handler, or the browser blocks this.
      popup = window.open(`${signerOrigin}/`, 'xonly-signer', 'width=460,height=720,noopener=no');
      if (!popup) throw new SignerUnavailableError('the browser blocked the signer window — allow popups for this site');
      await waitReady();
      const r = (await send('connect', undefined, `${opts.appName ?? 'This application'} wants to know who you are`, requestTimeout)) as { pubkey: string; npub?: string };
      current = {
        tier: 1,
        pubkeyHex: r.pubkey,
        npub: r.npub ?? npubEncode(r.pubkey),
        displayName: '',
        binding: { state: 'unlinked' },
        custody: 'Your key is held at signer.xonly.ai for this session only, and never leaves it. This page has never seen it.',
      };
      return current;
    },

    session() { return current; },

    async disconnect() {
      current = null;
      pending.clear();
      try { popup?.close(); } catch { /* already gone */ }
      popup = null;
    },

    async getPublicKey() { return need().pubkeyHex; },
    async getNpub() { return need().npub; },

    async signEvent(template: EventTemplate): Promise<SignedEvent> {
      need();
      const human = describe(template);
      return (await send('sign_event', { event: template }, human, requestTimeout)) as SignedEvent;
    },

    // NIP-44 is not implemented at the signer in this build. Failing loudly beats
    // a stub that returns something plausible.
    async encrypt() { throw new SignerUnavailableError('nip44_encrypt is not available in this build'); },
    async decrypt() { throw new SignerUnavailableError('nip44_decrypt is not available in this build'); },

    publish(event, r) { return publishEvent(event, r?.length ? r : relayList); },
    query(filters, r) { return queryRelays(filters, r?.length ? r : relayList); },
    relays() { return [...relayList]; },
  };
}

/**
 * The `human` sentence. Required by the protocol, and it has to actually say
 * what the event does — the signer shows the raw event alongside it either way,
 * so a lie here is visible rather than useful.
 */
function describe(t: EventTemplate): string {
  const title = t.tags?.find((x) => x[0] === 'title')?.[1];
  switch (t.kind) {
    case 0:     return 'Update your public profile';
    case 1:     return 'Publish a short note under your name';
    case 3:     return 'Update who you follow';
    case 30023: return title ? `Publish the article “${title}” under your name` : 'Publish a long-form article under your name';
    case 10002: return 'Update your published relay list';
    default:    return `Sign a kind ${t.kind} event under your name`;
  }
}
