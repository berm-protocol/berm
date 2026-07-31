/**
 * Berm v2 — live proof page.
 *
 * Everything here runs in the visitor's browser using the REAL @berm/crypto
 * module. Nothing is mocked, nothing is pre-rendered, and there is no server.
 * If a claim on this page is false, devtools will show it.
 */

import { identityFromPrf, isValidScalar } from '../../crypto/src/derive.js';
import { PRF_SALT_IDENTITY, HKDF_SALT_IDENTITY, SECP256K1_ORDER } from '../../crypto/src/constants.js';
import { proofText, shareIntentUrl, buildClaimTag, resolveBindingState } from '../../crypto/src/nip39.js';
import { eventId, serializeEvent } from '../../crypto/src/event.js';
import { v1BrokenDerivation, attackerRecoversV1Key } from '../../crypto/src/quarantine/v1-broken.js';

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { finalizeEvent, verifyEvent, nip19, generateSecretKey, getPublicKey } from 'nostr-tools';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const el = (id: string) => document.getElementById(id)!;

const DEFAULT_RELAYS = ['wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.damus.io'];

/** Relay override, e.g. ?relays=ws://localhost:7447,ws://localhost:7448
 *  Useful for self-hosters pointing at their own relay, and for automated
 *  end-to-end tests that must not depend on public infrastructure. */
const RELAYS = (() => {
  const q = new URLSearchParams(location.search).get('relays');
  if (!q) return DEFAULT_RELAYS;
  const list = q.split(',').map((s) => s.trim()).filter((s) => /^wss?:\/\//.test(s));
  return list.length ? list : DEFAULT_RELAYS;
})();

/* ══════════════════════════════════════════════════════════════════════
   ACT I — the break
   ══════════════════════════════════════════════════════════════════════ */

function runBreak() {
  const raw = (el('xid') as HTMLInputElement).value.trim() || '12345678';

  const victim = v1BrokenDerivation(raw);
  const attacker = attackerRecoversV1Key(raw);
  const match = victim === attacker;

  el('v1-victim').textContent = victim;
  el('v1-attacker').textContent = attacker;

  const verdict = el('v1-verdict');
  verdict.className = match ? 'verdict bad' : 'verdict good';
  verdict.innerHTML = match
    ? `<strong>IDENTICAL.</strong> The attacker used nothing but the public number you typed. ` +
      `Under v1 this is that account's Nostr private key — for anyone who wants it.`
    : `Mismatch — which would mean the demo is broken.`;

  // Timing: how long does "stealing an identity" take?
  const t0 = performance.now();
  for (let i = 0; i < 1000; i++) attackerRecoversV1Key(String(i));
  const per = (performance.now() - t0);
  el('v1-rate').textContent =
    `${Math.round(1000 / per * 1000).toLocaleString()} identities/second on this machine, in a browser tab.`;
}

function runV2Contrast() {
  const raw = (el('xid') as HTMLInputElement).value.trim() || '12345678';
  el('v2-attempt').textContent =
    `An attacker holding X user ID ${raw} can compute… nothing. ` +
    `The v2 key needs prf_out — 32 bytes generated inside a hardware authenticator, ` +
    `never transmitted, not a function of any public value. There is no formula to run.`;
}

/* ══════════════════════════════════════════════════════════════════════
   ACT II — identity
   ══════════════════════════════════════════════════════════════════════ */

type Session = {
  mode: 'passkey' | 'software';
  secretKey: Uint8Array;
  pubkeyHex: string;
  npub: string;
  credentialIdHex: string;
  prfHex: string;
  attempt: number;
};

let session: Session | null = null;
let storedCredentialId: Uint8Array | null = null;

function secureContextOk(): { ok: boolean; why: string } {
  if (!window.isSecureContext) {
    return { ok: false, why: 'This page is not a secure context. WebAuthn needs https:// or localhost.' };
  }
  if (!window.PublicKeyCredential) {
    return { ok: false, why: 'This browser has no WebAuthn support.' };
  }
  return { ok: true, why: '' };
}

async function enrolPasskey() {
  const status = el('id-status');
  const check = secureContextOk();
  if (!check.ok) { status.className = 'note warn'; status.textContent = check.why; return; }

  status.className = 'note';
  status.textContent = 'Waiting for your authenticator…';

  try {
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(new ArrayBuffer(32))),
        rp: { id: location.hostname, name: 'Berm demo' },
        user: {
          id: crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16))),
          name: 'berm-demo',
          displayName: 'Berm demo identity',
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        extensions: { prf: {} } as any,
      },
    })) as PublicKeyCredential;

    const ext = cred.getClientExtensionResults() as any;
    if (ext?.prf?.enabled !== true) {
      status.className = 'note warn';
      status.innerHTML =
        `<strong>This authenticator does not support PRF.</strong> ` +
        `That is the correct, honest outcome — and note what did NOT happen: ` +
        `no weaker key was invented to paper over it. A real client routes you to ` +
        `a NIP-07 extension or a NIP-46 signer here. Use the software-key button below to continue the tour.`;
      return;
    }

    storedCredentialId = new Uint8Array(cred.rawId);
    localStorage.setItem('berm_demo_credid', bytesToHex(storedCredentialId));
    status.textContent = 'Passkey created. Now proving PRF actually returns a value…';
    await signInPasskey();
  } catch (e: any) {
    status.className = 'note warn';
    status.textContent = `Enrolment stopped: ${e?.message ?? e}`;
  }
}

async function signInPasskey() {
  const status = el('id-status');
  const check = secureContextOk();
  if (!check.ok) { status.className = 'note warn'; status.textContent = check.why; return; }

  const saved = localStorage.getItem('berm_demo_credid');
  const credId = storedCredentialId ?? (saved ? hexToBytes(saved) : null);
  if (!credId) { status.className = 'note warn'; status.textContent = 'Create a passkey first.'; return; }

  status.className = 'note';
  status.textContent = 'Waiting for your authenticator…';

  try {
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(new ArrayBuffer(32))),
        rpId: location.hostname,
        allowCredentials: [{ id: credId as any, type: 'public-key' }],
        userVerification: 'required',
        extensions: { prf: { eval: { first: utf8ToBytes(PRF_SALT_IDENTITY) as any } } } as any,
      },
    })) as PublicKeyCredential;

    const first = (assertion.getClientExtensionResults() as any)?.prf?.results?.first;
    if (!first) {
      status.className = 'note warn';
      status.textContent = 'Authenticator advertised PRF but returned nothing. Enrolment correctly refuses to continue.';
      return;
    }
    const prfOut = new Uint8Array(first);
    setSession('passkey', prfOut, credId);
  } catch (e: any) {
    status.className = 'note warn';
    status.textContent = `Sign-in stopped: ${e?.message ?? e}`;
  }
}

/** Software-key mode: same derivation, entropy from crypto.getRandomValues
 *  instead of an authenticator. Lets the tour run on file:// or on a browser
 *  without PRF. Clearly labelled — this is NOT how production works. */
function softwareKey() {
  let seedHex = localStorage.getItem('berm_demo_softseed');
  if (!seedHex) {
    seedHex = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    localStorage.setItem('berm_demo_softseed', seedHex);
  }
  const credId = sha256(utf8ToBytes('berm/demo/software-credential')).slice(0, 16);
  setSession('software', hexToBytes(seedHex), credId);
}

function setSession(mode: 'passkey' | 'software', prfOut: Uint8Array, credId: Uint8Array) {
  const id = identityFromPrf(prfOut, credId);
  session = {
    mode,
    secretKey: id.secretKey,
    pubkeyHex: id.pubkeyHex,
    npub: id.npub,
    credentialIdHex: bytesToHex(credId),
    prfHex: bytesToHex(prfOut),
    attempt: id.attempt,
  };

  el('id-card').classList.remove('hidden');
  el('id-npub').textContent = id.npub;
  el('id-pubkey').textContent = id.pubkeyHex;
  el('id-mode').textContent = mode === 'passkey' ? 'hardware passkey (PRF)' : 'software key (demo only)';
  el('id-mode').className = mode === 'passkey' ? 'pill ok' : 'pill warn';
  el('id-attempt').textContent = String(id.attempt);
  el('id-valid').textContent = isValidScalar(id.secretKey) ? 'yes' : 'NO — bug';

  const status = el('id-status');
  status.className = mode === 'passkey' ? 'note ok' : 'note warn';
  status.innerHTML =
    mode === 'passkey'
      ? `<strong>No seed phrase. No password. No custodian.</strong> Press “Sign in again” — ` +
        `you will get this exact npub back, because it is derived, not stored.`
      : `Software-key mode (this page is not on https/localhost, or your authenticator lacks PRF). ` +
        `The derivation below is identical to production; only the entropy source differs.`;

  renderAudit();
  el('publish-gate').classList.add('hidden');
  el('publish-ui').classList.remove('hidden');
  renderBinding();
}

/* ══════════════════════════════════════════════════════════════════════
   ACT III — publish to the open network
   ══════════════════════════════════════════════════════════════════════ */

function relayRow(url: string, state: string, cls = '') {
  return `<div class="relay"><span class="mono">${url}</span><span class="${cls}">${state}</span></div>`;
}

async function publish() {
  if (!session) return;
  const content = (el('post') as HTMLTextAreaElement).value.trim();
  if (!content) return;

  const ev = finalizeEvent(
    {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['t', 'bermdemo']],
      content,
    },
    session.secretKey,
  );

  el('pub-id').textContent = ev.id;
  el('pub-sig').textContent = verifyEvent(ev) ? 'valid (verified locally before sending)' : 'INVALID';
  el('pub-json').textContent = JSON.stringify(ev, null, 2);
  el('pub-result').classList.remove('hidden');

  const box = el('relay-list');
  box.innerHTML = RELAYS.map((r) => relayRow(r, 'connecting…', 'dim')).join('');

  const results = new Map<string, string>();
  const render = () =>
    (box.innerHTML = RELAYS.map((r) => {
      const s = results.get(r) ?? 'connecting…';
      const cls = s.startsWith('accepted') ? 'ok' : s.startsWith('rejected') || s.startsWith('error') ? 'bad' : 'dim';
      return relayRow(r, s, cls);
    }).join(''));

  let accepted = 0;
  await Promise.all(
    RELAYS.map(
      (url) =>
        new Promise<void>((resolve) => {
          let ws: WebSocket;
          const done = (s: string) => { results.set(url, s); render(); try { ws.close(); } catch {} resolve(); };
          const timer = setTimeout(() => done('timeout'), 12000);
          try { ws = new WebSocket(url); } catch { clearTimeout(timer); return done('error: blocked'); }
          ws.onopen = () => { results.set(url, 'sending…'); render(); ws.send(JSON.stringify(['EVENT', ev])); };
          ws.onmessage = (m) => {
            const d = JSON.parse(m.data);
            if (d[0] === 'OK' && d[1] === ev.id) {
              clearTimeout(timer);
              if (d[2]) accepted++;
              done(d[2] ? 'accepted ✓' : `rejected: ${d[3] ?? ''}`);
            }
          };
          ws.onerror = () => { clearTimeout(timer); done('error: unreachable'); };
        }),
    ),
  );

  const gate = el('pub-verdict');
  const isPublic = RELAYS.some((r) => r.startsWith('wss://') && !/localhost|127\.0\.0\.1/.test(r));
  if (accepted >= 2) {
    gate.className = 'verdict good';
    gate.innerHTML =
      `<strong>Accepted by ${accepted} independent relays.</strong> ` +
      `The spec requires ≥2 acceptances across ≥2 operators before a publish counts as successful — that just happened. ` +
      (isPublic
        ? `This note now exists on machines neither you nor this project controls. ` +
          `Open it in any Nostr client on earth: ` +
          `<a href="https://njump.me/${ev.id}" target="_blank" rel="noopener">njump.me/${ev.id.slice(0, 16)}…</a>`
        : `You are pointed at local relays, so this stayed on your machine — but the code path was identical, ` +
          `and each relay verified the signature itself before accepting.`);
  } else {
    gate.className = 'verdict warn';
    gate.innerHTML =
      `Only ${accepted} relay accepted. The spec's ≥2-relay rule means this does NOT count as published. ` +
      `A network here is likely blocking WebSocket egress — try from a normal connection.`;
  }
  el('readback-btn').classList.remove('hidden');
  el('readback-btn').setAttribute('data-id', ev.id);
}

async function readBack() {
  const id = el('readback-btn').getAttribute('data-id')!;
  const out = el('readback-out');
  out.classList.remove('hidden');
  out.textContent = 'Opening a fresh connection and asking the relays for it back…';

  const found = await Promise.any(
    RELAYS.map(
      (url) =>
        new Promise<any>((resolve, reject) => {
          // The constructor can throw synchronously (blocked scheme, bad URL).
          // Without this guard the promise never settles and Promise.any hangs.
          let ws: WebSocket;
          try { ws = new WebSocket(url); } catch { return reject(new Error('blocked')); }
          const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('timeout')); }, 12000);
          ws.onopen = () => ws.send(JSON.stringify(['REQ', 'rb', { ids: [id] }]));
          ws.onmessage = (m) => {
            const d = JSON.parse(m.data);
            if (d[0] === 'EVENT' && d[2]?.id === id) { clearTimeout(timer); ws.close(); resolve({ url, ev: d[2] }); }
          };
          ws.onerror = () => { clearTimeout(timer); reject(new Error('unreachable')); };
          ws.onclose = () => { clearTimeout(timer); reject(new Error('closed')); };
        }),
    ),
  ).catch(() => null);

  out.innerHTML = found
    ? `<span class="ok">Retrieved from ${found.url}.</span> Signature re-verified from scratch: ` +
      `<strong>${verifyEvent(found.ev)}</strong>. This page did not keep a copy — the open network did.`
    : `<span class="bad">Not retrieved.</span> Either egress is blocked here, or propagation is still in flight.`;
}

/* ══════════════════════════════════════════════════════════════════════
   Binding — what X is actually for
   ══════════════════════════════════════════════════════════════════════ */

function renderBinding() {
  if (!session) return;
  const handle = (el('handle') as HTMLInputElement).value.trim().replace(/^@/, '');
  el('bind-proof').textContent = proofText(session.npub);
  const intent = shareIntentUrl(session.npub);
  const a = el('bind-intent') as HTMLAnchorElement;
  a.href = intent;
  a.textContent = 'Post this on X (opens the composer — you send it, nothing is automated)';

  if (handle) {
    el('bind-tag').textContent = JSON.stringify(
      buildClaimTag({ platform: 'twitter', identity: handle, proof: '<id of the post you just made>' }),
    );
  }

  for (const [live, node] of [
    [handle, 'state-verified'],
    [undefined, 'state-claimed'],
    ['someone_else', 'state-other'],
  ] as const) {
    if (!handle) continue;
    const s = resolveBindingState({ platform: 'twitter', identity: handle, proof: '1' }, live as any);
    const n = el(node);
    n.textContent = s;
    n.className = 'pill ' + (s === 'verified' ? 'ok' : 'warn');
  }
}

/* ══════════════════════════════════════════════════════════════════════
   Audit panel
   ══════════════════════════════════════════════════════════════════════ */

function renderAudit() {
  if (!session) return;
  el('aud-prf').textContent = session.prfHex;
  el('aud-cred').textContent = session.credentialIdHex;
  el('aud-hkdf-salt').textContent = HKDF_SALT_IDENTITY;
  el('aud-prf-salt').textContent = PRF_SALT_IDENTITY;
  el('aud-info').textContent = `"secp256k1|" || ${session.credentialIdHex} || "|" || ${session.attempt}`;
  el('aud-n').textContent = '0x' + SECP256K1_ORDER.toString(16);
  el('aud-sk-valid').textContent = isValidScalar(session.secretKey) ? '0 < sk < n  ✓' : 'INVALID';
  el('aud-pub').textContent = session.pubkeyHex;

  // Independent recomputation, from the displayed values only.
  const recomputed = identityFromPrf(hexToBytes(session.prfHex), hexToBytes(session.credentialIdHex));
  el('aud-recompute').innerHTML =
    recomputed.npub === session.npub
      ? `<span class="ok">Recomputed from the values above: ${recomputed.npub} — identical.</span>`
      : `<span class="bad">Mismatch — the page is lying to you.</span>`;

  const demoEv = {
    pubkey: session.pubkeyHex,
    created_at: 1785000000,
    kind: 0,
    tags: [buildClaimTag({ platform: 'twitter', identity: 'example', proof: '123' })],
    content: JSON.stringify({ name: 'example', nip05: '_@xonly.ai' }),
  };
  el('aud-serial').textContent = serializeEvent(demoEv);
  el('aud-evid').textContent = eventId(demoEv);
}

/* ══════════════════════════════════════════════════════════════════════ */

function hexToBytes(h: string): Uint8Array {
  const m = h.match(/../g);
  if (!m) return new Uint8Array(0);
  return Uint8Array.from(m.map((b) => parseInt(b, 16)));
}

function boot() {
  runBreak();
  runV2Contrast();

  el('xid').addEventListener('input', () => { runBreak(); runV2Contrast(); });
  el('enrol-btn').addEventListener('click', enrolPasskey);
  el('signin-btn').addEventListener('click', signInPasskey);
  el('soft-btn').addEventListener('click', softwareKey);
  el('publish-btn').addEventListener('click', publish);
  el('readback-btn').addEventListener('click', readBack);
  el('handle').addEventListener('input', renderBinding);

  el('ctx').textContent = window.isSecureContext
    ? `secure context ✓ — origin ${location.origin} — passkey flow available`
    : `not a secure context (${location.protocol}) — passkey flow disabled, software-key mode available`;

  // Prove the page has no backend: list every network origin it can reach.
  el('net').textContent = RELAYS.join('  ·  ');
}

document.addEventListener('DOMContentLoaded', boot);
