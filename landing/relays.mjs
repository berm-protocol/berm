/**
 * Relays for the browser suite, including dishonest ones.
 *
 * The unit tests prove the verdict logic given evidence. These produce the
 * evidence for real — over WebSocket, from a browser, against relays that behave
 * in the three ways that matter:
 *
 *   honest     serves the event as signed
 *   liar       serves a validly signed event whose content differs  → mismatch
 *   forger     serves an event with a broken signature              → no evidence
 *   silent     answers EOSE with nothing                            → no evidence
 *
 * A relay that only ever tells the truth cannot demonstrate that the page
 * detects one that does not.
 */

import { WebSocketServer } from 'ws';

/**
 * @param {number} port
 * @param {string} name
 * @param {{ mode?: 'honest'|'liar'|'forger'|'silent', event?: object, altEvent?: object }} opts
 */
export function startRelay(port, name, opts = {}) {
  const mode = opts.mode ?? 'honest';
  const wss = new WebSocketServer({ port });
  let served = 0;

  wss.on('connection', (ws) => {
    ws.on('message', (buf) => {
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }
      if (msg[0] !== 'REQ') return;

      const [, subId] = msg;

      const send = (ev) => {
        served++;
        ws.send(JSON.stringify(['EVENT', subId, ev]));
      };

      if (mode === 'honest' && opts.event) send(opts.event);

      // A validly signed event with different content. The id and sig are real —
      // for a DIFFERENT post — which is exactly the interesting attack: the relay
      // is not lying about cryptography, it is answering a different question and
      // hoping the page does not notice the id.
      if (mode === 'liar' && opts.altEvent) send(opts.altEvent);

      // Right id, tampered content, so the signature no longer verifies. Must be
      // discarded as evidence rather than counted either way.
      if (mode === 'forger' && opts.event) {
        send({ ...opts.event, content: opts.event.content + ' — tampered' });
      }

      ws.send(JSON.stringify(['EOSE', subId]));
      console.log(`  [${name}:${mode}] REQ -> ${served} event(s)`);
    });
  });

  return { close: () => wss.close(), served: () => served, mode };
}
