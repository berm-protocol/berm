/**
 * Recovery — preparation first, walkthroughs second.
 *
 * The readiness check is the product. By the time someone needs the
 * walkthroughs, their options were already fixed by what they did or did not
 * set up months earlier.
 */

import { nip19, getPublicKey } from 'nostr-tools';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { createLocalSigner, isLocalOrigin } from './sdk/local-signer.js';
import { setup } from '../../sdk/src/connect.js';
import { UserDeclinedError } from './sdk/types.js';
import type { XnsbSdk, Session, EventTemplate } from './sdk/types.js';
import {
  assess, verdict, worstCase, pathFor,
  type IdentityState, type Check, type LossKind,
} from './readiness.js';

const $ = (id: string) => {
  const el = document.getElementById(id);
  if (!el) { console.error(`[recovery] missing #${id}`); return document.createElement('div'); }
  return el;
};
const esc = (s: string) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };

const RELAYS = (() => {
  const q = new URLSearchParams(location.search).get('relays');
  if (!q) return undefined;
  const l = q.split(',').map((s) => s.trim()).filter((s) => /^wss?:\/\//.test(s));
  return l.length ? l : undefined;
})();

/**
 * WHICH SIGNER — ask the SDK, do not decide here.
 *
 * `connect.ts` knows the tier order: an extension the user already has comes
 * first because we should touch nothing, then our own signer origin, then a
 * bunker they already run. Hard-wiring one backend here would take tier 0 away
 * from anyone with Alby installed.
 *
 * Tier 1 is offered only because this app names a signer origin explicitly.
 * `detect()` reports it unavailable otherwise, and that stays true until the
 * origin serves the signer rather than a placeholder.
 *
 * On localhost the dev signer wins: a raw key in localStorage is right for a
 * test loop and wrong for a person. `createDevSigner` throws anywhere else by
 * design, so a deployed build reaching for it dies on boot — the branch is
 * explicit rather than a try/catch around that.
 */
function chooseSigner(appName: string): XnsbSdk {
  const params = new URLSearchParams(location.search);
  const override = params.get('signer');
  if (isLocalOrigin() && !override) {
    return createLocalSigner({ relays: RELAYS, approve: requestApproval, displayName: 'You' });
  }
  const signerOrigin = override ?? 'https://signer.xonly.ai';
  return setup({ relays: RELAYS, appName, signer: { signerOrigin } });
}

const STORE = 'berm_recovery_state';

let sdk: XnsbSdk;
let session: Session | null = null;

function loadState(): IdentityState {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    if (raw) return raw;
  } catch { /* corrupted state is the same as none */ }
  return {
    npub: null, deviceCount: 1, backupConfirmed: false,
    guardianCount: 0, guardianThreshold: 2, handle: null, proofArchived: false,
  };
}
function saveState(s: IdentityState) { localStorage.setItem(STORE, JSON.stringify(s)); }

let state = loadState();

/* ══════════════════════════════════════════════════════════════════════
   Readiness
   ══════════════════════════════════════════════════════════════════════ */

function renderReadiness(): void {
  const checks = assess(state);
  const worst = worstCase(checks);

  const v = $('verdict');
  v.className = `verdict ${worst}`;
  v.innerHTML = `<strong>${esc(verdict(state))}</strong>`;

  const host = $('checks');
  host.innerHTML = '';
  checks.forEach((c) => host.appendChild(checkCard(c)));

  $('fix-panel').classList.toggle('hidden', worst === 'ok');
}

function checkCard(c: Check): HTMLElement {
  const el = document.createElement('div');
  el.className = `check ${c.severity}`;
  el.innerHTML =
    `<div class="chd"><span class="dot"></span><span class="ct">${esc(c.title)}</span></div>` +
    `<p class="cons">${esc(c.consequence)}</p>` +
    (c.action ? `<p class="act">→ ${esc(c.action)}</p>` : '');
  return el;
}

/* ══════════════════════════════════════════════════════════════════════
   Identity
   ══════════════════════════════════════════════════════════════════════ */

function requestApproval(summary: string): Promise<boolean> {
  return new Promise((resolve) => {
    const m = $('approval');
    $('approval-what').textContent = summary;
    m.classList.remove('hidden');
    const done = (ok: boolean) => { m.classList.add('hidden'); resolve(ok); };
    $('approve-yes').onclick = () => done(true);
    $('approve-no').onclick = () => done(false);
  });
}

async function connect(): Promise<void> {
  const btn = $('connect') as HTMLButtonElement;
  btn.disabled = true; btn.textContent = 'Connecting…';
  try {
    session = await sdk.connect({ preferred: 1 });
    state.npub = session.npub;
    saveState(state);
    $('who').classList.remove('hidden');
    $('who-npub').textContent = session.npub;
    btn.classList.add('hidden');
    $('main').classList.remove('hidden');
    renderReadiness();
  } catch (e) {
    flash(`Could not connect: ${(e as Error).message}`);
    btn.disabled = false; btn.textContent = 'Sign in';
  }
}

/* ══════════════════════════════════════════════════════════════════════
   Fixes
   ══════════════════════════════════════════════════════════════════════ */

async function addDevice(): Promise<void> {
  if (!session) return;
  // In the shipped signer this enrols a real second passkey and wraps the key
  // with its PRF output. Here it demonstrates the registry mechanics.
  state.deviceCount += 1;
  saveState(state);
  renderReadiness();
  flash(`Device enrolled — ${state.deviceCount} now hold this identity`);
}

async function downloadBackup(): Promise<void> {
  if (!session) return;

  const pass = ($('backup-pass') as HTMLInputElement).value;
  if (pass.length < 12) {
    flash('Use at least 12 characters — this passphrase is the last line of defence');
    return;
  }

  // The real signer encrypts the key with Argon2id. This demo writes the
  // envelope shape so the flow and the file are inspectable.
  const blob = {
    v: 1,
    kind: 'berm-backup',
    npub: session.npub,
    kdf: 'argon2id',
    note: 'Encrypted identity backup. Useless without the passphrase. Store away from your devices.',
    created_at: new Date().toISOString(),
  };

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(blob, null, 2)], { type: 'application/json' }));
  a.download = `berm-backup-${session.npub.slice(0, 12)}.json`;
  a.click();

  state.backupConfirmed = true;
  saveState(state);
  renderReadiness();
  flash('Backup downloaded — now move it off this device');
}

async function setGuardians(): Promise<void> {
  if (!session) return;
  const raw = ($('guardians') as HTMLTextAreaElement).value;
  const list = raw.split(/[\s,]+/).map((s) => s.trim()).filter((s) => s.startsWith('npub1'));

  if (list.length < 2) { flash('Name at least two guardians'); return; }

  const threshold = Math.min(2, list.length);
  const tpl: EventTemplate = {
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', 'berm:recovery:v1'],
      ...list.map((g) => ['guardian', g]),
      ['threshold', String(threshold)],
    ],
    content: '',
  };

  try {
    const ev = await sdk.signEvent(tpl);
    const r = await sdk.publish(ev, RELAYS);
    if (!r.success) {
      flash(`Only ${r.accepted.length} relay accepted — not published`);
      return;
    }
    state.guardianCount = list.length;
    state.guardianThreshold = threshold;
    saveState(state);
    renderReadiness();
    flash(`${list.length} guardians published, ${threshold} required`);
  } catch (e) {
    flash(e instanceof UserDeclinedError ? 'Declined — nothing published' : (e as Error).message);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   Something already happened
   ══════════════════════════════════════════════════════════════════════ */

function showPath(kind: LossKind): void {
  const p = pathFor(kind, state);
  const el = $('path');
  el.classList.remove('hidden');
  el.className = `path ${p.recoverable ? 'ok' : 'critical'}`;
  el.innerHTML =
    `<h3>${esc(p.title)}</h3>` +
    (p.recoverable ? '' : '<div class="pill bad">not recoverable</div>') +
    `<ol>${p.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` +
    (p.note ? `<p class="note">${esc(p.note)}</p>` : '');
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ══════════════════════════════════════════════════════════════════════ */

function flash(msg: string): void {
  const el = $('flash');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

function boot(): void {
  sdk = chooseSigner('xonly recovery');
  $('connect').addEventListener('click', connect);
  $('add-device').addEventListener('click', addDevice);
  $('download-backup').addEventListener('click', downloadBackup);
  $('set-guardians').addEventListener('click', setGuardians);
  document.querySelectorAll<HTMLElement>('[data-loss]').forEach((b) =>
    b.addEventListener('click', () => showPath(b.dataset.loss as LossKind)));
  $('reset-demo').addEventListener('click', () => { localStorage.removeItem(STORE); location.reload(); });
}

document.addEventListener('DOMContentLoaded', boot);
