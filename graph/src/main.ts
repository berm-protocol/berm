/**
 * The import page.
 *
 * It runs on a CSP-sealed origin (`connect-src 'none'`), so nothing here may
 * assume the network exists. The claimant index is bundled at build time
 * precisely so that matching needs no lookup — a lookup would be a request, a
 * request would need CSP to be widened, and the guarantee would be gone.
 *
 * Signing and publishing happen on a DIFFERENT page. Keeping them apart is what
 * lets this one be fully sealed.
 */

import { parseFollowing, parseAccount, parseMentionMap, assertReadable, ForbiddenFileError } from './archive.js';
import { matchFollowing, expectedUniformMatches, type ClaimantIndex, type MatchResult } from './claimants.js';
import { buildPrivateFollowSet, mergePublicContacts, describeGraphEvent } from './list.js';
import { auditCsp } from './csp.js';

declare const __CLAIMANT_INDEX__: ClaimantIndex;

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) { console.warn(`missing #${id}`); return document.createElement('div'); }
  return el;
};

const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

let matches: MatchResult | null = null;
let selfAccount: { uid: string; username: string } | null = null;
let names = new Map<string, string>();

/* ---------- CSP badge ----------
 *
 * Read from the document rather than from a build-time constant, for two
 * reasons. It audits the policy actually in force instead of the one we think
 * we compiled. And it breaks a genuine cycle: the CSP names this script by
 * hash, so a script containing the CSP would change its own hash.
 */
{
  const meta = document.querySelector<HTMLMetaElement>('meta[http-equiv="Content-Security-Policy"]');
  const badge = $('csp-badge');
  if (!meta?.content) {
    badge.textContent = 'no CSP found';
    badge.style.color = '#ffb454';
  } else {
    const audit = auditCsp(meta.content);
    badge.textContent = audit.ok ? "connect-src 'none' ✓" : `CSP problem: ${audit.problems[0]}`;
    badge.style.color = audit.ok ? '#6ee7a8' : '#ffb454';
  }
}

/* ---------- file intake ---------- */

const drop = $('drop');
const input = $('file') as HTMLInputElement;

drop.addEventListener('click', () => input.click());
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const files = (e as DragEvent).dataTransfer?.files;
  if (files) void handleFiles(Array.from(files));
});
input.addEventListener('change', () => { if (input.files) void handleFiles(Array.from(input.files)); });

async function handleFiles(files: File[]): Promise<void> {
  const out = $('import-out');
  const lines: string[] = [];
  let uids: string[] = [];
  let skipped = 0;

  for (const f of files) {
    // Refuse by NAME before reading a single byte. Routing by filename below
    // means an unrecognised file would otherwise skip every parser — and skip
    // the guard with it.
    try {
      assertReadable(f.name);
    } catch (err) {
      lines.push(`<div class="warn">${esc(f.name)} — ${esc((err as Error).message)}</div>`);
      continue;
    }

    let text: string;
    try {
      text = await f.text();
    } catch {
      lines.push(`<div class="warn">${esc(f.name)}: could not be read</div>`);
      continue;
    }

    try {
      if (/following/i.test(f.name)) {
        const r = parseFollowing(text, f.name);
        uids = r.uids; skipped = r.skipped;
        lines.push(`<div class="good">${esc(f.name)} — ${r.uids.length} accounts followed</div>`);
      } else if (/account/i.test(f.name)) {
        selfAccount = parseAccount(text, f.name);
        lines.push(`<div class="good">${esc(f.name)} — you are @${esc(selfAccount?.username ?? '?')}</div>`);
      } else if (/tweets?/i.test(f.name)) {
        const map = parseMentionMap(text, f.name);
        lines.push(`<div class="good">${esc(f.name)} — ${map.size} handle(s) learned from mentions</div>`);
      } else {
        lines.push(`<div class="muted">${esc(f.name)} — not used</div>`);
      }
    } catch (err) {
      const cls = err instanceof ForbiddenFileError ? 'warn' : 'muted';
      lines.push(`<div class="${cls}">${esc(f.name)} — ${esc((err as Error).message)}</div>`);
    }
  }

  if (skipped) lines.push(`<div class="muted">${skipped} malformed entr${skipped === 1 ? 'y' : 'ies'} skipped</div>`);
  out.innerHTML = lines.join('');

  if (uids.length) showMatches(uids);
}

/* ---------- matching ---------- */

function showMatches(uids: string[]): void {
  const index = __CLAIMANT_INDEX__;
  matches = matchFollowing(uids, index);
  names = new Map(matches.matched.map((m) => [m.pubkey, m.handle]));

  const expected = expectedUniformMatches(uids.length, index.claimants.length);
  const rows = [
    ['Accounts you follow', uids.length],
    ['Matched (verified claim)', matches.matched.length],
    ['Already followed here', matches.alreadyFollowed.length],
    ['Rejected — claim not verified', matches.rejectedUnverified],
    ['No claim on file', matches.unmatched],
  ] as const;

  let html = rows.map(([k, v]) =>
    `<div class="stat"><span class="muted">${k}</span><b>${v}</b></div>`).join('');

  if (matches.matched.length === 0) {
    // Say why. An empty result with no explanation reads as broken rather than
    // early, and the arithmetic is not the user's fault.
    html += `<p class="warn" style="margin:1rem 0 0">
      No matches, and that is expected right now. With ${index.claimants.length} people
      claiming an identity so far, a ${uids.length}-account follow list would
      statistically match ${expected.toFixed(3)} of them.
      This works through density — adoption inside a community that already follows
      each other — not through scale.</p>`;
  } else {
    html += `<ul style="margin:1rem 0 0">${matches.matched.slice(0, 12)
      .map((m) => `<li>@${esc(m.handle)} <span class="muted">→ ${esc(m.npub.slice(0, 16))}…</span></li>`)
      .join('')}</ul>`;
    if (matches.matched.length > 12) {
      html += `<p class="muted">…and ${matches.matched.length - 12} more</p>`;
    }
  }

  if (matches.rejectedUnverified > 0) {
    html += `<p class="muted" style="margin:1rem 0 0">
      Rejected entries claim an X account without a verified proof. Matching them
      would let anyone claim a popular account and be auto-followed.</p>`;
  }

  $('match-out').innerHTML = html;
  $('match-card').hidden = false;
  $('save-card').hidden = matches.matched.length === 0;
}

/* ---------- saving ---------- */

/** Stand-in for the signer. In production this is `window.berm`, and the key
 *  never reaches this page. */
async function fakeEncrypt(_peer: string, plaintext: string): Promise<string> {
  const bytes = new TextEncoder().encode(plaintext);
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return btoa(String.fromCharCode(...iv, ...ct));
}

$('save-private').addEventListener('click', () => { void savePrivate(); });
$('save-public').addEventListener('click', () => { savePublic(); });

async function savePrivate(): Promise<void> {
  if (!matches) return;
  const event = await buildPrivateFollowSet(matches.matched, {
    selfPubkey: 'f'.repeat(64),
    encrypt: fakeEncrypt,
  });

  const leaks = matches.matched.filter((m) =>
    JSON.stringify(event).includes(m.pubkey) || JSON.stringify(event).includes(m.handle));

  $('save-out').innerHTML = `
    <div class="good">Approval prompt would read:</div>
    <pre>${esc(describeGraphEvent(event))}</pre>
    <div class="stat"><span class="muted">Public tags</span><b>${event.tags.map((t) => t[0]).join(', ')}</b></div>
    <div class="stat"><span class="muted">Members visible to a relay</span><b class="${leaks.length ? 'warn' : 'good'}">${leaks.length}</b></div>
    <pre id="event-json">${esc(JSON.stringify(event, null, 2).slice(0, 600))}…</pre>`;
}

function savePublic(): void {
  if (!matches) return;
  const merged = mergePublicContacts([], matches.matched);
  $('save-out').innerHTML = `
    <div class="warn">Approval prompt would read:</div>
    <pre>${esc(describeGraphEvent(merged.event, { added: merged.added.length, kept: merged.kept.length }))}</pre>
    <div class="muted">Nothing has been published. This page cannot reach the network.</div>`;
}
