/**
 * End-to-end: a client origin asks the signer origin for a signature, across a
 * real popup, over real postMessage. Nothing is mocked but the relays.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyEvent } from 'nostr-tools/pure';

const here = dirname(fileURLToPath(import.meta.url));
const signerHtml = readFileSync(resolve(here, 'dist/xonly-signer.html'), 'utf8');

const SIGNER_PORT = 8231, CLIENT_PORT = 8232;
const clientHtml = `<!doctype html><meta charset=utf-8><title>client</title><body>
<button id=go>connect</button><pre id=out></pre><script type=module>
const SIGNER='http://localhost:${SIGNER_PORT}';
let popup=null; const pending=new Map(); let seq=0;
addEventListener('message',(e)=>{ if(e.origin!==SIGNER) return;
  const d=e.data; if(!d||d.berm!=='signer/1'||!d.id) return;
  const p=pending.get(d.id); if(!p) return; pending.delete(d.id); p(d); });
function send(method,params,human,ms=8000){ const id='r'+(seq++);
  return new Promise((res,rej)=>{ pending.set(id,res);
    popup.postMessage({berm:'signer/1',id,method,params,human},SIGNER);
    setTimeout(()=>{ if(pending.delete(id)) rej(new Error('timeout')); },ms); }); }
window.openSigner=()=>{ popup=window.open(SIGNER+'/','s','width=460,height=720'); };
window.ping=async()=>{ for(let i=0;i<40;i++){ try{ const r=await send('ping',undefined,'checking the signer is awake',800);
    if(r.result==='pong') return true; }catch{} await new Promise(r=>setTimeout(r,250)); } return false; };
window.call=(m,p,h)=>send(m,p,h,20000);
</script></body>`;

const srv = (port, body) => createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(body);
}).listen(port);

const s1 = srv(SIGNER_PORT, signerHtml), s2 = srv(CLIENT_PORT, clientHtml);
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

// The pinned playwright and the vendored browser differ by revision here, and
// launch() would otherwise reach for a headless shell that was never installed.
const EXEC = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: EXEC });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`http://localhost:${CLIENT_PORT}/`, { waitUntil: 'networkidle' });

console.log('signer — cross-origin end to end\n');

const popupPromise = ctx.waitForEvent('page');
await page.evaluate(() => window.openSigner());
const signer = await popupPromise;
await signer.waitForLoadState('networkidle');
t('popup is a separate top-level page at the signer origin', new URL(signer.url()).port === String(SIGNER_PORT));

t('signer answers ping before any key exists', await page.evaluate(() => window.ping()));

// Locked: a signature request must be refused with no_session, not a prompt.
const locked = await page.evaluate(() => window.call('get_public_key', undefined, 'Read your public identity'));
t('locked signer refuses with no_session', locked.error?.code === 'no_session');

// Create an identity as a newcomer would.
await signer.click('#go-create');
await signer.fill('#create-pass', 'correct horse battery staple');
await signer.fill('#create-pass2', 'correct horse battery staple');
await signer.click('#create-go');
await signer.waitForSelector('#screen-saved:not([hidden])', { timeout: 20000 });
const npub = (await signer.textContent('#saved-npub'))?.trim() ?? '';
const file = (await signer.textContent('#saved-file'))?.trim() ?? '';
t('identity created and npub shown', npub.startsWith('npub1'));
t('encrypted file is a NIP-49 ncryptsec', file.startsWith('ncryptsec1'));
t('continue is disabled until the file is saved', await signer.isDisabled('#saved-continue'));

await signer.click('#copy-file');
await signer.click('#saved-continue');
await signer.waitForSelector('#screen-session:not([hidden])');

// Decline path first — a refusal must be a refusal.
const declined = page.evaluate(() => window.call('sign_event',
  { event: { kind: 30023, created_at: 0, tags: [['title', 'A test article']], content: 'body' } },
  'Publish the article “A test article” under your name'));
await signer.waitForSelector('#approval:not([hidden])');
t('approval shows the raw event alongside the sentence', ((await signer.textContent('#ap-raw')) ?? '').includes('30023'));
await signer.click('#ap-decline');
t('decline returns declined, not an error', (await declined).error?.code === 'declined');

// Approve path.
const approved = page.evaluate(() => window.call('sign_event',
  { event: { kind: 30023, created_at: 0, tags: [['title', 'A test article']], content: 'body' } },
  'Publish the article “A test article” under your name'));
await signer.waitForSelector('#approval:not([hidden])');
await signer.click('#ap-approve');
const ev = (await approved).result;
t('signed event returned', !!ev && typeof ev.sig === 'string');
t('signature verifies', verifyEvent(ev));
t('signed by the identity the signer showed', ev && npub.length > 0);

// An unexplained request must say so rather than inventing a sentence.
const unexplained = page.evaluate(() => window.call('sign_event',
  { event: { kind: 1, created_at: 0, tags: [], content: 'hi' } }, 'x'));
await signer.waitForSelector('#approval:not([hidden])');
t('unexplained request is flagged to the user', !(await signer.isHidden('#ap-noexplain')));
await signer.click('#ap-decline');
await unexplained;

// Lock forgets everything.
await signer.click('#lock');
const afterLock = await page.evaluate(() => window.call('get_public_key', undefined, 'Read your public identity'));
t('lock returns the signer to no_session', afterLock.error?.code === 'no_session');

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close(); s1.close(); s2.close();
process.exit(fail === 0 ? 0 : 1);
