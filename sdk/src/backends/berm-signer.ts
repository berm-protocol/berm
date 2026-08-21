/**
 * Tier 1 — the Berm signer at its own origin.
 *
 * STATUS: the client half is what you are reading, and it now speaks the wire
 * format in `spec/signer-broker.md` rather than the ad-hoc one it shipped with.
 * The signer page lives in `signer/`.
 *
 * `detect()` still returns false unless a signer origin is configured
 * EXPLICITLY, and that stays true until the origin actually serves the app
 * rather than a placeholder. A tier that auto-selects and then fails is worse
 * than one that says it is not ready, and defaulting the origin the day the
 * host exists — but before the page is on it — would make detection lie.
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
  /** Registered-client key. Buys a display name at the signer, never permission. */
  appKey?: string;
  /** How long to wait for the popup to answer `ping` before giving up. */
  readyTimeoutMs?: number;
}

/**
 * Method names are NIP-46's, per the spec: "so that a developer writes one
 * integration that works against Amber, nsec.app, a self-hosted bunker, or us.
 * We are a transport, not a new vocabulary."
 *
 * nip04_* is absent deliberately and permanently.
 */
type Rpc =
  | 'connect' | 'ping' | 'get_public_key' | 'sign_event'
  | 'nip44_encrypt' | 'nip44_decrypt' | 'get_relays';

const PROTOCOL = 'signer/1';

/** Typed at the wire, so a refusal is never confused with a failure. */
type ErrorCode = 'declined' | 'no_session' | 'unsupported_method' | 'rejected_origin' | 'timeout' | 'malformed';

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
      const d = ev.data as { berm?: string; id?: string; result?: unknown; error?: { code?: ErrorCode; message?: string } };
      if (d?.berm !== PROTOCOL || typeof d.id !== 'string') return;
      const p = pending.get(d.id);
      if (!p) return;
      pending.delete(d.id);
      clearTimeout(p.timer);
      if (d.error) {
        // A typed code, not a regex over prose. "The user said no" and
        // "something broke" deserve different interfaces, and conflating them is
        // how "try again" loops get built on top of a refusal.
        p.reject(d.error.code === 'declined'
          ? new UserDeclinedError()
          : new SignerUnavailableError(`${d.error.code ?? 'error'}${d.error.message ? `: ${d.error.message}` : ''}`));
      } else p.resolve(d.result);
    });
  }

  function call<T>(method: Rpc, params: Record<string, unknown> | undefined, human: string, ms = timeout): Promise<T> {
    listen();
    if (!popup || popup.closed) {
      throw new SignerUnavailableError('signer window is not open — call connect() first');
    }
    const id = `${++seq}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new SignerUnavailableError(`signer did not answer ${method} within ${ms}ms`));
      }, ms);
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      // `human` is required by the protocol and is what the user reads. The
      // signer shows the raw event beside it either way, so a lie here is
      // visible rather than useful.
      popup!.postMessage({ berm: PROTOCOL, id, method, params, human, appKey: opts.appKey }, origin);
    });
  }

  /**
   * The signer deliberately does not announce readiness: at that moment it does
   * not know our origin, and announcing would require `targetOrigin: '*'` —
   * broadcasting to whatever page happens to be there. So we poll instead. The
   * cost is a few hundred milliseconds; the alternative is a wildcard.
   */
  async function waitReady(): Promise<void> {
    const deadline = Date.now() + (opts.readyTimeoutMs ?? 30_000);
    while (Date.now() < deadline) {
      if (!popup || popup.closed) throw new SignerUnavailableError('the signer window was closed');
      try {
        if (await call<string>('ping', undefined, 'Checking the signer is awake', 1500) === 'pong') return;
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
    backend: 'berm-signer',

    async connect(_o: ConnectOptions = {}) {
      const open = (globalThis as { open?: typeof window.open }).open;
      if (!open) throw new SignerUnavailableError('no window.open — tier 1 needs a browser');

      popup = open(`${origin}/`, 'berm-signer', 'width=460,height=720');
      if (!popup) {
        // Popup blockers fire when the call is not inside a user gesture. Say
        // that, because "signer unavailable" sends developers hunting for hours.
        throw new SignerUnavailableError(
          'The signer window was blocked. Call connect() directly from a click handler.',
        );
      }

      await waitReady();
      const r = await call<{ pubkey: string; npub?: string }>(
        'connect', undefined, `${opts.appName ?? 'This application'} wants to know who you are`,
      );
      const pubkeyHex = r.pubkey;
      const p = await fetchProfile(pubkeyHex, relayList);
      current = {
        tier: 1,
        pubkeyHex,
        npub: nip19.npubEncode(pubkeyHex),
        displayName: p.displayName,
        picture: p.picture,
        binding: p.binding,
        custody: `Your key is held at ${origin} for this session and never enters this page.`,
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

    signEvent(t: EventTemplate) { need(); return call<SignedEvent>('sign_event', { event: t }, describe(t)); },
    encrypt(peer, plaintext) { need(); return call<string>('nip44_encrypt', { peer, plaintext }, 'Encrypt a message to someone'); },
    decrypt(peer, ciphertext) { need(); return call<string>('nip44_decrypt', { peer, ciphertext }, 'Read a message sent to you'); },

    publish(event, r) { return publishEvent(event, r?.length ? r : relayList); },
    query(filters, r) { return queryRelays(filters, r?.length ? r : relayList); },
    relays: () => [...relayList],
  };
}

/**
 * The `human` sentence the signer shows. It has to say what the event actually
 * does — the raw event is displayed beside it regardless, so an inaccurate line
 * is simply caught by the person reading both.
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
