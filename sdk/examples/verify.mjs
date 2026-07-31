/**
 * Proves the hello example works in a real browser against real relays.
 *
 * Unit tests prove the SDK's logic. This proves the thing a stranger actually
 * does: open a page, click twice, get a signed event onto two independent
 * relays. If this is red, the ten-minute promise in the README is a lie.
 *
 * No network egress required — two relays run locally and the page is served
 * from 127.0.0.1, which also exercises the dev signer's origin guard on its
 * permitted path.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { startRelay, ready } from '../test/relay-harness.mjs';
import { launch } from '../../scripts/chromium.mjs';

const PORT = 8111;
const A = startRelay(7811);
const B = startRelay(7812);

const fail = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail.push(name);
};

await Promise.all([ready(A), ready(B)]);

const server = spawn(process.execPath, ['examples/serve.mjs'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 600));

const browser = await launch(chromium);
const page = await browser.newPage();

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('requestfailed', (r) => errors.push(`requestfailed ${r.url()}`));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
page.on('pageerror', (e) => errors.push(String(e)));

const url = `http://127.0.0.1:${PORT}/examples/hello.html`
  + `?relays=${encodeURIComponent(`${A.url},${B.url}`)}`;
await page.goto(url);

console.log('\n=== hello example ===');

check('page loaded on a local origin (dev signer permitted)',
  await page.locator('h1').textContent() === 'hello, sovereign world');

check('dev-signer warning is shown, not hidden',
  /development signer/i.test(await page.locator('#devnote').textContent()));

await page.click('#connect');
await page.waitForFunction(() => document.getElementById('out').textContent.includes('npub1'), null, { timeout: 15000 });

const session = JSON.parse(await page.locator('#out').textContent());
check('connect returned an npub', /^npub1[a-z0-9]{20,}$/.test(session.npub), session.npub);
check('custody line names the risk', /development/i.test(session.custody), session.custody);
check('backend tag updated', (await page.locator('#backend').textContent()) === 'dev');

await page.click('#publish');
await page.waitForFunction(() => document.getElementById('out').textContent.includes('accepted'), null, { timeout: 20000 });

const receipt = JSON.parse(await page.locator('#out').textContent());
check('published to both relays', receipt.accepted.length === 2, receipt.accepted.join(', '));
check('quorum met → success', receipt.success === true);
check("relay A stored it and verified the signature itself", A.has(receipt.eventId));
check("relay B stored it and verified the signature itself", B.has(receipt.eventId));
check('no relay reported a failure', receipt.failed.length === 0, JSON.stringify(receipt.failed));

const rejected = [...A.log(), ...B.log()].filter((l) => l.type === 'EVENT' && !l.valid);
check('no relay saw an invalid signature', rejected.length === 0);

await page.screenshot({ path: 'examples/hello.png', fullPage: true });
check('console clean', errors.length === 0, errors.join(' | '));

await browser.close();
server.kill();
await Promise.all([A.close(), B.close()]);

console.log(`\n${fail.length === 0 ? 'ALL PASS' : `FAILURES: ${fail.join(', ')}`}\n`);
process.exit(fail.length === 0 ? 0 : 1);
