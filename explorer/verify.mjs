import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { startRelay } from './local-relay.mjs';
import { seed } from './seed.mjs';
import { launch } from '../scripts/chromium.mjs';

const html = readFileSync('dist/who.html');
const http = createServer((_,r)=>{r.setHeader('content-type','text/html');r.end(html);}).listen(8104);
const r1=startRelay(7447,'A'), r2=startRelay(7448,'B');

const { ownerNpub, squatNpub } = await seed(['ws://localhost:7447','ws://localhost:7448']);
console.log('seeded two competing claims for @dorian');
console.log('  owner   :', ownerNpub);
console.log('  squatter:', squatNpub, '(back-dated to 2019, unanchored)\n');

const b = await launch(chromium);
const p = await b.newPage({ viewport:{width:900,height:1100}, deviceScaleFactor:2 });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});

const relays = encodeURIComponent('ws://localhost:7447,ws://localhost:7448');
await p.goto(`http://localhost:8104/?relays=${relays}&handle=dorian`,{waitUntil:'networkidle'});
await p.waitForTimeout(4000);

console.log('=== verdict ===');
console.log((await p.textContent('#summary')).replace(/\s+/g,' ').trim());

console.log('\n=== ordering ===');
const cards = await p.$$eval('.claim', els => els.map(e => ({
  name: e.querySelector('.nm').textContent,
  primary: e.classList.contains('primary'),
  pill: e.querySelector('.pill')?.textContent ?? '',
  npub: e.querySelector('dd .brk')?.textContent ?? '',
  caveats: [...e.querySelectorAll('.caveats li')].map(x=>x.textContent.slice(0,70)),
})));
cards.forEach((c,i)=>{
  console.log(`${i+1}. ${c.name}  ${c.primary?'[PRIMARY]':''} ${c.pill}`);
  console.log(`   ${c.npub.slice(0,32)}…`);
  c.caveats.forEach(x=>console.log(`   ! ${x}…`));
});

const first = cards[0].npub;
console.log('\nowner ranked first:', first === ownerNpub ? 'YES' : 'NO  <-- FAIL');
console.log('squatter demoted  :', cards[1]?.npub === squatNpub ? 'YES' : 'NO');

console.log('\n=== unknown handle ===');
await p.fill('#handle','nobodyhasthisname'); await p.click('#go'); await p.waitForTimeout(3500);
console.log((await p.textContent('#empty')).replace(/\s+/g,' ').trim().slice(0,140));

console.log('\nerrors:', errs.length?errs:'none');
await p.fill('#handle','dorian'); await p.click('#go'); await p.waitForTimeout(3500);
await p.screenshot({path:'who.png', fullPage:true});
await b.close(); http.close(); r1.close(); r2.close();
