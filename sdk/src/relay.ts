/**
 * Relay transport. Shared by every backend, because *where the key lives* and
 * *where the data goes* are independent choices and the SDK should not pretend
 * otherwise. A NIP-07 user and a passkey user publish through identical code.
 */

import { verifyEvent } from 'nostr-tools';
import type { PublishReceipt, SignedEvent } from './types.js';

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

const PUBLISH_TIMEOUT_MS = 12_000;
const QUERY_TIMEOUT_MS = 8_000;

type WsCtor = new (url: string) => WebSocket;
let wsImpl: WsCtor | null = null;

/**
 * Browsers have WebSocket. Node has it globally from 22, and not before, so
 * fall back to `ws` — resolved lazily so browser bundles never pull it in.
 */
export async function webSocketImpl(): Promise<WsCtor> {
  if (wsImpl) return wsImpl;
  const g = (globalThis as { WebSocket?: WsCtor }).WebSocket;
  if (g) return (wsImpl = g);
  const mod = (await import(/* @vite-ignore */ 'ws')) as { default?: unknown };
  return (wsImpl = (mod.default ?? mod) as WsCtor);
}

/** For tests and for Node 20. */
export function useWebSocketImplementation(impl: WsCtor): void { wsImpl = impl; }

/**
 * Publish to every relay in parallel and report per-relay outcomes.
 *
 * Deliberately never throws on partial failure. Publishing is not atomic and an
 * API that pretends it is forces apps to guess; the receipt says exactly what
 * happened at each operator so the app can decide.
 */
export async function publishEvent(
  event: SignedEvent,
  targets: string[],
): Promise<PublishReceipt> {
  const WS = await webSocketImpl();
  const accepted: string[] = [];
  const failed: { relay: string; reason: string }[] = [];

  await Promise.all(targets.map((url) => new Promise<void>((resolve) => {
    let ws: WebSocket | undefined;
    let settled = false;
    const settle = (ok: boolean, reason = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (ok) accepted.push(url); else failed.push({ relay: url, reason });
      try { ws?.close(); } catch { /* already gone */ }
      resolve();
    };
    const timer = setTimeout(() => settle(false, 'timeout'), PUBLISH_TIMEOUT_MS);

    try { ws = new WS(url); } catch { return settle(false, 'blocked'); }

    ws.onopen = () => ws!.send(JSON.stringify(['EVENT', event]));
    ws.onmessage = (m: MessageEvent) => {
      try {
        const d = JSON.parse(String(m.data));
        if (d[0] === 'OK' && d[1] === event.id) settle(Boolean(d[2]), d[3] || 'rejected');
      } catch { /* malformed relay frame */ }
    };
    ws.onerror = () => settle(false, 'unreachable');
    ws.onclose = () => settle(false, 'closed before OK');
  })));

  return {
    eventId: event.id,
    accepted,
    failed,
    // Berm v2 §4.4. One relay is not published.
    success: accepted.length >= 2,
  };
}

/**
 * Query relays, verify every signature, deduplicate by event id.
 *
 * Signature checking happens HERE rather than in the caller, because a relay is
 * an untrusted party that can return anything it likes. An SDK that hands back
 * unverified events has quietly made every consuming app responsible for a step
 * most of them will forget.
 */
export async function queryRelays(
  filters: unknown[],
  targets: string[],
): Promise<SignedEvent[]> {
  const WS = await webSocketImpl();
  const out = new Map<string, SignedEvent>();
  const sub = 'berm-' + Math.random().toString(36).slice(2, 10);

  await Promise.all(targets.map((url) => new Promise<void>((resolve) => {
    let ws: WebSocket | undefined;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws?.close(); } catch { /* already gone */ }
      resolve();
    };
    const timer = setTimeout(done, QUERY_TIMEOUT_MS);

    try { ws = new WS(url); } catch { return done(); }

    ws.onopen = () => ws!.send(JSON.stringify(['REQ', sub, ...filters]));
    ws.onmessage = (m: MessageEvent) => {
      try {
        const d = JSON.parse(String(m.data));
        if (d[0] === 'EVENT' && d[2] && verifyEvent(d[2])) out.set(d[2].id, d[2]);
        if (d[0] === 'EOSE' || d[0] === 'CLOSED') done();
      } catch { /* malformed relay frame */ }
    };
    ws.onerror = done;
    ws.onclose = done;
  })));

  return [...out.values()];
}
