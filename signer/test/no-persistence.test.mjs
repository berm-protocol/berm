/**
 * The guarantee vault.ts claims, asserted against the BUILT BUNDLE.
 *
 * A comment saying "we never persist the key" is worth nothing. This reads the
 * shipped artifact and fails the build if any persistence API appears in it.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, '../dist/xonly-signer.html'), 'utf8');

const FORBIDDEN = [
  'localStorage', 'sessionStorage', 'indexedDB', 'openDatabase',
  'document.cookie', 'navigator.sendBeacon', 'XMLHttpRequest',
];
const failures = [];
for (const api of FORBIDDEN) if (html.includes(api)) failures.push(api);

// fetch() is allowed nowhere in this bundle either: the signer talks to no network.
if (/\bfetch\s*\(/.test(html)) failures.push('fetch(');

// targetOrigin '*' must never appear in a postMessage call.
if (/postMessage\s*\([^)]*,\s*['"`]\*['"`]\s*\)/.test(html)) failures.push("postMessage(..., '*')");

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

console.log('signer — persistence and egress');
t('no storage or egress API in the shipped bundle', failures.length === 0);
if (failures.length) console.log('       found:', failures.join(', '));
t('bundle contains the vault', html.includes('ncryptsec') || html.includes('scrypt') || html.length > 40000);

// The deployed CSP forbids inline styles. A style attribute anywhere — in the
// markup or injected at runtime via innerHTML — is inert in production, and a
// page that silently loses its styling is worse than one that fails to build.
t('no inline style attribute anywhere in the bundle', !/style="/.test(html));

// The emitted CSP must actually pin this bundle's script, or the page is dead
// on arrival under `script-src 'self'`.
const csp = readFileSync(resolve(here, '../dist/csp.txt'), 'utf8');
t('emitted CSP pins a script hash', /script-src 'self' 'sha256-/.test(csp));
t('emitted CSP pins a style hash', /style-src 'self' 'sha256-/.test(csp));
t('emitted CSP still forbids network egress', /connect-src 'none'/.test(csp));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
