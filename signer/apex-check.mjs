/** Serve the assembled tree under its own CSP and confirm every page works. */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = '/home/claude/xnsb/public';
const CSP = readFileSync(join(ROOT, 'csp.txt'), 'utf8').trim();
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };

const srv = createServer((q, res) => {
  let p = decodeURIComponent(q.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(ROOT, p);
  if (!existsSync(f)) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream', 'content-security-policy': CSP });
  res.end(readFileSync(f));
}).listen(0);
const port = srv.address().port;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

const paths = ['/', '/docs/', '/docs/why.html', '/who.html', '/import.html', '/prf-check.html', '/link.html', '/recovery.html'];
console.log('xonly.ai apex — every page under its own CSP\n');
for (const path of paths) {
  const page = await browser.newPage();
  const v = [];
  // Only an actual block counts. Browsers also warn that `frame-ancestors` in a
  // <meta> CSP is ignored — true, advisory, and irrelevant here because the real
  // directive arrives as a header. Counting it would fail a page that works.
  page.on('console', (m) => { if (/^Refused to /i.test(m.text())) v.push(m.text().slice(0, 90)); });
  await page.goto(`http://localhost:${port}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const styled = await page.evaluate(() => getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)');
  const title = await page.title();
  t(`${path.padEnd(20)} styled, 0 CSP violations  "${title.slice(0, 34)}"`, styled && v.length === 0);
  for (const x of v.slice(0, 2)) console.log(`        · ${x}`);
  await page.close();
}
// the front page must actually link to the live origins
const page = await browser.newPage();
await page.goto(`http://localhost:${port}/`);
const links = await page.evaluate(() => [...document.querySelectorAll('a')].map((a) => a.getAttribute('href')));
t('front page links to the signer', links.includes('https://signer.xonly.ai/'));
t('front page links to the editor', links.includes('https://editor.xonly.ai/'));
t('front page links to docs', links.includes('/docs/'));
t('front page links to link', links.includes('/link.html'));
t('front page links to recovery', links.includes('/recovery.html'));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close(); srv.close();
process.exit(fail === 0 ? 0 : 1);
