/**
 * Two origins, deliberately.
 *
 *   /import          the sealed page — CSP connect-src 'none'
 *   /a/<address>     an article page — identical bytes for every reader
 *   /widget.js       the client-side intersection
 *
 * In production these are separate hosts. Here they share a port so the
 * verifier can exercise both, and the CSP is applied per-path so the sealed
 * page really is sealed.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { renderArticle } from './node-render.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8120);

const ARTICLE = {
  address: '30023:abcd1234:on-sovereignty',
  title: 'Your identity should outlive the platform',
  html: '<p>An account you do not control is a lease, not a home.</p>',
  author: 'abcd1234',
};

/** Public reaction set. Loaded from a fixture so the verifier can assert the
 *  exact bytes; in production the reconcile job writes this. */
const reactions = JSON.parse(
  await readFile(resolve(HERE, 'fixtures/reactions.json'), 'utf8'),
);

const WIDGET = `
// Intersection happens HERE, in the reader's browser, against a follow list the
// node never sees. No network call: the reaction set is already in the page.
(function () {
  var el = document.getElementById('berm-reactions');
  if (!el) return;
  var data = JSON.parse(el.textContent);
  var follows = new Set(JSON.parse(localStorage.getItem('berm_follows') || '[]'));
  var names = new Map(JSON.parse(localStorage.getItem('berm_names') || '[]'));

  var buckets = { 7: 'reacted', 1111: 'commented', 10003: 'bookmarked', 6: 'reposted' };
  var seen = {}, everyone = new Set();
  data.events.forEach(function (ev) {
    if (!follows.has(ev.pubkey)) return;
    var k = buckets[ev.kind];
    if (!k) return;
    (seen[k] = seen[k] || new Set()).add(ev.pubkey);
    everyone.add(ev.pubkey);
  });

  var out = document.getElementById('social-proof');
  if (!everyone.size) return;              // render nothing rather than a zero
  var parts = Object.keys(seen).map(function (k) { return seen[k].size + ' ' + k; });
  var first = names.get(everyone.values().next().value);
  var who = first
    ? (everyone.size === 1 ? '@' + first : '@' + first + ' and ' + (everyone.size - 1) + ' other' + (everyone.size > 2 ? 's' : ''))
    : everyone.size + ' people you follow';
  out.textContent = who + ' \\u00b7 ' + parts.join(' \\u00b7 ');
  out.hidden = false;
})();
`;

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const p = url.pathname;

  if (p === '/favicon.ico') { res.writeHead(204).end(); return; }

  if (p === '/widget.js') {
    res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
    res.end(WIDGET);
    return;
  }

  if (p === '/' || p.startsWith('/import')) {
    try {
      const [html, csp] = await Promise.all([
        readFile(resolve(HERE, 'dist/import.html'), 'utf8'),
        readFile(resolve(HERE, 'dist/csp.txt'), 'utf8'),
      ]);
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': csp.trim(),
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      });
      res.end(html);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Run `node build.mjs` first.\n');
    }
    return;
  }

  if (p.startsWith('/a/')) {
    // No cookie is read, no session is consulted, no reader argument is passed.
    // The response is cacheable precisely BECAUSE it cannot be personalised.
    const html = renderArticle(ARTICLE, reactions);
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=60',
    });
    res.end(html);
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found\n');
}).listen(PORT, '127.0.0.1', () => {
  console.log(`import  → http://127.0.0.1:${PORT}/import`);
  console.log(`article → http://127.0.0.1:${PORT}/a/${ARTICLE.address}`);
});
