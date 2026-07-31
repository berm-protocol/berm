import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { verifyEvent } from 'nostr-tools';
import { startRelay } from './local-relay.mjs';

const html = readFileSync('dist/berm-live-proof.html');
const http = createServer((_,res)=>{res.setHeader('content-type','text/html');res.end(html);}).listen(8099);

console.log('starting two independent relays (each verifies signatures itself)');
const r1 = startRelay(7447, 'relay-A');
const r2 = startRelay(7448, 'relay-B');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
const errs = []; page.on('pageerror', e=>errs.push(e.message));

const url = 'http://localhost:8099/?relays=' + encodeURIComponent('ws://localhost:7447,ws://localhost:7448');
await page.goto(url, { waitUntil:'networkidle' });

await page.click('#soft-btn'); await page.waitForTimeout(300);
const npub = await page.textContent('#id-npub');
console.log('\nbrowser derived identity:', npub);

await page.fill('#post', 'End-to-end: derived in a browser, signed in a browser, verified by two separate relay processes.');
console.log('\npublishing from the browser:');
await page.click('#publish-btn');
await page.waitForTimeout(6000);

console.log('\nrelay responses rendered in the page:');
console.log('  ' + (await page.textContent('#relay-list')).trim().replace(/\s{2,}/g,'  |  '));
console.log('\nverdict:', (await page.textContent('#pub-verdict')).replace(/\s+/g,' ').trim());

console.log('\nreading back over a fresh connection:');
await page.click('#readback-btn');
await page.waitForTimeout(5000);
console.log('  ' + (await page.textContent('#readback-out')).replace(/\s+/g,' ').trim());

const evJson = JSON.parse(await page.textContent('#pub-json'));
console.log('\nindependent re-verification in this Node process:', verifyEvent(evJson));
console.log('relay A stored:', r1.count(), '| relay B stored:', r2.count());

// Negative control: a tampered event must be REJECTED by the relays.
console.log('\nnegative control — sending a tampered event:');
const tampered = { ...evJson, content: evJson.content + ' (tampered)' };
const { WebSocket } = await import('ws');
await new Promise(res => {
  const ws = new WebSocket('ws://localhost:7447');
  ws.on('open', ()=>ws.send(JSON.stringify(['EVENT', tampered])));
  ws.on('message', m => { const d = JSON.parse(m.toString());
    if (d[0]==='OK') { console.log('  relay response: accepted =', d[2], '|', d[3]); ws.close(); res(); } });
});

console.log('\npage errors:', errs.length ? errs : 'none');
await page.screenshot({ path:'shot-publish-ok.png', fullPage:false });
await page.evaluate(()=>document.querySelectorAll('section')[2].scrollIntoView());
await page.waitForTimeout(400);
await page.screenshot({ path:'shot-publish-ok.png' });
await browser.close(); http.close(); r1.close(); r2.close();
