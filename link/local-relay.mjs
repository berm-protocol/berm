/**
 * Minimal NIP-01 relay for end-to-end testing.
 *
 * It INDEPENDENTLY verifies every signature with nostr-tools and rejects
 * anything that fails, so an event landing here is a real proof rather than an
 * echo.
 *
 * Filter support covers the subset the tests actually exercise: ids, kinds,
 * authors, since/until, limit, and single-letter tag filters (#e, #p, #d, #i).
 * That last one matters — the identity lookup is built on `#i` queries, and a
 * relay that silently ignored unknown filter keys would return everything and
 * make a broken query look like a working one.
 */
import { WebSocketServer } from 'ws';
import { verifyEvent } from 'nostr-tools';

function matches(ev, filter) {
  if (filter.ids && !filter.ids.includes(ev.id)) return false;
  if (filter.kinds && !filter.kinds.includes(ev.kind)) return false;
  if (filter.authors && !filter.authors.includes(ev.pubkey)) return false;
  if (filter.since && ev.created_at < filter.since) return false;
  if (filter.until && ev.created_at > filter.until) return false;

  // #<single-letter> tag filters. An event matches when it carries at least one
  // tag of that name whose value is in the requested set.
  for (const [key, want] of Object.entries(filter)) {
    if (!key.startsWith('#') || key.length !== 2) continue;
    const name = key.slice(1);
    const have = ev.tags.filter((t) => t[0] === name).map((t) => t[1]);
    if (!have.some((v) => want.includes(v))) return false;
  }
  return true;
}

export function startRelay(port, name) {
  const store = new Map();
  const wss = new WebSocketServer({ port });

  wss.on('connection', (ws) => {
    ws.on('message', (buf) => {
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }

      if (msg[0] === 'EVENT') {
        const ev = msg[1];
        const ok = verifyEvent(ev);
        if (ok) store.set(ev.id, ev);
        console.log(`  [${name}] EVENT ${ev.id.slice(0, 12)}… kind=${ev.kind} sig=${ok ? 'VALID' : 'INVALID'} -> ${ok ? 'stored' : 'REJECTED'}`);
        ws.send(JSON.stringify(['OK', ev.id, ok, ok ? '' : 'invalid: signature verification failed']));
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
        console.log(`  [${name}] REQ  ${JSON.stringify(filters).slice(0, 70)} -> ${sent} event(s)`);
        ws.send(JSON.stringify(['EOSE', subId]));
      }
    });
  });

  // `events` is additive — existing callers use `count()` and are unaffected.
  // A verifier that can only ask "how many?" cannot assert what was actually
  // stored, and "two relays accepted something" is a much weaker claim than
  // "two relays accepted THIS event and verified its signature".
  return {
    close: () => wss.close(),
    count: () => store.size,
    events: () => [...store.values()],
  };
}
