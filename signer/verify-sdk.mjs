/**
 * The consolidation proof.
 *
 * `verify.mjs` uses a hand-rolled client, so it proves the SIGNER speaks
 * signer/1. This one drives the REAL SDK — `createXnsbSigner` out of
 * `sdk/dist/berm-sdk.global.js` — against the real signer page, across two
 * origins, in a real browser. If the client and the signer ever drift apart,
 * this is the test that fails.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyEvent } from 'nostr-tools/pure';

const here = dirname(fileURLToPath(import.meta.url));
const signerHtml = readFileSync(resolve(here, 'dist/xonly-signer.html'), 'utf8');
const sdkJs = readFileSync(resolve(here, '../sdk/dist/berm-sdk.global.js'), 'utf8');

const SIGNER_PORT = 8241, CLIENT_PORT = 8242;
const SIGNER = `http://localhost:${SIGNER_PORT}`;

const clientHtml = `<!doctype html><meta charset=utf-8><title>client</title><body>
<script>${sdkJs}</script>
<script>
const B = window.berm || window.BermSdk || window.Berm;
window.__mk = () => {
  const f = (B && (B.createXnsbSigner || B.default?.createXnsbSigner));
  if (!f) throw new Error('createXnsbSigner not exported: ' + Object.keys(B || {}).join(','));
  window.sdk = f({ signerOrigin: '${SIGNER}', appName: 'e2e client', relays: [], readyTimeoutMs: 25000 });
  return window.sdk.backend;
};
window.__detect = () => (B.detect ? B.detect({ signer: { signerOrigin: '${SIGNER}' } }) : null);
window.__detectBare = () => (B.detect ? B.detect() : null);
window.__connect = async () => { const s = await window.sdk.connect(); return { tier: s.tier, npub: s.npub, custody: s.custody }; };
window.__sign = async (ev) => { try { return { ok: true, ev: await window.sdk.signEvent(ev) }; }
  catch (e) { return { ok: false, name: e.name, msg: String(e.message || e) }; } };
</script></body>`;

const srv = (port, body) => createServer((_q, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(body);
}).listen(port);

const s1 = srv(SIGNER_PORT, signerHtml), s2 = srv(CLIENT_PORT, clientHtml);
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

const EXEC = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: EXEC });
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('   [client]', m.text()); });
await page.goto(`http://localhost:${CLIENT_PORT}/`, { waitUntil: 'networkidle' });

console.log('signer — REAL SDK client, cross origin\n');

const bare = await page.evaluate(() => window.__detectBare());
t('detect() reports tier 1 UNAVAILABLE with no origin configured',
  bare?.find((x) => x.tier === 1)?.available === false);

const withOrigin = await page.evaluate(() => window.__detect());
t('detect() reports tier 1 available once an origin is named',
  withOrigin?.find((x) => x.tier === 1)?.available === true);

t('the SDK exports the tier-1 client', (await page.evaluate(() => window.__mk())) === 'berm-signer');

const popupPromise = ctx.waitForEvent('page');
const connecting = page.evaluate(() => window.__connect());
const signer = await popupPromise;
await signer.waitForLoadState('networkidle');
t('the SDK opened a top-level popup at the signer origin', new URL(signer.url()).port === String(SIGNER_PORT));

// Create an identity while connect() is polling ping — the real newcomer race.
await signer.click('#go-create');
await signer.fill('#create-pass', 'correct horse battery staple');
await signer.fill('#create-pass2', 'correct horse battery staple');
await signer.click('#create-go');
await signer.waitForSelector('#screen-saved:not([hidden])', { timeout: 25000 });
const npub = (await signer.textContent('#saved-npub'))?.trim() ?? '';
await signer.click('#copy-file');
await signer.click('#saved-continue');
await signer.waitForSelector('#screen-session:not([hidden])');

// connect() should now be waiting on an approval it raised.
await signer.waitForSelector('#approval:not([hidden])', { timeout: 25000 });
await signer.click('#ap-approve');
const session = await connecting;
t('SDK connect() returns a tier-1 session', session.tier === 1);
t('session npub matches what the signer displayed', session.npub === npub);
t('custody line does not claim the key is in this page', !/in this page/i.test(session.custody) && /never enters this page/i.test(session.custody));

const signing = page.evaluate(() => window.__sign(
  { kind: 30023, created_at: 0, tags: [['title', 'Berm protocol']], content: 'body' }));
await signer.waitForSelector('#approval:not([hidden])');
t('SDK-generated human line describes the article, not the method',
  /Publish the article/i.test((await signer.textContent('#ap-human')) ?? ''));
await signer.click('#ap-approve');
const signed = await signing;
t('SDK signEvent returns a signed event', signed.ok === true);
t('signature verifies', signed.ok && verifyEvent(signed.ev));

const refusing = page.evaluate(() => window.__sign({ kind: 1, created_at: 0, tags: [], content: 'no' }));
await signer.waitForSelector('#approval:not([hidden])');
await signer.click('#ap-decline');
const refused = await refusing;
t('a refusal surfaces as UserDeclinedError, not a generic failure',
  refused.ok === false && refused.name === 'UserDeclinedError');

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close(); s1.close(); s2.close();
process.exit(fail === 0 ? 0 : 1);
