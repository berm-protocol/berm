/**
 * Minimal NIP-01 relay for SDK tests.
 *
 * It INDEPENDENTLY verifies every signature and rejects anything that fails, so
 * an event landing here is a real proof rather than an echo of what we sent.
 *
 * `evil` mode makes it return an event whose signature does not match — that is
 * the only way to prove queryRelays actually checks, rather than trusting the
 * happy path where every relay is honest.
 */
import { WebSocketServer } from 'ws';
import { verifyEvent } from 'nostr-tools';

function matches(ev, filter) {
  if (filter.ids && !filter.ids.includes(ev.id)) return false;
  if (filter.kinds && !filter.kinds.includes(ev.kind)) return false;
  if (filter.authors && !filter.authors.includes(ev.pubkey)) return false;
  if (filter.since && ev.created_at < filter.since) return false;
  if (filter.until && ev.created_at > filter.until) return false;
  for (const [key, want] of Object.entries(filter)) {
    if (!key.startsWith('#') || key.length !== 2) continue;
    const have = ev.tags.filter((t) => t[0] === key.slice(1)).map((t) => t[1]);
    if (!have.some((v) => want.includes(v))) return false;
  }
  return true;
}

/**
 * @param {number} port
 * @param {{reject?: boolean, evil?: object, silent?: boolean}} opts
 *   reject — accept the connection but answer OK=false (a relay that is up and
 *            refusing, which is different from one that is down)
 *   evil   — an extra event injected into every REQ response, signature or not
 */
export function startRelay(port, opts = {}) {
  const store = new Map();
  const wss = new WebSocketServer({ port });
  const log = [];

  wss.on('connection', (ws) => {
    ws.on('message', (buf) => {
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }

      if (msg[0] === 'EVENT') {
        const ev = msg[1];
        const valid = verifyEvent(ev);
        const ok = valid && !opts.reject;
        if (ok) store.set(ev.id, ev);
        log.push({ type: 'EVENT', id: ev.id, valid, ok });
        ws.send(JSON.stringify(['OK', ev.id, ok,
          !valid ? 'invalid: signature verification failed' : ok ? '' : 'blocked: relay is refusing writes']));
        return;
      }

      if (msg[0] === 'REQ') {
        const [, subId, ...filters] = msg;
        let sent = 0;
        const limit = Math.min(...filters.map((f) => f.limit ?? Infinity));
        for (const ev of store.values()) {
          if (!filters.some((f) => matches(ev, f))) continue;
          if (sent >= limit) break;
          ws.send(JSON.stringify(['EVENT', subId, ev]));
          sent++;
        }
        if (opts.evil) ws.send(JSON.stringify(['EVENT', subId, opts.evil]));
        log.push({ type: 'REQ', filters, sent });
        ws.send(JSON.stringify(['EOSE', subId]));
      }
    });
  });

  return {
    url: `ws://127.0.0.1:${port}`,
    close: () => new Promise((r) => wss.close(r)),
    count: () => store.size,
    log: () => log,
    has: (id) => store.has(id),
  };
}

/** Wait until the server is actually accepting, so tests never race the port. */
export async function ready(relay) {
  const { WebSocket } = await import('ws');
  for (let i = 0; i < 50; i++) {
    const ok = await new Promise((res) => {
      const ws = new WebSocket(relay.url);
      ws.on('open', () => { ws.close(); res(true); });
      ws.on('error', () => res(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`relay at ${relay.url} never came up`);
}
