/**
 * Minimal NIP-01 relay for end-to-end testing.
 * It INDEPENDENTLY verifies every signature with nostr-tools and rejects
 * anything that fails — so a browser publish landing here is a real proof,
 * not an echo.
 */
import { WebSocketServer } from 'ws';
import { verifyEvent } from 'nostr-tools';

export function startRelay(port, name) {
  const store = new Map();
  const wss = new WebSocketServer({ port });
  wss.on('connection', (ws) => {
    ws.on('message', (buf) => {
      let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
      if (msg[0] === 'EVENT') {
        const ev = msg[1];
        const ok = verifyEvent(ev);
        if (ok) store.set(ev.id, ev);
        console.log(`  [${name}] EVENT ${ev.id.slice(0,12)}… sig=${ok ? 'VALID' : 'INVALID'} -> ${ok ? 'stored' : 'REJECTED'}`);
        ws.send(JSON.stringify(['OK', ev.id, ok, ok ? '' : 'invalid: signature verification failed']));
      } else if (msg[0] === 'REQ') {
        const [, subId, filter] = msg;
        for (const id of filter.ids ?? []) {
          const ev = store.get(id);
          if (ev) { console.log(`  [${name}] REQ  ${id.slice(0,12)}… -> served`); ws.send(JSON.stringify(['EVENT', subId, ev])); }
        }
        ws.send(JSON.stringify(['EOSE', subId]));
      }
    });
  });
  return { close: () => wss.close(), count: () => store.size };
}
