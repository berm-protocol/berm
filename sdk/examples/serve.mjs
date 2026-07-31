/**
 * Serves examples/ and dist/ on localhost so the dev signer's origin guard is
 * satisfied and localStorage behaves the way it will in production.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT ?? 8110);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');

  // Browsers ask for this unprompted. A 404 in the console during a first-run
  // demo makes people think they broke something.
  if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }

  const rel = url.pathname === '/' ? '/examples/hello.html' : url.pathname;

  // Normalise before joining, or `..` walks out of the project.
  const path = join(ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!path.startsWith(ROOT)) { res.writeHead(403).end('nope'); return; }

  try {
    const body = await readFile(path);
    const ext = path.slice(path.lastIndexOf('.'));
    res.writeHead(200, { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end(`Not found: ${rel}\nRun \`npm run bundle\` first if dist/ is missing.\n`);
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`hello example → http://127.0.0.1:${PORT}`);
});
