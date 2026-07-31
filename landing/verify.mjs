/**
 * Browser verification — all three verdicts, produced for real.
 *
 * The unit tests prove the logic given evidence. This produces the evidence over
 * WebSocket from a real browser, against relays that behave honestly, that lie
 * with a valid signature, that forge, and that stay silent. It also proves the
 * two states that only exist at runtime: the page before the script runs, and the
 * page when the script throws.
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { createHash } from 'node:crypto';
import { startRelay } from './relays.mjs';
import { renderLanding } from './dist/render.mjs';
import { launch } from '../scripts/chromium.mjs';
import { claimPort } from '../scripts/ports.mjs';

const hydrateJs = readFileSync(new URL('./dist/hydrate.js', import.meta.url), 'utf8');

/* ---------- an author, and a real signed post ---------- */
const sk = generateSecretKey();
const pk = getPublicKey(sk);

const TABLE_MD = '| Tier | Depends on |\n| --- | --- |\n| 1 | a DNS name, indefinitely |\n| 2 | hardware you hold |';
const CONTENT = `Custody is not one thing.\n\n${TABLE_MD}`;

const event = finalizeEvent(
  { kind: 1, created_at: 1_780_000_000, tags: [['r', 'https://their-site.com/@dorin/custody-honestly']], content: CONTENT },
  sk,
);

// A different post by the same author, validly signed. The "liar" relay serves
// this — the interesting attack, because the cryptography is real and only the id
// gives it away.
const altEvent = finalizeEvent(
  { kind: 1, created_at: 1_780_000_001, tags: [], content: 'Everything is fine, nothing depends on a DNS name.' },
  sk,
);

/* ---------- the card, and a host that will swap it ---------- */
const cardBytes = Buffer.from('PNG-PRETEND-BYTES-' + 'a'.repeat(200));
const cardSha = createHash('sha256').update(cardBytes).digest('hex');
const swappedBytes = Buffer.from('PNG-PRETEND-BYTES-' + 'b'.repeat(200));
let serveSwappedCard = false;

/* ---------- relays ---------- */
const honestA = startRelay(7471, 'A', { mode: 'honest', event });
const honestB = startRelay(7472, 'B', { mode: 'honest', event });
const forger = startRelay(7473, 'F', { mode: 'forger', event });
const silent = startRelay(7474, 'S', { mode: 'silent' });
const liar = startRelay(7475, 'L', { mode: 'liar', altEvent });

/* ---------- a host for the page and the card ---------- */
const HOST = 'http://localhost:8114';
let currentHtml = '';
const http = claimPort(createServer((q, r) => {
  if (q.url === '/favicon.ico') { r.statusCode = 204; return r.end(); }
  if (q.url?.endsWith('.png')) {
    r.setHeader('content-type', 'image/png');
    r.setHeader('access-control-allow-origin', '*');
    return r.end(serveSwappedCard ? swappedBytes : cardBytes);
  }
  r.setHeader('content-type', 'text/html; charset=utf-8');
  r.end(currentHtml);
}), 8114, 'the landing suite').listen(8114);

const nevent = nip19.neventEncode({ id: event.id, author: pk, relays: ['ws://localhost:7471'] });

function pageFor(relays, opts = {}) {
  return renderLanding({
    text: 'Custody is not one thing.',
    heading: 'Custody, honestly',
    artifact: {
      kind: 'table', text: TABLE_MD, header: true,
      rows: [['Tier', 'Depends on'], ['1', 'a DNS name, indefinitely'], ['2', 'hardware you hold']],
    },
    authorName: 'Dorin', handle: 'dorin',
    npub: nip19.npubEncode(pk), pubkeyHex: pk,
    createdAt: 1_780_000_000,
    canonicalUrl: `${HOST}/@dorin/custody-honestly`,
    nevent, eventId: event.id,
    signedContent: opts.renderedContent ?? CONTENT,
    cardUrl: `${HOST}/${cardSha}.png`,
    // `null` means "no committed hash", distinct from omitted-so-use-the-default.
    // `undefined ?? cardSha` silently restored the default, so the case this is
    // meant to exercise was never actually exercised.
    cardSha256: opts.cardSha === null ? undefined : (opts.cardSha ?? cardSha),
    cardSize: { w: 2400, h: 1260 },
    cardAlt: 'Table, 2 columns, 2 data rows',
    cardUrls: [`${HOST}/${cardSha}.png`],
    relays,
    profileUrl: `${HOST}/@dorin`,
    ctaUrl: `${HOST}/editor`,
  }, { hydrateScript: opts.script ?? hydrateJs });
}

/* ---------- run ---------- */
const b = await launch(chromium);
const ctx = await b.newContext({ viewport: { width: 900, height: 1100 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

let pass = 0, fail = 0;
const ck = (name, ok, note = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(60)} ${note}`);
  ok ? pass++ : fail++;
};

const verdict = async () => {
  await page.waitForFunction(
    () => document.getElementById('attest')?.dataset.state !== 'checking',
    null, { timeout: 15000 },
  );
  return page.evaluate(() => ({
    state: document.getElementById('attest').dataset.state,
    line: document.getElementById('vline').textContent,
    detail: document.getElementById('vdetail').textContent,
  }));
};

const load = async (relays, opts) => {
  currentHtml = pageFor(relays, opts);
  await page.goto(`${HOST}/@dorin/custody-honestly`, { waitUntil: 'domcontentloaded' });
};

console.log('\nlanding page — browser checks');
console.log('-'.repeat(78));

/* ---- 1. the content is there before any script runs ---- */
currentHtml = pageFor(['ws://localhost:7471'], { script: '' });
await page.goto(`${HOST}/@dorin/custody-honestly`, { waitUntil: 'domcontentloaded' });
ck('the table is present with no script at all', (await page.locator('table td').count()) > 0,
   `${await page.locator('table td').count()} cells`);
ck('the copyable markdown is present too', await page.locator('details.copy').count() === 1);
ck('and the verdict stays unresolved rather than showing a tick',
   (await page.getAttribute('#attest', 'data-state')) === 'checking',
   await page.textContent('#vline'));

/* ---- 2. content is above the machinery, in the rendered layout ---- */
const boxes = await page.evaluate(() => {
  const y = (s) => document.querySelector(s)?.getBoundingClientRect().top ?? -1;
  return { table: y('table'), attest: y('#attest'), cta: y('.cta') };
});
ck('the table renders ABOVE the verification block and the pitch',
   boxes.table < boxes.attest && boxes.attest < boxes.cta,
   `table ${Math.round(boxes.table)} < attest ${Math.round(boxes.attest)} < cta ${Math.round(boxes.cta)}`);

/* ---- 3. VERIFIED — two honest relays ---- */
await load(['ws://localhost:7471', 'ws://localhost:7472']);
let v = await verdict();
ck('two honest relays → verified', v.state === 'verified', v.line);
ck('the line says the check happened in the visitor’s browser', /in your browser/i.test(v.line), v.line);
ck('signatures were re-verified locally, not taken on trust',
   /confirmed byte-for-byte/i.test(v.detail));

/* ---- 4. UNVERIFIED — one honest relay is not a quorum ---- */
await load(['ws://localhost:7471']);
v = await verdict();
ck('a single relay is NOT enough', v.state === 'unverified', v.line);
ck('and it says how many confirmed', /only 1 of 2/.test(v.detail), v.detail.slice(0, 44) + '…');

/* ---- 5. UNVERIFIED — silence never becomes a pass ---- */
await load(['ws://localhost:7474', 'ws://localhost:7474']);
v = await verdict();
ck('silent relays → unverified, never verified', v.state === 'unverified', v.line);
ck('it offers the visitor a way to check independently', /Nostr client/i.test(v.detail));

/* ---- 6. a forged signature is evidence of NOTHING ---- */
await load(['ws://localhost:7473', 'ws://localhost:7473']);
v = await verdict();
ck('a relay serving a broken signature cannot produce "verified"',
   v.state === 'unverified', v.line);
ck('the forgery is named rather than silently dropped',
   /invalid signature/i.test(v.detail), v.detail.slice(0, 48) + '…');
ck('and the forging relay is identified',
   /localhost:7473/.test(v.detail));

/* ---- 7. a forger cannot dilute two honest relays into a pass ---- */
await load(['ws://localhost:7471', 'ws://localhost:7472', 'ws://localhost:7473']);
v = await verdict();
ck('two honest + one forger is still verified (forgery ignored, not fatal)',
   v.state === 'verified', v.line);

/* ---- 7b. a relay answering a DIFFERENT question does not corroborate ---- */
// The liar serves a validly signed event by the same author — just a different
// post. Real cryptography, wrong id. Only the id check catches this.
await load(['ws://localhost:7475', 'ws://localhost:7475']);
v = await verdict();
ck('a valid signature on a DIFFERENT post does not corroborate',
   v.state === 'unverified', v.line);
ck('and it is not reported as a forgery, because the signature was real',
   !/invalid signature/i.test(v.detail), v.detail.slice(0, 40) + '…');

/* ---- 8. MISMATCH — the page renders something the signature does not say ---- */
await load(['ws://localhost:7471', 'ws://localhost:7472'], {
  renderedContent: CONTENT.replace('a DNS name, indefinitely', 'nothing at all'),
});
v = await verdict();
ck('a page disagreeing with the signed original → MISMATCH', v.state === 'mismatch', v.line);
ck('it tells the visitor to trust the signed copy, not the page',
   /Trust the signed copy, not this page/.test(v.detail));
ck('mismatch is styled as a failure, not a warning',
   (await page.getAttribute('#attest', 'data-state')) === 'mismatch');

/* ---- 9. MISMATCH — the image host swapped the card ---- */
serveSwappedCard = true;
await load(['ws://localhost:7471', 'ws://localhost:7472']);
v = await verdict();
ck('a substituted card image → MISMATCH even though the text verifies',
   v.state === 'mismatch', v.line);
ck('the line names the image as the failing subject', /image/i.test(v.line), v.line);
ck('and says someone with host access replaced it',
   /has replaced it/.test(v.detail));
serveSwappedCard = false;

/* ---- 10. no committed hash → unverified image, not a verified one ---- */
await load(['ws://localhost:7471', 'ws://localhost:7472'], { cardSha: null });
v = await verdict();
ck('a post with no image hash cannot claim a verified image',
   v.state === 'unverified', v.line);

/* ---- 11. the exit is on the page ---- */
await load(['ws://localhost:7471', 'ws://localhost:7472']);
await verdict();
const text = await page.textContent('.exit');
ck('the nevent is printed, so the post resolves elsewhere', text.includes(nevent.slice(0, 24)));
ck('the author npub is printed', text.includes(nip19.npubEncode(pk).slice(0, 20)));
ck('the relays are listed', /ws:\/\/localhost:7471/.test(text));

/* ---- 12. the pitch is present but last, and speaks in capabilities ---- */
ck('the pitch is on the page', /without them turning into mush/.test(await page.textContent('.cta')));
ck('nothing covers the content', await page.evaluate(() => {
  const r = document.querySelector('table').getBoundingClientRect();
  const top = document.elementFromPoint(r.left + 8, r.top + 8);
  return top?.closest('article') !== null;
}));

/* ---- 13. a broken checker fails closed ---- */
await load(['ws://localhost:7471'], { script: 'throw new Error("boom");' });
await page.waitForTimeout(400);
ck('a script that throws leaves the verdict unresolved, never verified',
   (await page.getAttribute('#attest', 'data-state')) === 'checking',
   await page.textContent('#vline'));

/* ---- 14. console ---- */
// The deliberately-broken script in step 13 throws by design.
const real = errs.filter((e) => !/boom/.test(e));
ck('no unexpected page or console errors', real.length === 0, real.slice(0, 2).join(' | '));

console.log('-'.repeat(78));
console.log(`  ${pass} passed, ${fail} failed\n`);

await ctx.close();
await b.close();
http.close();
for (const r of [honestA, honestB, forger, silent, liar]) r.close();
process.exit(fail ? 1 : 0);
