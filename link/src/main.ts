/**
 * Link your X handle — the whole flow, with no API access of any kind.
 *
 *   1. identity          passkey or local key; user never sees a seed phrase
 *   2. post the proof    share intent, a plain URL, no API
 *   3. paste the URL     of the post they just made
 *   4. archive it        Wayback, so the evidence outlives the account
 *   5. sign & publish    kind 0 (NIP-39) + kind 30078 (XOnly attestation)
 *
 * Step 4 is the one people skip and the one that matters most. A proof post
 * dies with the account it lives on, which means the evidence disappears at
 * exactly the moment someone else is using your old handle to impersonate you.
 */

import { nip19 } from 'nostr-tools';
import { createLocalSigner } from './sdk/local-signer.js';
import { UserDeclinedError } from './sdk/types.js';
import type { XnsbSdk, Session, SignedEvent, EventTemplate } from './sdk/types.js';
import {
  checkSnapshot, waitForSnapshot, captureUrl, parsePostUrl,
  type Snapshot, type ParsedPost,
} from './archive.js';

const $ = (id: string) => {
  const el = document.getElementById(id);
  if (!el) { console.error(`[link] missing #${id}`); return document.createElement('div'); }
  return el;
};

const RELAYS = (() => {
  const q = new URLSearchParams(location.search).get('relays');
  if (!q) return undefined;
  const list = q.split(',').map((s) => s.trim()).filter((s) => /^wss?:\/\//.test(s));
  return list.length ? list : undefined;
})();

let sdk: XnsbSdk;
let session: Session | null = null;
let post: ParsedPost | null = null;
let snapshot: Snapshot | null = null;
/** When the user began this flow. Any snapshot older than this is not evidence
 *  of THIS proof, however valid it looks. */
let flowStartedAt = 0;

const esc = (s: string) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };

/* ══════════════════════════════════════════════════════════════════════
   Step plumbing
   ══════════════════════════════════════════════════════════════════════ */

type StepState = 'todo' | 'active' | 'done' | 'warn';

function setStep(n: number, state: StepState, detail?: string): void {
  const el = $(`step-${n}`);
  el.className = `step ${state}`;
  if (detail !== undefined) $(`step-${n}-detail`).innerHTML = detail;
}

function flash(msg: string): void {
  const el = $('flash');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2600);
}

function requestApproval(summary: string): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = $('approval');
    $('approval-what').textContent = summary;
    modal.classList.remove('hidden');
    const done = (ok: boolean) => { modal.classList.add('hidden'); resolve(ok); };
    $('approve-yes').onclick = () => done(true);
    $('approve-no').onclick = () => done(false);
  });
}

/* ══════════════════════════════════════════════════════════════════════
   1 — identity
   ══════════════════════════════════════════════════════════════════════ */

const proofText = (npub: string) => `Verifying my account on nostr My Public Key: "${npub}"`;

async function connect(): Promise<void> {
  const btn = $('connect') as HTMLButtonElement;
  btn.disabled = true; btn.textContent = 'Connecting…';
  setStep(1, 'active');
  try {
    session = await sdk.connect({ preferred: 1 });
    flowStartedAt = Math.floor(Date.now() / 1000);

    setStep(1, 'done',
      `<code class="brk">${esc(session.npub)}</code><br>` +
      `<span class="dim">No seed phrase, no password. This key was derived, not stored.</span>`);
    btn.classList.add('hidden');

    $('proof-text').textContent = proofText(session.npub);
    $('step2-body').classList.remove('hidden');
    setStep(2, 'active');
    updateIntent();
  } catch (e) {
    setStep(1, 'warn', `Could not connect: ${esc((e as Error).message)}`);
    btn.disabled = false; btn.textContent = 'Create identity';
  }
}

/* ══════════════════════════════════════════════════════════════════════
   2 — post the proof
   ══════════════════════════════════════════════════════════════════════ */

function updateIntent(): void {
  if (!session) return;
  const a = $('intent-link') as HTMLAnchorElement;
  a.href = `https://x.com/intent/tweet?text=${encodeURIComponent(proofText(session.npub))}`;
}

async function copyProof(): Promise<void> {
  if (!session) return;
  await navigator.clipboard.writeText(proofText(session.npub));
  flash('Proof text copied');
}

/* ══════════════════════════════════════════════════════════════════════
   3 — paste the post URL
   ══════════════════════════════════════════════════════════════════════ */

function onUrlInput(): void {
  const raw = ($('post-url') as HTMLInputElement).value;
  post = parsePostUrl(raw);

  if (!raw.trim()) { setStep(3, 'active', ''); $('archive-btn').setAttribute('disabled', 'true'); return; }

  if (!post) {
    setStep(3, 'warn',
      'That does not look like a post URL. Expected something like ' +
      '<code>https://x.com/yourhandle/status/1789456123456789012</code>');
    $('archive-btn').setAttribute('disabled', 'true');
    return;
  }

  setStep(3, 'done',
    `handle <strong>@${esc(post.handle)}</strong> · post <code>${esc(post.postId)}</code><br>` +
    `<span class="dim">Canonical form: <code class="brk">${esc(post.canonical)}</code></span>`);
  $('archive-btn').removeAttribute('disabled');
  $('step4-body').classList.remove('hidden');
  setStep(4, 'active');
}

/* ══════════════════════════════════════════════════════════════════════
   4 — archive
   ══════════════════════════════════════════════════════════════════════ */

async function archive(): Promise<void> {
  if (!post) return;
  const btn = $('archive-btn') as HTMLButtonElement;
  btn.disabled = true;

  setStep(4, 'active', 'Checking whether a snapshot already exists…');

  // An old capture of the same URL is not evidence for a post made minutes ago.
  const existing = await checkSnapshot(post.canonical);
  if (existing && existing.capturedAt >= flowStartedAt) {
    snapshot = existing;
    return archived();
  }
  if (existing) {
    setStep(4, 'active',
      `Found a snapshot from ${new Date(existing.capturedAt * 1000).toISOString().slice(0, 10)}, ` +
      `which predates this proof — so it is not evidence for it. Requesting a fresh capture.`);
  }

  // The capture endpoint sends no CORS headers, so a browser cannot submit and
  // read the result. Opening it in a tab lets the user watch it happen and needs
  // no credentials from anyone.
  window.open(captureUrl(post.canonical), '_blank', 'noopener');

  setStep(4, 'active',
    'A Wayback tab is open and capturing. This can take up to a minute — leave it open. ' +
    'Checking every few seconds…');

  snapshot = await waitForSnapshot(post.canonical, {
    newerThan: flowStartedAt,
    onTick: (ms) => setStep(4, 'active',
      `Waiting for the capture to land… ${Math.round(ms / 1000)}s. ` +
      `Leave the Wayback tab open until it finishes.`),
  });

  btn.disabled = false;

  if (!snapshot) {
    setStep(4, 'warn',
      'No snapshot yet. Wayback can be slow or may have declined the capture. ' +
      'You can retry, or continue without it — but the claim will carry a caveat, ' +
      'because the proof post disappears if the account is ever deleted.');
    $('step5-body').classList.remove('hidden');
    setStep(5, 'active');
    return;
  }
  archived();
}

function archived(): void {
  if (!snapshot) return;
  setStep(4, 'done',
    `<a href="${esc(snapshot.url)}" target="_blank" rel="noopener">Snapshot archived</a> ` +
    `<span class="dim">· captured ${new Date(snapshot.capturedAt * 1000).toISOString().replace('T', ' ').slice(0, 16)} UTC</span><br>` +
    `<span class="dim">Held by a third party with no stake in any future dispute. This survives the account being deleted.</span>`);
  $('step5-body').classList.remove('hidden');
  setStep(5, 'active');
  ($('archive-btn') as HTMLButtonElement).disabled = false;
}

async function skipArchive(): Promise<void> {
  snapshot = null;
  setStep(4, 'warn',
    'Skipped. The claim will be published without archived evidence, and every lookup will say so.');
  $('step5-body').classList.remove('hidden');
  setStep(5, 'active');
}

/* ══════════════════════════════════════════════════════════════════════
   5 — sign and publish
   ══════════════════════════════════════════════════════════════════════ */

function buildProfile(): EventTemplate {
  const meta = {
    name: post!.handle,
    display_name: session!.displayName,
    about: '',
  };
  return {
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    // The interoperable claim: a plain NIP-39 `i` tag, so Damus and Amethyst
    // render it without knowing XOnly exists.
    tags: [['i', `twitter:${post!.handle}`, post!.postId]],
    content: JSON.stringify(meta),
  };
}

function buildAttestation(accountId: string): EventTemplate {
  const tags: string[][] = [['d', 'berm:identity:v1']];
  if (accountId) tags.push(['x-account-id', accountId]);
  if (snapshot) {
    tags.push(['proof-snapshot', snapshot.url]);
    tags.push(['snapshot-time', String(snapshot.capturedAt)]);
  }
  tags.push(['observed-at', String(Math.floor(Date.now() / 1000))]);
  tags.push(['i', `twitter:${post!.handle}`, post!.postId]);
  return { kind: 30078, created_at: Math.floor(Date.now() / 1000), tags, content: '' };
}

async function publish(): Promise<void> {
  if (!session || !post) return;
  const btn = $('publish') as HTMLButtonElement;
  btn.disabled = true;

  const accountId = ($('account-id') as HTMLInputElement).value.trim().replace(/\D/g, '');

  setStep(5, 'active', 'Requesting signatures…');
  let profile: SignedEvent, attestation: SignedEvent;
  try {
    profile = await sdk.signEvent(buildProfile());
    attestation = await sdk.signEvent(buildAttestation(accountId));
  } catch (e) {
    setStep(5, 'warn', e instanceof UserDeclinedError
      ? 'You declined. Nothing was published.'
      : `Signing failed: ${esc((e as Error).message)}`);
    btn.disabled = false;
    return;
  }

  setStep(5, 'active', 'Publishing to relays…');
  const r1 = await sdk.publish(profile, RELAYS);
  const r2 = await sdk.publish(attestation, RELAYS);

  btn.disabled = false;

  const ok = r1.success && r2.success;
  setStep(5, ok ? 'done' : 'warn',
    ok
      ? `Published to ${r1.accepted.length} relays. Your claim is live.<br>` +
        `<a href="./who.html?handle=${encodeURIComponent(post.handle)}" target="_blank">Look it up →</a> ` +
        `<span class="dim">· profile <code>${esc(profile.id.slice(0, 16))}…</code></span>`
      : `Only ${Math.min(r1.accepted.length, r2.accepted.length)} relay accepted — the ≥2 rule means ` +
        `this does not count as published. ${esc(r1.failed.map((f) => f.reason).join(', '))}`);

  if (ok) {
    $('done-panel').classList.remove('hidden');
    $('done-npub').textContent = session.npub;
    $('done-handle').textContent = '@' + post.handle;
    $('done-snapshot').innerHTML = snapshot
      ? `<a href="${esc(snapshot.url)}" target="_blank" rel="noopener">archived</a>`
      : '<span class="warn">none — the proof dies with the account</span>';
  }
}

/* ══════════════════════════════════════════════════════════════════════ */

function boot(): void {
  sdk = createLocalSigner({ relays: RELAYS, approve: requestApproval, displayName: 'You' });
  (window as any).berm = sdk;

  $('connect').addEventListener('click', connect);
  $('copy-proof').addEventListener('click', copyProof);
  ($('post-url') as HTMLInputElement).addEventListener('input', onUrlInput);
  $('archive-btn').addEventListener('click', archive);
  $('skip-archive').addEventListener('click', skipArchive);
  $('publish').addEventListener('click', publish);

  setStep(1, 'active');
}

document.addEventListener('DOMContentLoaded', boot);
