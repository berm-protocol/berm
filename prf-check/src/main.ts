/**
 * PRF hardware check harness.
 *
 * Runs the ACTUAL production derivation (@berm/crypto) against a real
 * authenticator. Everything else in the project is verified by unit tests;
 * this is the one layer that only a human with hardware can prove.
 *
 * Records a JSON result so a release PR can carry evidence rather than a claim.
 */

import { identityFromPrf, isValidScalar } from '../../crypto/src/derive.js';
import { PRF_SALT_IDENTITY } from '../../crypto/src/constants.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

const $ = (id: string) => document.getElementById(id)!;
const enc = new TextEncoder();

type Status = 'pending' | 'pass' | 'fail' | 'warn' | 'skip';

interface Check {
  id: string;
  name: string;
  status: Status;
  detail: string;
  data?: Record<string, unknown>;
}

const checks: Record<string, Check> = {};

function setCheck(id: string, name: string, status: Status, detail: string, data?: Record<string, unknown>) {
  checks[id] = { id, name, status, detail, data };
  render();
}

const LABEL: Record<Status, string> = {
  pending: '…', pass: 'PASS', fail: 'FAIL', warn: 'WARN', skip: 'SKIP',
};

function render() {
  const host = $('checks');
  host.innerHTML = '';
  for (const c of Object.values(checks)) {
    const row = document.createElement('div');
    row.className = `check ${c.status}`;
    row.innerHTML =
      `<div class="hd"><span class="tag">${LABEL[c.status]}</span><span class="nm">${c.name}</span></div>` +
      `<div class="det">${c.detail}</div>` +
      (c.data ? `<pre class="data">${escapeHtml(JSON.stringify(c.data, null, 2))}</pre>` : '');
    host.appendChild(row);
  }
  const total = Object.values(checks).length;
  const passed = Object.values(checks).filter((c) => c.status === 'pass').length;
  const failed = Object.values(checks).filter((c) => c.status === 'fail').length;
  $('summary').innerHTML =
    `<strong>${passed}</strong> passed · <strong class="${failed ? 'bad' : ''}">${failed}</strong> failed · ${total} run`;
}

function escapeHtml(s: string) {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

/* ══════════════════════════════════════════════════════════════════════
   Storage — credential registry, keyed by origin
   ══════════════════════════════════════════════════════════════════════ */

const KEY = 'berm_prfcheck';
interface Stored { credentialIdHex: string; npub: string; rpId: string; origin: string; created: number }

function save(s: Stored) { localStorage.setItem(KEY, JSON.stringify(s)); }
function load(): Stored | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; }
}

const hexToBytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
const buf = (u8: Uint8Array) => { const o = new Uint8Array(new ArrayBuffer(u8.length)); o.set(u8); return o; };
const rnd = () => crypto.getRandomValues(new Uint8Array(new ArrayBuffer(32)));

/* ══════════════════════════════════════════════════════════════════════
   E2E-0 — environment probe
   ══════════════════════════════════════════════════════════════════════ */

async function probe() {
  const secure = window.isSecureContext;
  const hasWebAuthn = typeof window.PublicKeyCredential !== 'undefined';

  let platformAuth = false;
  let condMediation = false;
  try {
    platformAuth = await (PublicKeyCredential as any).isUserVerifyingPlatformAuthenticatorAvailable?.() ?? false;
    condMediation = await (PublicKeyCredential as any).isConditionalMediationAvailable?.() ?? false;
  } catch { /* older browsers */ }

  const data = {
    origin: location.origin,
    rpId: location.hostname,
    secureContext: secure,
    webAuthn: hasWebAuthn,
    platformAuthenticator: platformAuth,
    conditionalMediation: condMediation,
    userAgent: navigator.userAgent,
  };

  if (!secure) {
    setCheck('env', 'Environment', 'fail',
      'Not a secure context. WebAuthn needs https:// or localhost — nothing below can run.', data);
    return false;
  }
  if (!hasWebAuthn) {
    setCheck('env', 'Environment', 'fail', 'This browser has no WebAuthn support.', data);
    return false;
  }
  if (!platformAuth) {
    setCheck('env', 'Environment', 'warn',
      'No platform authenticator (Touch ID / Windows Hello / Android). A security key may still work.', data);
    return true;
  }
  setCheck('env', 'Environment', 'pass',
    `Secure context, WebAuthn present, platform authenticator available. RP ID is <code>${location.hostname}</code>.`, data);
  return true;
}

/* ══════════════════════════════════════════════════════════════════════
   E2E-1 — create a credential and confirm PRF is genuinely enabled
   ══════════════════════════════════════════════════════════════════════ */

async function createCredential() {
  setCheck('create', 'E2E-1 · PRF advertised at registration', 'pending', 'Waiting for your authenticator…');
  try {
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: rnd(),
        rp: { id: location.hostname, name: 'Berm PRF check' },
        user: { id: buf(crypto.getRandomValues(new Uint8Array(16))), name: 'prf-check', displayName: 'PRF check' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        extensions: { prf: {} } as any,
      },
    })) as PublicKeyCredential;

    const ext = cred.getClientExtensionResults() as any;
    const enabled = ext?.prf?.enabled;

    if (enabled !== true) {
      setCheck('create', 'E2E-1 · PRF advertised at registration', 'fail',
        'Authenticator reports <code>prf.enabled !== true</code>. This platform cannot do Tier 1. ' +
        'The correct product behaviour is to route the user to a NIP-07 extension or a NIP-46 signer — ' +
        '<strong>never</strong> to a weaker derivation.',
        { prfEnabled: enabled ?? null });
      return null;
    }

    const credentialIdHex = bytesToHex(new Uint8Array(cred.rawId));
    setCheck('create', 'E2E-1 · PRF advertised at registration', 'pass',
      'Credential created with <code>prf.enabled === true</code>.',
      { credentialIdHex, rpId: location.hostname });
    return hexToBytes(credentialIdHex);
  } catch (e: any) {
    setCheck('create', 'E2E-1 · PRF advertised at registration', 'fail',
      `Creation failed: ${escapeHtml(e?.message ?? String(e))}`);
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════
   PRF evaluation using the real production salt
   ══════════════════════════════════════════════════════════════════════ */

async function evaluatePrf(credentialId: Uint8Array): Promise<Uint8Array | null> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: rnd(),
      rpId: location.hostname,
      allowCredentials: [{ id: buf(credentialId), type: 'public-key' }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: buf(enc.encode(PRF_SALT_IDENTITY)) } } } as any,
    },
  })) as PublicKeyCredential | null;

  const first = (assertion?.getClientExtensionResults() as any)?.prf?.results?.first;
  return first ? new Uint8Array(first) : null;
}

/* ══════════════════════════════════════════════════════════════════════
   E2E-1b — PRF actually returns a value; derive with production code
   ══════════════════════════════════════════════════════════════════════ */

async function deriveOnce(credentialId: Uint8Array, checkId: string, name: string) {
  setCheck(checkId, name, 'pending', 'Waiting for your authenticator…');
  try {
    const prfOut = await evaluatePrf(credentialId);
    if (!prfOut) {
      setCheck(checkId, name, 'fail',
        'Authenticator advertised PRF at registration but returned <strong>nothing</strong> at assertion. ' +
        'This is a known failure mode and enrolment must abort rather than work around it.');
      return null;
    }
    if (prfOut.length !== 32) {
      setCheck(checkId, name, 'fail', `PRF returned ${prfOut.length} bytes, expected 32.`);
      return null;
    }

    const id = identityFromPrf(prfOut, credentialId);
    setCheck(checkId, name, 'pass',
      'PRF returned 32 bytes and the production derivation produced a valid identity.', {
        prfOutHex: bytesToHex(prfOut),
        npub: id.npub,
        pubkeyHex: id.pubkeyHex,
        scalarValid: isValidScalar(id.secretKey),
        retryCounter: id.attempt,
      });
    return { prfOut, npub: id.npub };
  } catch (e: any) {
    setCheck(checkId, name, 'fail', `Assertion failed: ${escapeHtml(e?.message ?? String(e))}`);
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════
   E2E-2 — determinism
   ══════════════════════════════════════════════════════════════════════ */

async function checkDeterminism(credentialId: Uint8Array, firstNpub: string) {
  setCheck('determinism', 'E2E-2 · Determinism', 'pending', 'Evaluating a second time — approve again…');
  const second = await deriveOnceQuiet(credentialId);
  if (!second) {
    setCheck('determinism', 'E2E-2 · Determinism', 'fail', 'Second evaluation returned nothing.');
    return;
  }
  const same = second.npub === firstNpub;
  setCheck('determinism', 'E2E-2 · Determinism', same ? 'pass' : 'fail',
    same
      ? 'Two independent evaluations produced the <strong>identical</strong> npub. ' +
        'This is the property that lets someone sign in on a new machine with nothing but a synced passkey.'
      : 'Two evaluations produced <strong>different</strong> identities. Tier 1 is unusable on this platform.',
    { first: firstNpub, second: second.npub });
}

async function deriveOnceQuiet(credentialId: Uint8Array) {
  try {
    const prfOut = await evaluatePrf(credentialId);
    if (!prfOut) return null;
    return { npub: identityFromPrf(prfOut, credentialId).npub };
  } catch { return null; }
}

/* ══════════════════════════════════════════════════════════════════════
   E2E-3 — RP-ID scoping
   ══════════════════════════════════════════════════════════════════════ */

/**
 * The credential to attack from this origin.
 *
 * localStorage is itself origin-scoped — the same principle being tested here —
 * so a credential created at `localhost` is invisible to `127.0.0.1`. The link
 * on the page carries it across in the URL fragment instead. A fragment is
 * never sent to the server, which keeps this a purely local exercise.
 */
function foreignCredential(): Stored | null {
  const frag = new URLSearchParams(location.hash.slice(1));
  const cred = frag.get('cred');
  const rp = frag.get('rp');
  if (cred && rp) {
    return { credentialIdHex: cred, npub: frag.get('npub') ?? '', rpId: rp, origin: '', created: 0 };
  }
  return load();
}

async function checkCrossOrigin() {
  const stored = foreignCredential();
  if (!stored) {
    setCheck('scoping', 'E2E-3 · RP-ID scoping', 'skip',
      'No credential to test with. Run the checks first, then follow the link at the top of the page — ' +
      'it carries the credential id across to the other hostname.');
    return;
  }
  if (stored.rpId === location.hostname) {
    setCheck('scoping', 'E2E-3 · RP-ID scoping', 'skip',
      `That credential was created at <code>${stored.rpId}</code>, which is where you are now. ` +
      `Follow the link at the top of the page and press this button there.`);
    return;
  }

  setCheck('scoping', 'E2E-3 · RP-ID scoping', 'pending',
    `Trying to use a credential created at <code>${stored.rpId}</code> from <code>${location.hostname}</code>…`);

  try {
    const prfOut = await evaluatePrf(hexToBytes(stored.credentialIdHex));
    if (!prfOut) {
      setCheck('scoping', 'E2E-3 · RP-ID scoping', 'pass',
        'The browser refused to return PRF output for a credential belonging to another RP ID.',
        { createdAt: stored.rpId, attemptedFrom: location.hostname });
      return;
    }
    const npub = identityFromPrf(prfOut, hexToBytes(stored.credentialIdHex)).npub;
    setCheck('scoping', 'E2E-3 · RP-ID scoping', 'fail',
      '<strong>The credential worked across origins.</strong> That contradicts the WebAuthn RP-ID guarantee ' +
      'and would invalidate the single-signer-origin argument in §3.2.1. Investigate before shipping.',
      { createdAt: stored.rpId, attemptedFrom: location.hostname, npub });
  } catch (e: any) {
    setCheck('scoping', 'E2E-3 · RP-ID scoping', 'pass',
      `The browser rejected the cross-origin credential, as required: <code>${escapeHtml(e?.name ?? 'error')}</code>. ` +
      `This is exactly why custody must live at one signer origin — a per-site passkey would mean a per-site identity.`,
      { createdAt: stored.rpId, attemptedFrom: location.hostname, error: e?.message });
  }
}

/* ══════════════════════════════════════════════════════════════════════
   E2E-2b — persistence across reload
   ══════════════════════════════════════════════════════════════════════ */

async function checkPersistence() {
  const stored = load();
  if (!stored || stored.rpId !== location.hostname) {
    setCheck('persist', 'E2E-2b · Survives a reload', 'skip', 'Run the full check first, then reload and press this.');
    return;
  }
  setCheck('persist', 'E2E-2b · Survives a reload', 'pending', 'Re-deriving from the stored credential id…');
  const again = await deriveOnceQuiet(hexToBytes(stored.credentialIdHex));
  if (!again) {
    setCheck('persist', 'E2E-2b · Survives a reload', 'fail', 'Could not evaluate PRF for the stored credential.');
    return;
  }
  const same = again.npub === stored.npub;
  setCheck('persist', 'E2E-2b · Survives a reload', same ? 'pass' : 'fail',
    same
      ? 'Same npub after a full page reload. Nothing was persisted server-side, because nothing needs to be.'
      : 'Different npub after reload — the derivation is not stable on this platform.',
    { before: stored.npub, after: again.npub });
}

/* ══════════════════════════════════════════════════════════════════════
   Runner
   ══════════════════════════════════════════════════════════════════════ */

async function runAll() {
  const btn = $('run') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Running…';

  const ok = await probe();
  if (ok) {
    const credentialId = await createCredential();
    if (credentialId) {
      const first = await deriveOnce(credentialId, 'derive', 'E2E-1b · PRF returns usable entropy');
      if (first) {
        save({
          credentialIdHex: bytesToHex(credentialId),
          npub: first.npub,
          rpId: location.hostname,
          origin: location.origin,
          created: Date.now(),
        });
        refreshOtherLink();
        await checkDeterminism(credentialId, first.npub);
      }
    }
  }

  setCheck('egress', 'E2E-5 · No key egress', 'warn',
    'Confirm by hand: open the Network tab, re-run, and check that <strong>no request carries</strong> ' +
    '<code>prf_out</code>, the secret key, or the nsec. This page makes zero network requests of its own — ' +
    'anything you see is not from here.');

  btn.disabled = false;
  btn.textContent = 'Run again';
  $('export-row').classList.remove('hidden');
}

function exportJson() {
  const report = {
    generatedAt: new Date().toISOString(),
    origin: location.origin,
    rpId: location.hostname,
    userAgent: navigator.userAgent,
    checks: Object.values(checks),
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `prf-check-${location.hostname}-${Date.now()}.json`;
  a.click();
}

function otherHostUrl(): string {
  const other = location.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
  const base = `${location.protocol}//${other}:${location.port}${location.pathname}`;
  const s = load();
  if (!s) return base;
  const frag = new URLSearchParams({ cred: s.credentialIdHex, rp: s.rpId, npub: s.npub });
  return `${base}#${frag}`;
}

function refreshOtherLink() {
  const a = $('other-host') as HTMLAnchorElement;
  a.href = otherHostUrl();
  a.textContent = otherHostUrl().split('#')[0]! + (load() ? '  (credential attached)' : '');
}

function boot() {
  $('this-rp').textContent = location.hostname;
  refreshOtherLink();

  // Arriving with a credential from the other hostname? Run the test straight away.
  if (location.hash.includes('cred=')) {
    setCheck('scoping', 'E2E-3 · RP-ID scoping', 'pending',
      'A credential from the other hostname was passed in. Press <strong>Test RP-ID scoping</strong> to try using it here.');
  }

  $('run').addEventListener('click', runAll);
  $('scope-btn').addEventListener('click', checkCrossOrigin);
  $('persist-btn').addEventListener('click', checkPersistence);
  $('export').addEventListener('click', exportJson);
  $('reset').addEventListener('click', () => { localStorage.removeItem(KEY); location.reload(); });

  probe();
}

document.addEventListener('DOMContentLoaded', boot);
