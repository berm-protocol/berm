import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { verifyEvent } from 'nostr-tools';
import { startRelay } from './local-relay.mjs';
import { launch } from '../scripts/chromium.mjs';

const html = readFileSync('dist/xonly-editor.html');
const http = createServer((_,r)=>{r.setHeader('content-type','text/html');r.end(html);}).listen(8100);
const r1 = startRelay(7447,'A'), r2 = startRelay(7448,'B');

const b = await launch(chromium);
const page = await b.newPage({ viewport:{width:1440,height:900}, deviceScaleFactor:2 });
const errs = []; page.on('pageerror', e=>errs.push(e.message));
page.on('console', m => { if (m.type()==='error') errs.push('CONSOLE: '+m.text()); });

await page.goto('http://localhost:8100/?relays=' + encodeURIComponent('ws://localhost:7447,ws://localhost:7448'), {waitUntil:'networkidle'});

console.log('=== 1. typing into the editor ===');
await page.fill('#title', 'Your identity should outlive the platform');
await page.fill('#subtitle', 'A short argument for writing things you actually own.');
const first = page.locator('.blockrow .blk').first();
await first.click();
await page.keyboard.type('Every platform made you the same offer.');
await page.keyboard.press('Enter');
await page.keyboard.type('## The part nobody reads');
await page.waitForTimeout(150);
await page.keyboard.press('Enter');
await page.keyboard.type('When a service shuts down, your writing stops existing.');
await page.keyboard.press('Enter');
await page.keyboard.type('- No account, no password, no seed phrase');
await page.waitForTimeout(150);
await page.keyboard.press('Enter');
await page.keyboard.type('Signed by you, stored on an open network');
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await page.keyboard.type('Check it yourself.');
await page.waitForTimeout(400);
console.log('words:', await page.textContent('#stat-words'), '| blocks:', await page.textContent('#stat-blocks'), '| read:', await page.textContent('#stat-mins'));

console.log('\n=== 2. markdown shortcuts produced real block types ===');
const types = await page.$$eval('.blockrow .blk', els => els.map(e => e.className.replace('blk ','')));
console.log('block types:', types.join(', '));

console.log('\n=== 3. serializers ===');
await page.click('.tab[data-pane="output"]');
await page.waitForTimeout(300);
const md = await page.textContent('#out-md');
console.log('--- NIP-23 markdown ---\n' + md);
const draft = JSON.parse(await page.textContent('#out-draftjs'));
console.log('--- DraftJS ---');
console.log('title:', draft.title);
console.log('blocks:', draft.content_state.blocks.map(b=>`${b.type}${b.text?`("${b.text.slice(0,28)}")`:''}`).join('\n        '));
console.log('entityMap keys:', Object.keys(draft.content_state.entityMap).length);

console.log('\n=== 4. identity + approval flow ===');
await page.click('.tab[data-pane="publish"]');
await page.fill('#handle','dorian_handle');
await page.click('#connect');
await page.waitForTimeout(1200);
console.log('npub:', await page.textContent('#who-npub'));
console.log('badge:', await page.textContent('#badge'), '|', await page.textContent('#badge-note'));

console.log('\n=== 5. DECLINE path (must publish nothing) ===');
await page.click('#publish');
await page.waitForSelector('#approval:not(.hidden)');
console.log('approval prompt says:', await page.textContent('#approval-what'));
await page.click('#approve-no');
await page.waitForTimeout(600);
console.log('nostr target:', (await page.textContent('#t-nostr-detail')).trim());
console.log('relay A stored:', r1.count(), '(must be 0)');

console.log('\n=== 6. APPROVE path ===');
await page.click('#publish');
await page.waitForSelector('#approval:not(.hidden)');
await page.click('#approve-yes');
await page.waitForTimeout(6000);
console.log('nostr:', (await page.textContent('#t-nostr-detail')).replace(/\s+/g,' ').trim());
console.log('node :', (await page.textContent('#t-node-detail')).replace(/\s+/g,' ').trim());
console.log('x    :', (await page.textContent('#t-x-detail')).replace(/\s+/g,' ').trim());
console.log('relays stored: A=' + r1.count(), 'B=' + r2.count());

console.log('\n=== 7. card image ===');
await page.click('.tab[data-pane="card"]');
await page.waitForTimeout(500);
const src = await page.getAttribute('#card-img','src');
console.log('card is a real PNG data URL:', src?.startsWith('data:image/png'), '| bytes:', Math.round((src?.length??0)*0.75/1024)+'KB');

console.log('\n=== 8. errors ===');
console.log(errs.length ? errs : 'none');

await page.click('.tab[data-pane="publish"]');
await page.waitForTimeout(300);
await page.screenshot({ path:'shot-editor.png' });
await page.click('.tab[data-pane="card"]');
await page.waitForTimeout(400);
await page.screenshot({ path:'shot-card.png' });

await b.close(); http.close(); r1.close(); r2.close();
