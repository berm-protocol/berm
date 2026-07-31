import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { startRelay } from './local-relay.mjs';

const html = readFileSync('dist/recovery.html');
const http = createServer((_,r)=>{r.setHeader('content-type','text/html');r.end(html);}).listen(8106);
const r1=startRelay(7447,'A'), r2=startRelay(7448,'B');

const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport:{width:840,height:1300}, deviceScaleFactor:2 });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});

await p.goto('http://localhost:8106/?relays='+encodeURIComponent('ws://localhost:7447,ws://localhost:7448'),{waitUntil:'networkidle'});
await p.click('#connect'); await p.waitForTimeout(1200);

const snapshot = async (label) => {
  const v = (await p.textContent('#verdict')).replace(/\s+/g,' ').trim();
  const checks = await p.$$eval('.check', els=>els.map(e=>({
    sev: e.className.replace('check ',''),
    title: e.querySelector('.ct').textContent,
  })));
  console.log(`\n--- ${label} ---`);
  console.log('verdict:', v);
  checks.forEach(c=>console.log(`  [${c.sev.toUpperCase().padEnd(8)}] ${c.title}`));
};

await snapshot('fresh identity, nothing set up');

console.log('\n=== closing gaps one at a time ===');
await p.click('#add-device'); await p.waitForTimeout(400);
await snapshot('after enrolling a second device');

await p.fill('#backup-pass','a-long-enough-passphrase');
await p.click('#download-backup'); await p.waitForTimeout(600);
await snapshot('after downloading a backup');

await p.fill('#guardians','npub1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nnpub1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\nnpub1ccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc');
await p.click('#set-guardians');
await p.waitForSelector('#approval:not(.hidden)');
console.log('\napproval prompt:', await p.textContent('#approval-what'));
await p.click('#approve-yes'); await p.waitForTimeout(4000);
await snapshot('after publishing guardians');

console.log('\n=== short passphrase is rejected ===');
await p.evaluate(()=>localStorage.removeItem('berm_recovery_state'));
await p.reload({waitUntil:'networkidle'}); await p.click('#connect'); await p.waitForTimeout(1200);
await p.fill('#backup-pass','short'); await p.click('#download-backup'); await p.waitForTimeout(400);
console.log('flash:', await p.textContent('#flash'));

console.log('\n=== loss walkthroughs (nothing prepared) ===');
for (const kind of ['x-account','one-device','all-devices','everything']) {
  await p.click(`[data-loss="${kind}"]`); await p.waitForTimeout(350);
  const t = await p.textContent('#path h3');
  const cls = await p.getAttribute('#path','class');
  const steps = await p.$$eval('#path li', l=>l.map(x=>x.textContent));
  console.log(`\n${kind}  ${cls.includes('critical')?'[NOT RECOVERABLE]':''}`);
  console.log(`  ${t}`);
  steps.forEach((s,i)=>console.log(`  ${i+1}. ${s.slice(0,90)}`));
}

console.log('\nerrors:', errs.length?errs:'none');
await p.evaluate(()=>localStorage.removeItem('berm_recovery_state'));
await p.reload({waitUntil:'networkidle'}); await p.click('#connect'); await p.waitForTimeout(1300);
await p.screenshot({path:'recovery.png', fullPage:true});
await b.close(); http.close(); r1.close(); r2.close();
