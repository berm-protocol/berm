import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { launch } from '../scripts/chromium.mjs';

const html = readFileSync('dist/berm-live-proof.html');
const server = createServer((_, res) => { res.setHeader('content-type','text/html'); res.end(html); }).listen(8099);

const browser = await launch(chromium);
const ctx = await browser.newContext();
const page = await ctx.newPage();

const consoleErrors = [], requests = [], wsUrls = [];
page.on('console', m => { if (m.type()==='error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push('PAGEERROR: '+e.message));
page.on('request', r => requests.push(r.url()));
page.on('websocket', ws => wsUrls.push(ws.url()));

await page.goto('http://localhost:8099', { waitUntil: 'networkidle' });

console.log('--- ACT I (auto-runs on load) ---');
console.log('victim  :', (await page.textContent('#v1-victim')).slice(0,32)+'…');
console.log('attacker:', (await page.textContent('#v1-attacker')).slice(0,32)+'…');
console.log('identical:', (await page.textContent('#v1-victim')) === (await page.textContent('#v1-attacker')));
console.log('rate    :', await page.textContent('#v1-rate'));

console.log('\n--- ACT I with a different X ID ---');
await page.fill('#xid', '44196397');
await page.waitForTimeout(300);
console.log('attacker:', (await page.textContent('#v1-attacker')).slice(0,32)+'…');

console.log('\n--- ACT II (software key; no authenticator in headless) ---');
await page.click('#soft-btn');
await page.waitForTimeout(300);
const npub1 = await page.textContent('#id-npub');
console.log('npub    :', npub1);
console.log('mode    :', await page.textContent('#id-mode'));
console.log('scalar  :', await page.textContent('#id-valid'), '| retry counter:', await page.textContent('#id-attempt'));

console.log('\n--- determinism across a full page reload ---');
await page.reload({ waitUntil: 'networkidle' });
await page.click('#soft-btn');
await page.waitForTimeout(300);
const npub2 = await page.textContent('#id-npub');
console.log('npub    :', npub2);
console.log('SAME    :', npub1 === npub2);

console.log('\n--- audit panel self-recompute ---');
console.log(await page.textContent('#aud-recompute'));
console.log('event id:', await page.textContent('#aud-evid'));

console.log('\n--- binding ---');
await page.fill('#handle', 'dorian_handle');
await page.waitForTimeout(200);
console.log('proof   :', (await page.textContent('#bind-proof')).slice(0,60)+'…');
console.log('states  :', await page.textContent('#state-verified'), '/', await page.textContent('#state-claimed'), '/', await page.textContent('#state-other'));

console.log('\n--- ACT III: real publish to live relays ---');
await page.fill('#post', 'Berm v2 live-proof page: key derived in-browser, signed client-side, published to open relays. Automated verification run.');
await page.click('#publish-btn');
await page.waitForTimeout(16000);
console.log('event id:', await page.textContent('#pub-id'));
console.log('sig     :', await page.textContent('#pub-sig'));
console.log('relays  :\n' + (await page.textContent('#relay-list')).replace(/\s{2,}/g,' | '));
console.log('verdict :', (await page.textContent('#pub-verdict')).replace(/\s+/g,' '));

console.log('\n--- read back from a fresh connection ---');
await page.click('#readback-btn');
await page.waitForTimeout(10000);
console.log(await page.textContent('#readback-out'));

console.log('\n--- SUPPLY CHAIN / EGRESS AUDIT ---');
const external = requests.filter(u => !u.startsWith('http://localhost:8099'));
console.log('HTTP requests to any origin other than this page:', external.length, external.slice(0,5));
console.log('websocket origins opened:', [...new Set(wsUrls)]);
console.log('console errors:', consoleErrors.length ? consoleErrors : 'none');

await page.screenshot({ path: 'shot-full.png', fullPage: true });
await page.setViewportSize({ width: 1100, height: 900 });
await page.evaluate(() => window.scrollTo(0,0));
await page.screenshot({ path: 'shot-hero.png' });
await page.evaluate(() => document.querySelectorAll('section')[0].scrollIntoView());
await page.waitForTimeout(400);
await page.screenshot({ path: 'shot-break.png' });
await page.evaluate(() => document.querySelectorAll('section')[2].scrollIntoView());
await page.waitForTimeout(400);
await page.screenshot({ path: 'shot-publish.png' });

await browser.close(); server.close();
