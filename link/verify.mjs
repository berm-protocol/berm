import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { startRelay } from './local-relay.mjs';
import { launch } from '../scripts/chromium.mjs';
import { claimPort } from '../scripts/ports.mjs';

const html = readFileSync('dist/link.html');
const http = claimPort(createServer((_,r)=>{r.setHeader('content-type','text/html');r.end(html);}), 8105, 'the link suite').listen(8105);
const r1=startRelay(7447,'A'), r2=startRelay(7448,'B');

const b = await launch(chromium);
const ctx = await b.newContext({ permissions:['clipboard-read','clipboard-write'] });
const p = await ctx.newPage({ viewport:{width:820,height:1200}, deviceScaleFactor:2 });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});

// Wayback is unreachable from this sandbox (egress policy), so stub the two
// calls the archive module makes. The URL construction and polling logic is
// exercised for real; only the network hop is replaced.
await p.route('**/archive.org/wayback/available**', async (route) => {
  const u = new URL(route.request().url());
  const target = u.searchParams.get('url');
  const now = Math.floor(Date.now()/1000);
  const ts = new Date(now*1000).toISOString().replace(/[-:T]/g,'').slice(0,14);
  await route.fulfill({ status:200, contentType:'application/json', headers:{'access-control-allow-origin':'*'},
    body: JSON.stringify({ archived_snapshots:{ closest:{ available:true, status:'200',
      url:`http://web.archive.org/web/${ts}/${target}`, timestamp: ts } } }) });
});

await p.goto('http://localhost:8105/?relays='+encodeURIComponent('ws://localhost:7447,ws://localhost:7448'),{waitUntil:'networkidle'});

console.log('=== step 1: identity ===');
await p.click('#connect'); await p.waitForTimeout(1200);
console.log((await p.textContent('#step-1-detail')).replace(/\s+/g,' ').trim().slice(0,110));

console.log('\n=== step 2: proof text ===');
console.log('proof :', (await p.textContent('#proof-text')).slice(0,80)+'…');
const intent = await p.getAttribute('#intent-link','href');
console.log('intent:', intent.slice(0,95)+'…');
console.log('is a plain URL, no API:', intent.startsWith('https://x.com/intent/tweet?text='));

console.log('\n=== step 3: URL parsing ===');
for (const [label,u] of [
  ['bad input','not a url'],
  ['twitter.com','https://twitter.com/dorian/status/1789456123456789012'],
  ['mobile + params','https://mobile.x.com/dorian/status/1789456123456789012?s=20&t=abc'],
  ['with /photo/1','https://x.com/dorian/status/1789456123456789012/photo/1'],
]) {
  await p.fill('#post-url', u); await p.waitForTimeout(250);
  const d = (await p.textContent('#step-3-detail')).replace(/\s+/g,' ').trim();
  console.log(`  ${label.padEnd(16)} -> ${d.slice(0,72)}`);
}

console.log('\n=== step 4: archive ===');
await p.click('#archive-btn');
await p.waitForTimeout(3000);
console.log((await p.textContent('#step-4-detail')).replace(/\s+/g,' ').trim().slice(0,150));

console.log('\n=== step 5: publish ===');
await p.fill('#account-id','1234567890');
await p.click('#publish');
await p.waitForSelector('#approval:not(.hidden)');
console.log('approval 1:', await p.textContent('#approval-what'));
await p.click('#approve-yes'); await p.waitForTimeout(900);
await p.waitForSelector('#approval:not(.hidden)');
console.log('approval 2:', await p.textContent('#approval-what'));
await p.click('#approve-yes'); await p.waitForTimeout(5000);
console.log((await p.textContent('#step-5-detail')).replace(/\s+/g,' ').trim().slice(0,140));

console.log('\n=== what landed on the relays ===');
console.log('relay A stored:', r1.count(), 'events');

console.log('\nerrors:', errs.length?errs:'none');
await p.screenshot({path:'link.png', fullPage:true});
await b.close(); http.close(); r1.close(); r2.close();
