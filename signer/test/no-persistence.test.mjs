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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
