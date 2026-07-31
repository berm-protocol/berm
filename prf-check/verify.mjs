import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const html = readFileSync('dist/prf-check.html');
const srv = createServer((_,r)=>{r.setHeader('content-type','text/html');r.end(html);}).listen(8102,'0.0.0.0');

const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const ctx = await b.newContext();
const page = await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
page.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});

const cdp = await ctx.newCDPSession(page);
await cdp.send('WebAuthn.enable');
const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: {
    protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal',
    hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
    automaticPresenceSimulation: true, hasPrf: true,
  },
});
console.log('virtual authenticator with PRF:', authenticatorId);

await page.goto('http://localhost:8102', { waitUntil:'networkidle' });
await page.click('#run');
await page.waitForTimeout(4000);

const results = await page.$$eval('.check', els => els.map(e => ({
  status: e.className.replace('check ',''),
  name: e.querySelector('.nm').textContent,
  detail: e.querySelector('.det').textContent.replace(/\s+/g,' ').trim().slice(0,150),
  data: e.querySelector('.data')?.textContent,
})));
for (const r of results) {
  console.log(`\n[${r.status.toUpperCase()}] ${r.name}`);
  console.log('  ' + r.detail);
  if (r.data) console.log('  ' + r.data.replace(/\n/g,'\n  ').slice(0,420));
}
console.log('\nsummary:', (await page.textContent('#summary')).replace(/\s+/g,' '));

console.log('\n=== reload persistence ===');
await page.reload({waitUntil:'networkidle'});
await page.click('#persist-btn');
await page.waitForTimeout(2500);
const persist = await page.$$eval('.check', els => {
  const e = els.find(x=>x.querySelector('.nm').textContent.includes('reload'));
  return e ? { s:e.className.replace('check ',''), d:e.querySelector('.det').textContent.replace(/\s+/g,' ').trim(), data:e.querySelector('.data')?.textContent } : null;
});
console.log(`[${persist?.s.toUpperCase()}] ${persist?.d}`);
if (persist?.data) console.log('  '+persist.data.replace(/\n/g,'\n  '));

console.log('\n=== RP-ID scoping: same credential from 127.0.0.1 ===');
const link = await page.getAttribute('#other-host','href');
console.log('cross-origin link:', link);
const page2 = await ctx.newPage();
await page2.goto(link, { waitUntil:'networkidle' });  // link already targets the other host
await page2.click('#scope-btn');
await page2.waitForTimeout(3000);
const scope = await page2.$$eval('.check', els => {
  const e = els.find(x=>x.querySelector('.nm').textContent.includes('scoping'));
  return e ? { s:e.className.replace('check ',''), d:e.querySelector('.det').textContent.replace(/\s+/g,' ').trim(), data:e.querySelector('.data')?.textContent } : null;
});
console.log(`[${scope?.s.toUpperCase()}] ${scope?.d}`);
if (scope?.data) console.log('  '+scope.data.replace(/\n/g,'\n  '));

console.log('\nerrors:', errs.length ? errs : 'none');
await page.screenshot({path:'shot-prf.png', fullPage:true});
await b.close(); srv.close();
