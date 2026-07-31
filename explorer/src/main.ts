/**
 * /who — the identity lookup.
 *
 * Type an X handle, find out who legitimately claims it, and see the evidence.
 *
 * The one thing that makes this credible rather than just convenient: it
 * VERIFIES. Etherscan can render naively because it reads a chain that is
 * already validated. Relays validate nothing — anyone can publish anything — so
 * every signature here is re-checked in your browser before a single pixel is
 * drawn.
 *
 * And it shows conflicts. The moment an explorer hides a competing claim it
 * stops being a lens and becomes an authority, and authorities get captured.
 */

import { verifyEvent, nip19 } from 'nostr-tools';
import {
  resolve, buildClaimant, parseNip39, proofUrl, expectedProofText,
  type NostrEvent, type Claimant, type Resolution,
} from './resolve.js';

const $ = (id: string) => {
  const el = document.getElementById(id);
  if (!el) { console.error(`[who] missing #${id}`); return document.createElement('div'); }
  return el;
};

const DEFAULT_RELAYS = ['wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.damus.io'];

const RELAYS = (() => {
  const q = new URLSearchParams(location.search).get('relays');
  if (!q) return DEFAULT_RELAYS;
  const list = q.split(',').map((s) => s.trim()).filter((s) => /^wss?:\/\//.test(s));
  return list.length ? list : DEFAULT_RELAYS;
})();

const esc = (s: string) => {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
};

/* ══════════════════════════════════════════════════════════════════════
   Relay queries
   ══════════════════════════════════════════════════════════════════════ */

interface QueryStat { relay: string; events: number; status: string }

const stats: QueryStat[] = [];

/**
 * Collect events matching a filter across relays.
 *
 * Every event is signature-checked here, at the boundary. Nothing unverified
 * reaches the resolver or the DOM.
 */
function query(filters: unknown[], timeoutMs = 9000): Promise<NostrEvent[]> {
  const found = new Map<string, NostrEvent>();

  return Promise.all(
    RELAYS.map(
      (url) =>
        new Promise<void>((done) => {
          const stat: QueryStat = { relay: url, events: 0, status: 'connecting' };
          stats.push(stat);
          let ws: WebSocket;
          const finish = (s: string) => { stat.status = s; try { ws?.close(); } catch {} renderStats(); done(); };
          const timer = setTimeout(() => finish('timeout'), timeoutMs);

          try { ws = new WebSocket(url); } catch { clearTimeout(timer); return finish('blocked'); }

          ws.onopen = () => {
            stat.status = 'querying'; renderStats();
            ws.send(JSON.stringify(['REQ', 'who', ...filters]));
          };
          ws.onmessage = (m) => {
            try {
              const d = JSON.parse(m.data);
              if (d[0] === 'EVENT' && d[2]) {
                const ev = d[2] as NostrEvent;
                // Verify before storing. A relay handing us a forged event must
                // not be able to put it on the page.
                if (verifyEvent(ev as any)) {
                  found.set(ev.id, ev);
                  stat.events++;
                } else {
                  stat.status = 'served an invalid signature';
                }
              }
              if (d[0] === 'EOSE') { clearTimeout(timer); finish('ok'); }
            } catch { /* ignore malformed frames */ }
          };
          ws.onerror = () => { clearTimeout(timer); finish('unreachable'); };
        }),
    ),
  ).then(() => [...found.values()]);
}

function renderStats(): void {
  $('relay-stats').innerHTML = stats
    .map((s) => {
      const cls = s.status === 'ok' ? 'ok' : /invalid/.test(s.status) ? 'bad'
                : ['connecting', 'querying'].includes(s.status) ? 'dim' : 'warn';
      return `<div class="rl"><span class="mono">${esc(s.relay)}</span>` +
             `<span class="${cls}">${esc(s.status)}${s.events ? ` · ${s.events}` : ''}</span></div>`;
    })
    .join('');
}

/* ══════════════════════════════════════════════════════════════════════
   Lookup
   ══════════════════════════════════════════════════════════════════════ */

async function lookup(rawHandle: string): Promise<void> {
  const handle = rawHandle.trim().replace(/^@/, '').replace(/^https?:\/\/(x|twitter)\.com\//i, '');
  if (!handle) return;

  history.replaceState(null, '', `?handle=${encodeURIComponent(handle)}` +
    (new URLSearchParams(location.search).get('relays') ? `&relays=${encodeURIComponent(new URLSearchParams(location.search).get('relays')!)}` : ''));

  stats.length = 0;
  $('results').innerHTML = '';
  $('summary').innerHTML = '';
  $('empty').classList.add('hidden');
  $('loading').classList.remove('hidden');
  renderStats();

  // `i` is a single-letter tag, so NIP-01 relays can index and filter it.
  const profiles = await query([{ kinds: [0], '#i': [`twitter:${handle}`], limit: 100 }]);

  // XOnly attestations for the same keys — the account id, anchor and snapshot.
  const attestations = profiles.length
    ? await query([{ kinds: [30078], authors: profiles.map((p) => p.pubkey), '#d': ['berm:identity:v1'], limit: 200 }])
    : [];

  const attByPubkey = new Map<string, NostrEvent>();
  for (const a of attestations) {
    const prev = attByPubkey.get(a.pubkey);
    if (!prev || a.created_at > prev.created_at) attByPubkey.set(a.pubkey, a);
  }

  const claimants: Claimant[] = [];
  for (const p of profiles) {
    for (const c of parseNip39(p)) {
      if (c.platform !== 'twitter' || c.identity.toLowerCase() !== handle.toLowerCase()) continue;
      claimants.push(buildClaimant(p, c, nip19.npubEncode(p.pubkey), attByPubkey.get(p.pubkey)));
    }
  }

  $('loading').classList.add('hidden');

  if (!claimants.length) {
    $('empty').classList.remove('hidden');
    $('empty').innerHTML =
      `<strong>No claims found for @${esc(handle)}.</strong><br>` +
      `Nobody has published a verifiable link between a Nostr identity and this X account — ` +
      `on the relays queried above. Absence here is not proof of absence everywhere.`;
    return;
  }

  render(resolve(handle, claimants));
}

/* ══════════════════════════════════════════════════════════════════════
   Rendering
   ══════════════════════════════════════════════════════════════════════ */

function render(r: Resolution): void {
  const sum = $('summary');

  if (r.undecidable) {
    sum.className = 'verdict warn';
    sum.innerHTML =
      `<strong>${r.claimants.length} identities claim @${esc(r.handle)}, and none of them is anchored.</strong> ` +
      `There is no honest basis for picking a winner, so this page does not. ` +
      `Anchor dates are what settle priority — self-declared timestamps can be set to any year.`;
  } else if (r.conflict) {
    sum.className = 'verdict warn';
    sum.innerHTML =
      `<strong>${r.claimants.length} identities claim @${esc(r.handle)}.</strong> ` +
      `The first row has the earliest anchored claim, which is the one that can be proven ` +
      `to predate the others. Check the evidence yourself — all of it is linked.`;
  } else {
    sum.className = 'verdict good';
    sum.innerHTML = `<strong>One identity claims @${esc(r.handle)}.</strong> ` +
      `Signature verified in your browser. Evidence below.`;
  }

  const host = $('results');
  host.innerHTML = '';
  r.claimants.forEach((c, i) => host.appendChild(claimantCard(c, i, r)));
}

function claimantCard(c: Claimant, index: number, r: Resolution): HTMLElement {
  const el = document.createElement('div');
  el.className = 'claim' + (index === 0 && !r.undecidable ? ' primary' : '');

  const anchorLabel =
    c.anchorState === 'anchored' ? 'anchored'
    : c.anchorState === 'anchor-unverified' ? 'anchor present, not checked here'
    : 'no anchor';
  const anchorCls =
    c.anchorState === 'anchored' ? 'ok' : c.anchorState === 'anchor-unverified' ? 'warn' : 'bad';

  const when = (t?: number) => (t ? new Date(t * 1000).toISOString().slice(0, 10) : '—');

  const rows: string[] = [
    row('npub', `<span class="mono brk">${esc(c.npub)}</span>`),
    row('X account id', c.attestation?.accountId
      ? `<span class="mono">${esc(c.attestation.accountId)}</span> <span class="dim">— permanent; handles recycle, ids do not</span>`
      : `<span class="bad">not recorded</span>`),
    row('anchor', `<span class="${anchorCls}">${anchorLabel}</span>` +
      (c.attestation?.anchorTime ? ` <span class="dim">· claims ${when(c.attestation.anchorTime)}</span>` : '')),
    row('self-declared date', `<span class="dim">${when(c.profileEvent.created_at)} — not evidence</span>`),
  ];

  const pUrl = proofUrl(c.claim);
  rows.push(row('proof post', pUrl
    ? `<a href="${esc(pUrl)}" target="_blank" rel="noopener">x.com/${esc(c.claim.identity)}/status/${esc(c.claim.proof)}</a>`
    : '—'));

  rows.push(row('archived copy', c.attestation?.snapshotUrl
    ? `<a href="${esc(c.attestation.snapshotUrl)}" target="_blank" rel="noopener">Wayback snapshot</a>` +
      ` <span class="dim">— survives account deletion</span>`
    : `<span class="warn">none</span>`));

  if (c.attestation?.witnessPubkey) {
    rows.push(row('witness', `<span class="mono brk">${esc(c.attestation.witnessPubkey)}</span>`));
  }

  el.innerHTML =
    `<div class="chead">` +
      `<div class="avatar">${c.picture ? `<img src="${esc(c.picture)}" alt="">` : ''}</div>` +
      `<div class="who"><div class="nm">${esc(c.displayName ?? 'Unnamed identity')}</div>` +
      `<div class="dim mono">@${esc(c.claim.identity)}</div></div>` +
      (index === 0 && !r.undecidable ? `<span class="pill ok">earliest anchored</span>` : '') +
    `</div>` +
    `<dl class="kv">${rows.join('')}</dl>` +
    (c.caveats.length
      ? `<ul class="caveats">${c.caveats.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
      : '') +
    `<div class="verifyme">` +
      `<strong>Check it yourself:</strong> open the proof post and confirm it contains, verbatim — ` +
      `<code class="brk">${esc(expectedProofText(c.npub))}</code>` +
    `</div>`;

  const details = document.createElement('details');
  details.innerHTML =
    `<summary class="dim">raw events</summary>` +
    `<pre class="out">${esc(JSON.stringify(c.profileEvent, null, 2))}</pre>` +
    (c.attestationEvent ? `<pre class="out">${esc(JSON.stringify(c.attestationEvent, null, 2))}</pre>` : '');
  el.appendChild(details);

  return el;
}

function row(k: string, v: string): string {
  return `<dt>${esc(k)}</dt><dd>${v}</dd>`;
}

/* ══════════════════════════════════════════════════════════════════════ */

function boot(): void {
  $('relays-used').textContent = RELAYS.join('  ·  ');

  const input = $('handle') as HTMLInputElement;
  const go = () => lookup(input.value);

  $('go').addEventListener('click', go);
  input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') go(); });

  const preset = new URLSearchParams(location.search).get('handle');
  if (preset) { input.value = preset; lookup(preset); }
}

document.addEventListener('DOMContentLoaded', boot);
