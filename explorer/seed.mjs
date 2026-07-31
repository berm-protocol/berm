/**
 * Seeds a CONFLICT: the real owner and a squatter both claiming @dorian.
 * The squatter signs a profile back-dated to 2019 — which is trivial, and is
 * exactly why created_at must never decide priority.
 */
import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import WebSocket from 'ws';

export async function seed(relays) {
  const owner = generateSecretKey();
  const squatter = generateSecretKey();
  const ownerNpub = nip19.npubEncode(getPublicKey(owner));
  const squatNpub = nip19.npubEncode(getPublicKey(squatter));

  const events = [];

  // --- the real owner: anchored, account id recorded, proof archived ---
  events.push(finalizeEvent({
    kind: 0, created_at: 1774000000,
    tags: [['i','twitter:dorian','1789456123456789012']],
    content: JSON.stringify({ name:'dorian', display_name:'Dorian', about:'Building XOnly.', nip05:'_@xonly.ai' }),
  }, owner));

  events.push(finalizeEvent({
    kind: 30078, created_at: 1774000100,
    tags: [
      ['d','berm:identity:v1'],
      ['x-account-id','1234567890'],
      ['anchor-type','opentimestamps'],
      ['anchor-proof','AE9wZW5UaW1lc3RhbXBzAABQcm9vZgC/ic7GAAAAAWRlbW9wcm9vZmJhc2U2NHBheWxvYWRmb3J0ZXN0aW5ncHVycG9zZXNvbmx5AAAA'],
      ['anchor-time','1774000200'],
      ['proof-snapshot','https://web.archive.org/web/20260320/https://x.com/dorian/status/1789456123456789012'],
      ['observed-at','1774000050'],
    ],
    content: '',
  }, owner));

  // --- the squatter: back-dated six years, no anchor, no id, no snapshot ---
  events.push(finalizeEvent({
    kind: 0, created_at: 1560000000,   // "2019" — self-declared, worthless
    tags: [['i','twitter:dorian','9999999999999999999']],
    content: JSON.stringify({ name:'dorian', display_name:'Dorian (OFFICIAL)', about:'The real one, honest.' }),
  }, squatter));

  for (const url of relays) {
    await new Promise((res) => {
      const ws = new WebSocket(url);
      let sent = 0;
      ws.on('open', () => events.forEach((e) => ws.send(JSON.stringify(['EVENT', e]))));
      ws.on('message', () => { if (++sent >= events.length) { ws.close(); res(); } });
      ws.on('error', () => res());
      setTimeout(() => { try{ws.close()}catch{}; res(); }, 4000);
    });
  }
  return { ownerNpub, squatNpub };
}
