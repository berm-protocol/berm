/**
 * signer.xonly.ai — the page.
 *
 * Two jobs, and nothing else belongs here:
 *   1. Give a person with no extension and no bunker a real Nostr key they own.
 *   2. Answer signature requests from other origins, with the user in the loop.
 *
 * What this page must never do: hold anything in storage, frame anything, or be
 * frameable. The Caddyfile sets `frame-ancestors 'none'` for the second one;
 * the first is enforced by `vault.ts` and asserted by a test.
 */

import * as vault from './vault.js';
import * as grants from './grants.js';
import { listen } from './broker.js';
import type { ApprovalRequest, ApprovalDecision } from './broker.js';

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) { console.error(`[signer] missing #${id}`); return document.createElement('div'); }
  return el;
};
const show = (id: string, on: boolean) => { $(id).hidden = !on; };
const text = (id: string, s: string) => { $(id).textContent = s; };

let pendingFile: string | null = null;

/* ── passphrase strength ───────────────────────────────────────────────
   Not a score out of five. The only question that matters is whether the
   passphrase is long enough that scrypt's work factor is doing something,
   and we say so in words rather than colouring a bar. */
function passphraseNote(p: string): { ok: boolean; note: string } {
  if (p.length === 0) return { ok: false, note: '' };
  if (p.length < 12) return { ok: false, note: `${p.length}/12 characters minimum — this is the only thing standing between your file and whoever finds it.` };
  if (p.length < 20) return { ok: true, note: 'Acceptable. Four unrelated words would be stronger and easier to remember.' };
  return { ok: true, note: 'Good length.' };
}

/* ── screens ─────────────────────────────────────────────────────────── */

function toStart(): void {
  ['screen-start', 'screen-create', 'screen-saved', 'screen-unlock', 'screen-session'].forEach((s) => show(s, s === 'screen-start'));
}
function toScreen(id: string): void {
  ['screen-start', 'screen-create', 'screen-saved', 'screen-unlock', 'screen-session'].forEach((s) => show(s, s === id));
}

function renderSession(npub: string): void {
  // The user is done: key in memory, file saved or deliberately declined. Only
  // now may a waiting client's connect() proceed — earlier and its approval
  // dialog would cover the screen telling them to save their only copy.
  vault.sessionReady();
  text('session-npub', npub);
  text('session-custody', 'This key exists in this tab and nowhere else. Closing the tab locks it. Your downloaded file is the only copy that survives.');
  renderGrants();
  toScreen('screen-session');
}

function renderGrants(): void {
  const list = grants.list();
  const host = $('grant-list');
  host.innerHTML = '';
  if (list.length === 0) {
    host.innerHTML = '<p class="muted">No application currently has standing permission. Every request will ask you.</p>';
    return;
  }
  for (const g of list) {
    const row = document.createElement('div');
    row.className = 'grant';
    const mins = Math.max(0, Math.round((g.expiresAt - Date.now()) / 60000));
    row.innerHTML =
      `<div><strong>${escapeHtml(g.origin)}</strong>` +
      `<div class="muted">may request ${escapeHtml(g.methods.join(', '))}` +
      (g.kinds.length ? `, kind ${g.kinds.join('/')} only` : '') +
      ` · expires in ${mins} min · used ${g.used}×</div></div>`;
    const b = document.createElement('button');
    b.className = 'ghost';
    b.textContent = 'Revoke';
    b.onclick = () => { grants.revoke(g.origin); renderGrants(); };
    row.appendChild(b);
    host.appendChild(row);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/* ── approval ────────────────────────────────────────────────────────── */

function requestApproval(req: ApprovalRequest): Promise<ApprovalDecision> {
  return new Promise((resolve) => {
    text('ap-who', req.registered ? req.clientName : 'An unregistered site');
    text('ap-origin', req.origin);
    show('ap-unknown', !req.registered);

    if (req.human) {
      text('ap-human', req.human);
      show('ap-human-wrap', true);
      show('ap-noexplain', false);
    } else {
      show('ap-human-wrap', false);
      show('ap-noexplain', true);
    }

    // The raw event is shown ALWAYS, not only when the sentence is missing.
    // The human line is a courtesy on top of the evidence, never a replacement.
    text('ap-raw', JSON.stringify(req.raw, null, 2));
    text('ap-method', req.method + (typeof req.kind === 'number' ? ` · kind ${req.kind}` : ''));

    const grantSel = $('ap-grant') as HTMLSelectElement;
    grantSel.value = '0';
    show('ap-grant-wrap', req.method === 'sign_event' && typeof req.kind === 'number');

    show('approval', true);
    const done = (approved: boolean) => {
      show('approval', false);
      const grantMs = approved ? Number(grantSel.value) : 0;
      renderGrants();
      resolve({ approved, grantMs });
    };
    ($('ap-approve') as HTMLButtonElement).onclick = () => done(true);
    ($('ap-decline') as HTMLButtonElement).onclick = () => done(false);
  });
}

/* ── wiring ──────────────────────────────────────────────────────────── */

function boot(): void {
  vault.onLock(() => { if (!$('screen-session').hidden) toStart(); });

  ($('go-create') as HTMLButtonElement).onclick = () => toScreen('screen-create');
  ($('go-unlock') as HTMLButtonElement).onclick = () => toScreen('screen-unlock');
  $('back-1').onclick = toStart;
  $('back-2').onclick = toStart;

  const pw = $('create-pass') as HTMLInputElement;
  const pw2 = $('create-pass2') as HTMLInputElement;
  const createBtn = $('create-go') as HTMLButtonElement;

  const revalidate = () => {
    const { ok, note } = passphraseNote(pw.value);
    text('create-note', note);
    const match = pw.value.length > 0 && pw.value === pw2.value;
    text('create-match', pw2.value.length === 0 ? '' : match ? '' : 'The two entries do not match.');
    createBtn.disabled = !(ok && match);
  };
  pw.oninput = revalidate;
  pw2.oninput = revalidate;

  createBtn.onclick = async () => {
    createBtn.disabled = true;
    text('create-status', 'Encrypting — this takes about a second, on purpose.');
    await new Promise((r) => setTimeout(r, 30));   // let the line paint before scrypt blocks
    try {
      const { ncryptsec, npub } = vault.createIdentity(pw.value);
      pendingFile = ncryptsec;
      text('saved-npub', npub);
      text('saved-file', ncryptsec);
      toScreen('screen-saved');
    } catch (e) {
      text('create-status', `Could not create a key: ${e instanceof Error ? e.message : String(e)}`);
      createBtn.disabled = false;
    }
  };

  ($('download') as HTMLButtonElement).onclick = () => {
    if (!pendingFile) return;
    const blob = new Blob([pendingFile], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'xonly-key.ncryptsec.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    ($('saved-continue') as HTMLButtonElement).disabled = false;
    text('saved-status', 'Downloaded. Put it somewhere you would put a passport.');
  };

  ($('copy-file') as HTMLButtonElement).onclick = async () => {
    if (!pendingFile) return;
    try {
      await navigator.clipboard.writeText(pendingFile);
      ($('saved-continue') as HTMLButtonElement).disabled = false;
      text('saved-status', 'Copied. A clipboard is not a backup — save the file too.');
    } catch { text('saved-status', 'Could not reach the clipboard. Use the download button.'); }
  };

  ($('saved-continue') as HTMLButtonElement).onclick = () => {
    pendingFile = null;
    renderSession(vault.npub());
  };

  const un = $('unlock-file') as HTMLTextAreaElement;
  const unPw = $('unlock-pass') as HTMLInputElement;
  const unBtn = $('unlock-go') as HTMLButtonElement;
  const unRevalidate = () => { unBtn.disabled = !(un.value.trim().startsWith('ncryptsec1') && unPw.value.length > 0); };
  un.oninput = unRevalidate;
  unPw.oninput = unRevalidate;

  ($('unlock-pick') as HTMLInputElement).onchange = async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    un.value = (await f.text()).trim();
    unRevalidate();
  };

  unBtn.onclick = async () => {
    unBtn.disabled = true;
    text('unlock-status', 'Decrypting — about a second.');
    await new Promise((r) => setTimeout(r, 30));
    try {
      const { npub } = vault.unlock(un.value, unPw.value);
      un.value = ''; unPw.value = '';
      renderSession(npub);
    } catch (e) {
      const m = e instanceof Error && e.message === 'bad_passphrase'
        ? 'That passphrase does not open this file. There is no way to recover it, and no one to ask.'
        : 'That file is not a NIP-49 key.';
      text('unlock-status', m);
      unBtn.disabled = false;
    }
  };

  ($('lock') as HTMLButtonElement).onclick = () => { grants.revokeAll(); vault.lock(); toStart(); };

  listen(requestApproval);
  window.addEventListener('beforeunload', () => vault.lock());

  // NO READY ANNOUNCEMENT.
  //
  // The obvious thing is to postMessage the opener "I'm up". We cannot: at this
  // point we do not know the opener's origin, and the only way to send it is
  // targetOrigin '*', which broadcasts to whatever site happens to be there.
  // That is the exact rule broker.ts exists to hold, and an exception for a
  // convenience message is still an exception.
  //
  // So the client polls `ping` until it answers. Slightly more work for the
  // client, and it costs us nothing we should have been willing to spend.
  toStart();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
