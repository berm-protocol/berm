/** Serve the real bundle under the REAL production CSP and see if it runs. */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

import { readFileSync as rf } from 'node:fs';
// The CSP the build emits — the one that will actually be served.
const CSP_SIGNER = rf('/home/claude/xnsb/signer/dist/csp.txt', 'utf8').trim();
const CSP_EDITOR = rf('/home/claude/xnsb/editor/dist/csp.txt', 'utf8').trim();

const cases = [
  ['signer', '/home/claude/xnsb/signer/dist/xonly-signer.html', CSP_SIGNER, '#go-create'],
  ['editor', '/home/claude/xnsb/editor/dist/xonly-editor.html', CSP_EDITOR, 'body'],
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const [name, file, csp, probe] of cases) {
  const html = readFileSync(file, 'utf8');
  const srv = createServer((_q, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp });
    res.end(html);
  }).listen(0);
  const port = srv.address().port;
  const page = await browser.newPage();
  const violations = [];
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text().slice(0, 110)); });
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);

  // Probe something ONLY the script can produce. [hidden] is static markup and
  // proves nothing — an earlier version of this check used it and was wrong.
  // Probe for something ONLY boot() can produce, per app. Two earlier versions
  // of this check were wrong — [hidden] is static markup, and "the first button
  // has an onclick" is not true of every page.
  const scriptRan = await page.evaluate(() => {
    if (document.querySelector('#go-create')) return Boolean(document.querySelector('#go-create').onclick);
    // editor: boot() renders .blockrow elements into #blocks, and exposes window.berm
    return document.querySelectorAll('.blockrow').length > 0 || typeof window.berm === 'object';
  });
  const styled = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  console.log(`\n${name}  (${csp.match(/script-src [^;]+/)[0]})`);
  console.log(`  inline script executed : ${scriptRan}`);
  console.log(`  body background        : ${styled}`);
  const scriptV = violations.filter((v) => /script-src|Refused to execute/i.test(v));
  const styleV  = violations.filter((v) => /style-src|inline style/i.test(v));
  console.log(`  script-src violations  : ${scriptV.length}`);
  console.log(`  style-src violations   : ${styleV.length}`);
  for (const v of [...scriptV.slice(0, 2), ...styleV.slice(0, 1)]) console.log(`    · ${v}`);
  await page.close(); srv.close();
}
await browser.close();
