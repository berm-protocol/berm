/**
 * The dispute screen, in a real browser.
 *
 * Unit tests prove `adjudicate()` is right. This proves the page does not
 * quietly improve on it. A screen that renders a stronger claim than the model
 * computed is the exact failure this package exists to prevent, one layer up —
 * and it is invisible to every test that stops at the module boundary.
 *
 * So the assertions here are mostly negative: what must NOT appear on screen.
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { launch } from '../scripts/chromium.mjs';
import { claimPort } from '../scripts/ports.mjs';

const html = readFileSync(new URL('./dist/dispute.html', import.meta.url));
const http = claimPort(
  createServer((q, r) => {
    if (q.url === '/favicon.ico') { r.statusCode = 204; return r.end(); }
    r.setHeader('content-type', 'text/html; charset=utf-8');
    r.end(html);
  }),
  8116, 'the dispute screen suite',
).listen(8116);

const fail = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail.push(name);
};

const b = await launch(chromium);
const page = await b.newPage({ viewport: { width: 1000, height: 1400 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

await page.goto('http://127.0.0.1:8116/');

const text = () => page.locator('body').innerText();
const verdict = () => page.locator('#verdict').getAttribute('data-verdict');
const pick = async (label) => {
  await page.click(`#scenarios button:has-text("${label}")`);
  await page.waitForTimeout(60);
};

console.log('\n=== the default scenario: suspended, re-registered ===');

check('the stake is stated before any argument',
  (await page.locator('#s-handle').textContent()) === '@alice'
  && (await page.locator('#s-bps').textContent()) === '25%');

check('verdict is demonstrable', await verdict() === 'demonstrable');

check('the party WITHOUT the handle is ranked first',
  (await page.locator('.side').first().innerText()).includes('original creator'));

check('and is the one marked as leading',
  await page.locator('.side.lead').count() === 1
  && (await page.locator('.side.lead').innerText()).includes('original creator'));

check('the party holding the handle is labelled as holding it, not as owning it',
  (await text()).includes('holds the handle') && !/owns the handle/i.test(await text()));

check('the archive date is on screen for an operator to check',
  (await text()).includes('2024-03-09'));

console.log('\n=== the counterfactual is always visible ===');

const without = await page.locator('#without').innerText();
check('what Bags sees today is shown beside the record, not instead of it',
  without.length > 40 && (await page.locator('#with').innerText()).length > 40);

check('and it names the missing field rather than gesturing at it',
  /no field in that answer for who held it before/.test(without));

check('no possessive built out of a description — "Whoever holds @alice now\'s"',
  !/now's/.test(await text()));

check('the two panels are side by side, today on the left',
  (await page.locator('.col').first().getAttribute('class')).includes('today'));

console.log('\n=== what the page must never say ===');

check('nothing on the page claims money moved',
  !/\btransferred\b|\bpaid out\b|\bsent funds\b|\byou now receive\b/i.test(await text()));

check('the evidence-not-a-transfer limit is stated in full',
  /evidence, not a transfer/i.test(await text())
  && /Whether Bags acts on a record like this is Bags/i.test(await text()));

check('it does not promise Bags will honour it',
  !/Bags will (honour|honor|accept|recognise|recognize)/i.test(await text()));

check('the word "verified" never describes the dispute outcome',
  !/verdict[^.]*verified/i.test(await text()));

console.log('\n=== the model is not improved on its way to the screen ===');

await pick('never archived');
check('verified-but-unarchived does NOT render as demonstrable',
  await verdict() === 'unresolved', await verdict());

check('and the page says why — a claim today says nothing about the past',
  /says nothing about who held the handle before now/.test(await text()));

check('no side is marked as leading when nothing is demonstrable',
  await page.locator('.side.lead').count() === 0);

await pick('archives the page today');
check('a challenger archiving today is CONTESTED, not defeated and not victorious',
  await verdict() === 'contested', await verdict());

check('the earlier capture is still ranked first',
  (await page.locator('.side').first().innerText()).includes('original creator'));

check('but the page calls it a genuine conflict rather than a win',
  /genuine conflict/.test(await text()));

await pick('Neither side');
check('no evidence on either side is unresolved',
  await verdict() === 'unresolved');

check('and it admits the operator gained nothing',
  /what they would have had anyway/.test(await text()));

check('the fee share follows the scenario',
  (await page.locator('#s-bps').textContent()) === '30%');

console.log('\n=== supply chain ===');

const shipped = html.toString();
check('no external origin in the shipped file',
  !/https?:\/\/(?!x\.com|web\.archive\.org)[a-z0-9.-]+\.[a-z]{2,}/i.test(
    shipped.replace(/<style[\s\S]*?<\/style>/g, '')));

check('no network call at runtime',
  !/\bfetch\(|XMLHttpRequest|WebSocket/.test(shipped));

check(`no page or console errors`, errs.length === 0, errs.join(' | '));

// Back to the scenario that carries the argument. Screenshotting whatever the
// last assertion happened to click gives a picture of the null case.
await pick('suspended');
await page.screenshot({ path: 'dispute.png', fullPage: true });

await b.close();
http.close();

console.log(fail.length ? `\n${fail.length} FAILED\n` : '\nALL PASS\n');
process.exit(fail.length ? 1 : 0);
