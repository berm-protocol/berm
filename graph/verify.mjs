/**
 * The four claims, checked in a real browser against a real server.
 *
 * The unit tests prove the logic. This proves the deployment: that the CSP
 * header actually arrives, that the browser actually refuses an outbound
 * request, that an import completes with the network aborted, and that two
 * readers with different follow lists receive byte-identical pages.
 *
 * A privacy guarantee that holds in vitest and not over HTTP is not a guarantee.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { launch } from '../scripts/chromium.mjs';

const PORT = 8121;
const BASE = `http://127.0.0.1:${PORT}`;

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

const server = spawn(process.execPath, ['serve.mjs'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'ignore', 'inherit'],
});
server.on('exit', (code) => {
  if (code) { console.error(`serve.mjs exited ${code} — port ${PORT} in use?`); process.exit(1); }
});
await new Promise((r) => setTimeout(r, 700));

const browser = await launch(chromium);

const claimants = JSON.parse(readFileSync('fixtures/claimants.json', 'utf8')).claimants;

/* ================================================================ */
console.log('\n=== claim 4: the browser enforces the seal ===');

const ctx1 = await browser.newContext();
const page = await ctx1.newPage();

const response = await page.goto(`${BASE}/import`);
const csp = response.headers()['content-security-policy'] ?? '';
check('CSP header is served', csp.length > 0);
check("connect-src is 'none'", /connect-src\s+'none'/.test(csp), csp.split(';').find((d) => d.includes('connect-src'))?.trim());
check('no wildcard anywhere in the policy', !csp.includes('*'));
check('page reports its own CSP as clean',
  (await page.locator('#csp-badge').textContent()).includes('✓'),
  await page.locator('#csp-badge').textContent());

// The real test: ask the browser to make a request and watch it refuse.
const blocked = await page.evaluate(async () => {
  try { await fetch('https://example.com/exfiltrate'); return 'ALLOWED'; }
  catch (e) { return 'BLOCKED: ' + e.message.slice(0, 60); }
});
check('an outbound fetch is refused by the browser', blocked.startsWith('BLOCKED'), blocked);

// Chromium does not always THROW from the WebSocket constructor under CSP —
// it can fail the connection asynchronously instead. Asserting on the throw
// would have passed on one browser and failed on another, so assert on the
// outcome: it must never open.
const wsBlocked = await page.evaluate(() => new Promise((resolve) => {
  let ws;
  try { ws = new WebSocket('wss://example.com'); }
  catch (e) { return resolve('BLOCKED at construction: ' + e.name); }
  const t = setTimeout(() => resolve('INCONCLUSIVE: neither opened nor errored'), 3000);
  ws.onopen = () => { clearTimeout(t); resolve('ALLOWED — it connected'); };
  ws.onerror = () => { clearTimeout(t); resolve('BLOCKED: connection refused'); };
  ws.onclose = () => { clearTimeout(t); resolve('BLOCKED: closed without opening'); };
}));
check('an outbound WebSocket never opens', wsBlocked.startsWith('BLOCKED'), wsBlocked);

/* ================================================================ */
console.log('\n=== claim 1: import completes with the network aborted ===');

let requestCount = 0;
await page.route('**', (route) => {
  const u = route.request().url();
  if (u.startsWith(BASE)) return route.continue();
  requestCount++;
  return route.abort();
});

const following = `window.YTD.following.part0 = ${JSON.stringify(
  claimants.map((c) => ({ following: { accountId: c.uid, userLink: '' } }))
    .concat([{ following: { accountId: '9999999999', userLink: '' } }]),
)}`;

await page.setInputFiles('#file', {
  name: 'following.js', mimeType: 'text/javascript', buffer: Buffer.from(following),
});
await page.waitForSelector('#match-card:not([hidden])', { timeout: 10000 });

const matchText = await page.locator('#match-out').textContent();
check('import parsed and matched with no external request', requestCount === 0, `${requestCount} external request(s)`);
const flat = matchText.replace(/\s+/g, ' ');
check('matched only verified claimants', /Matched \(verified claim\) ?7/.test(flat), flat.slice(0, 80));
check('rejected the unverified claim', /Rejected . claim not verified ?1/.test(flat));

/* direct messages refused by name */
await page.setInputFiles('#file', {
  name: 'direct-messages.js', mimeType: 'text/javascript', buffer: Buffer.from('window.YTD.direct_messages.part0 = []'),
});
await page.waitForTimeout(300);
check('direct-messages.js refused by name',
  /never parses direct messages/i.test(await page.locator('#import-out').textContent()));

/* ================================================================ */
console.log('\n=== claim 2: the saved list is ciphertext ===');

await page.setInputFiles('#file', {
  name: 'following.js', mimeType: 'text/javascript', buffer: Buffer.from(following),
});
await page.waitForSelector('#save-card:not([hidden])', { timeout: 10000 });
await page.click('#save-private');
await page.waitForSelector('#event-json', { timeout: 10000 });

const saveOut = await page.locator('#save-out').textContent();
const eventJson = await page.locator('#event-json').textContent();

check('prompt names the private consequence', /only you can read it/i.test(saveOut));
check('prompt avoids any publishing verb', !/\bpublish(ed|es|ing)?\b/i.test(
  saveOut.split('Public tags')[0]));
check('zero members visible to a relay',
  /Members visible to a relay ?0/.test(saveOut.replace(/\s+/g, ' ')));

const verified = claimants.filter((c) => c.verified);
check('no member pubkey appears in the event', !verified.some((c) => eventJson.includes(c.pubkey)));
check('no member handle appears in the event', !verified.some((c) => eventJson.includes(c.handle)));
check('no X account id appears in the event', !verified.some((c) => eventJson.includes(c.uid)));

await page.click('#save-public');
await page.waitForTimeout(200);
check('the public option shouts what it does',
  /PUBLISH your follow list publicly and permanently/.test(await page.locator('#save-out').textContent()));

/* ================================================================ */
console.log('\n=== claim 3: two readers, identical bytes ===');

const articleUrl = `${BASE}/a/30023:abcd1234:on-sovereignty`;

async function readAs(follows, names) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.addInitScript(([f, n]) => {
    localStorage.setItem('berm_follows', JSON.stringify(f));
    localStorage.setItem('berm_names', JSON.stringify(n));
  }, [follows, names]);
  const res = await p.goto(articleUrl);
  const body = await res.body();
  await p.waitForTimeout(200);
  const proof = await p.locator('#social-proof').textContent();
  const hidden = await p.locator('#social-proof').getAttribute('hidden');
  await ctx.close();
  return { sha: createHash('sha256').update(body).digest('hex'), proof, hidden };
}

const readerA = await readAs([claimants[0].pubkey], [[claimants[0].pubkey, claimants[0].handle]]);
const readerB = await readAs(
  [claimants[0].pubkey, claimants[2].pubkey, claimants[3].pubkey],
  [[claimants[0].pubkey, claimants[0].handle]],
);
const readerC = await readAs([], []);

check('reader A and reader B receive byte-identical pages', readerA.sha === readerB.sha, readerA.sha.slice(0, 16));
check('reader C (no follows) receives the same bytes too', readerA.sha === readerC.sha);
check('yet each sees a different result', readerA.proof !== readerB.proof,
  `A: "${readerA.proof}" | B: "${readerB.proof}"`);
check('reader A sees one reaction', /1 reacted/.test(readerA.proof), readerA.proof);
check('reader B sees three, named', /and 2 others/.test(readerB.proof), readerB.proof);
check('reader C sees nothing rather than a zero', readerC.hidden !== null && !readerC.proof);

await page.screenshot({ path: 'import.png', fullPage: true });

await browser.close();
server.kill();

console.log(`\n${fails.length === 0 ? 'ALL PASS' : `FAILURES: ${fails.join(', ')}`}\n`);
process.exit(fails.length === 0 ? 0 : 1);
