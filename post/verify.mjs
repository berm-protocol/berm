/**
 * Browser verification.
 *
 * The unit tests prove the arithmetic. These prove the things only a real browser
 * can: that the card actually rasterises to 1200×630, that a decline publishes
 * nothing, that the counter refuses instead of truncating, and — the one that
 * matters most — that the UI never claims a post reached X.
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { verifyEvent } from 'nostr-tools';
// Imported rather than copied. There are already three near-identical copies of
// this relay in the repo (editor, link, recovery); a fourth would be the same
// mistake the SDK types shim exists to prevent. Hoisting all of them to one
// shared module is a known cleanup, recorded in README rather than silently owed.
import { startRelay } from '../link/local-relay.mjs';
import { launch } from '../scripts/chromium.mjs';
import { claimPort } from '../scripts/ports.mjs';

const html = readFileSync(new URL('./dist/xonly-post.html', import.meta.url));
const http = claimPort(createServer((q, r) => {
  if (q.url === '/favicon.ico') { r.statusCode = 204; return r.end(); }
  r.setHeader('content-type', 'text/html; charset=utf-8');
  r.end(html);
}), 8112, 'the post composer suite').listen(8112);

const r1 = startRelay(7457, 'A');
const r2 = startRelay(7458, 'B');

const b = await launch(chromium);
const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
// x.com is not reachable from this sandbox and must not be. Stubbed so the tab
// resolves and its URL survives — the assertion is about which URL the button
// navigates to, never about X being up. A test that needs the live network is a
// test that stops being run.
await ctx.route('https://x.com/**', (r) =>
  r.fulfill({ status: 200, contentType: 'text/html', body: '<title>x stub</title>' }));
const page = await ctx.newPage();

const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

let pass = 0, fail = 0;
const ck = (name, ok, note = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(58)} ${note}`);
  ok ? pass++ : fail++;
};

const url = 'http://localhost:8112/?relays=' +
  encodeURIComponent('ws://localhost:7457,ws://localhost:7458');
await page.goto(url, { waitUntil: 'networkidle' });

console.log('\nxonly composer — browser checks');
console.log('-'.repeat(74));

/* ---- 1. the counter counts the way X counts ---- */
await page.fill('#text', 'hello world');
await page.waitForTimeout(200);
ck('Latin text: 11 units', (await page.textContent('#count')).startsWith('11 /'),
   await page.textContent('#count'));

await page.fill('#text', 'これは日本語です');
await page.waitForTimeout(200);
ck('CJK charged double (8 chars → 16 units)', (await page.textContent('#count')).startsWith('16 /'),
   await page.textContent('#count'));

await page.fill('#text', 'see xonly.ai now');
await page.waitForTimeout(200);
ck('a bare domain is charged 23, and the note says so',
   /charged at 23 units/.test(await page.textContent('#count-note')));

/* ---- 2. it refuses rather than truncating ---- */
await page.fill('#text', 'a'.repeat(300));
await page.waitForTimeout(250);
ck('over the limit disables the X button', await page.isDisabled('#offer'));
ck('and says how far over', /over/.test(await page.textContent('#intent-msg')),
   (await page.textContent('#intent-msg')).slice(0, 46) + '…');

/* ---- 3. honest advice when no card is needed ---- */
await page.fill('#text', 'just a plain thought');
await page.waitForTimeout(250);
ck('tells the user to just post on X when nothing needs a card',
   /consider just posting it there/i.test(await page.textContent('#advice')));

/* ---- 4. a table becomes a real 1200×630 card ---- */
await page.selectOption('#kind', 'table');
await page.fill('#artifact',
  '| Tier | Depends on |\n| --- | --- |\n| 1 | a DNS name, indefinitely |\n| 2 | hardware you hold |');
await page.fill('#heading', 'Custody, honestly');
await page.fill('#author', 'Dorin');
await page.fill('#handle', 'dorin');
await page.waitForTimeout(700);

const dims = await page.$eval('#card', (i) => ({ w: i.naturalWidth, h: i.naturalHeight, src: i.src }));
// 2x for crispness, and the 1.9:1 aspect X actually cares about is preserved.
ck('card rasterises at 2x the logical 1200×630', dims.w === 2400 && dims.h === 1260, `${dims.w}×${dims.h}`);
ck('aspect ratio still matches what X renders',
   Math.abs(dims.w / dims.h - 1200 / 630) < 0.001, (dims.w / dims.h).toFixed(4));
ck('card is a real PNG data URL', dims.src.startsWith('data:image/png;base64,'), dims.src.slice(0, 22));

const alt = await page.textContent('#alt');
ck('card alt describes the table by shape', /2 columns/.test(alt) && /Tier/.test(alt), alt.slice(0, 44) + '…');

ck('advice now says the card is carrying something X would damage',
   /X would damage/.test(await page.textContent('#advice')));

/* ---- 5. the permalink page carries the REAL table ---- */
const pageSrc = await page.textContent('#page-preview');
ck('permalink page contains a real <table>', pageSrc.includes('<table>'));
ck('permalink page offers copyable markdown', pageSrc.includes('Copy as markdown'));
ck('permalink page asks X for summary_large_image', pageSrc.includes('summary_large_image'));
// The assertion that matters: the declared size must match the BYTES a crawler
// fetches, not the box we laid out in. This started as `content="1200"` and was
// wrong — the file is 2400×1260 — which is exactly the kind of metadata lie a
// unit test cannot see and a browser can.
ck('permalink page declares the card’s ACTUAL pixel size',
   pageSrc.includes(`content="${dims.w}"`) && pageSrc.includes(`content="${dims.h}"`),
   `declared ${dims.w}×${dims.h}`);
ck('permalink page says it is a rendering, not the original',
   /rendering, not the original/.test(pageSrc));

/* ---- 6. nothing is published before signing ---- */
ck('X button is disabled while unsigned', await page.isDisabled('#offer'));
ck('and explains that the durable copy comes first',
   /Sign first/.test(await page.textContent('#intent-msg')));
ck('relays have received nothing yet', r1.events().length === 0 && r2.events().length === 0,
   `A=${r1.events().length} B=${r2.events().length}`);

/* ---- 7. the decline path publishes nothing ---- */
await page.click('#connect');
await page.waitForTimeout(600);
const who = await page.textContent('#who');
ck('dev signer connected on localhost', who.startsWith('npub1'), who.slice(0, 18) + '…');

await page.click('#sign');
await page.waitForSelector('#approval-sheet:not(.hidden)', { timeout: 4000 });
// The signer's own words describe the event. Anything else risks the sheet
// describing something other than what is signed.
const shown = await page.textContent('#approval-what');
ck('the sheet shows the SIGNER’s description of the event',
   /publish/i.test(shown) && shown.length > 20, shown.slice(0, 46).replace(/\n/g, ' ') + '…');
const notShown = await page.textContent('#approval-not');
ck('and states the non-consequence: nothing goes to X by signing',
   /nothing is sent to X/i.test(notShown) && /never confirm/i.test(notShown));
await page.click('#approve-no');
await page.waitForTimeout(900);
ck('a declined signature publishes NOTHING',
   r1.events().length === 0 && r2.events().length === 0, `A=${r1.events().length} B=${r2.events().length}`);
ck('state stays "Not published" after a decline',
   (await page.getAttribute('#state', 'data-s')) === 'draft',
   await page.textContent('#state'));
ck('a decline is not styled as an error', !/error|failed/i.test(await page.textContent('#result')),
   (await page.textContent('#result')).slice(0, 40));

/* ---- 8. accept: signs, publishes to two relays ---- */
await page.click('#sign');
await page.waitForSelector('#approval-sheet:not(.hidden)', { timeout: 4000 });
await page.click('#approve-yes');
await page.waitForTimeout(1500);

ck('published to BOTH relays (one is not published)',
   r1.events().length === 1 && r2.events().length === 1, `A=${r1.events().length} B=${r2.events().length}`);

const ev = r1.events()[0];
ck('the relay independently verified the signature', ev && verifyEvent(ev));
ck('it is kind 1', ev?.kind === 1);
ck('content carries the real markdown table', ev?.content.includes('| Tier | Depends on |'));
// /@handle/slug, matching the node — not /p/<hash>. See src/main.ts permalinkFor.
ck('content carries an /@handle/slug permalink, not an opaque hash path',
   /https:\/\/xonly\.ai\/@dorin\/[^\s]+/.test(ev?.content ?? ''),
   (ev?.content.match(/https:\S+/) ?? [''])[0]);
ck('an r tag points at the permalink', ev?.tags.some((t) => t[0] === 'r'));
ck('imeta declares the card with alt text and real dimensions',
   ev?.tags.some((t) => t[0] === 'imeta' && t.includes('dim 2400x1260') && t.some((s) => s.startsWith('alt '))));
// Without this the image host is trusted; with it the host is a cache.
const imeta = ev?.tags.find((t) => t[0] === 'imeta') ?? [];
const xField = imeta.find((s) => s.startsWith('x '))?.slice(2);
ck('imeta commits to the card sha256', /^[0-9a-f]{64}$/.test(xField ?? ''), (xField ?? '').slice(0, 20) + '…');
ck('the card URL is hash-shaped, so a Nostr client can recover it elsewhere',
   imeta.some((s) => s.startsWith('url ') && s.includes(xField ?? 'nope')));

/* ---- 9. THE RULE: nothing claims the post reached X ---- */
const forbidden = /x_post|posted_to|tweet_id|x_status|published_to_x|shared_to_x/i;
ck('the signed event makes no claim about X', !forbidden.test(JSON.stringify(ev)));
ck('state after signing is "signed", not "posted"',
   (await page.getAttribute('#state', 'data-s')) === 'signed',
   await page.textContent('#state'));
ck('result says the post exists regardless of X',
   /whether or not you post it to X/.test(await page.textContent('#result')));

/* ---- 10. offering the X composer ---- */
const href = await page.getAttribute('#offer', 'data-href');
ck('X button is now enabled', !(await page.isDisabled('#offer')));
ck('the share link is a plain intent URL', href?.startsWith('https://x.com/intent/tweet?'), (href ?? '').slice(0, 40) + '…');
ck('it contains no token, key or API endpoint',
   !/api\.x\.com|bearer|access_token|oauth/i.test(href ?? ''));
ck('the permalink rides in url=, not glued into the text',
   new URL(href).searchParams.get('url')?.includes('/@dorin/'),
   new URL(href).searchParams.get('url') ?? '(none)');

const popup = page.context().waitForEvent('page');
await page.click('#offer');
const opened = await popup;
ck('clicking opens X’s composer in a new tab', opened.url().startsWith('https://x.com/intent/tweet?'),
   opened.url().slice(0, 38) + '…');
await opened.close();
await page.waitForTimeout(300);

const label = await page.textContent('#state');
ck('state becomes "offered" — never "posted to X"',
   (await page.getAttribute('#state', 'data-s')) === 'offered' && /cannot confirm/i.test(label), label);
ck('no extra event was published by opening the composer',
   r1.events().length === 1, `A=${r1.events().length}`);

/* ---- 11. the artifact never leaked an X credential into the bundle ---- */
ck('shipped page references no X API endpoint',
   !/api\.x\.com/.test(html.toString()));

/* ---- 12. console clean ---- */
ck('no page errors or console errors', errs.length === 0, errs.slice(0, 2).join(' | '));

console.log('-'.repeat(74));
console.log(`  ${pass} passed, ${fail} failed\n`);

await ctx.close();
await b.close();
http.close();
r1.close();
r2.close();
process.exit(fail ? 1 : 0);
