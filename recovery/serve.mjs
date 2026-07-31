/**
 * Local static server for dist/recovery.html.
 *
 * The page is a single file, so this is the whole server. It exists because
 * WebAuthn, WebCrypto and localStorage all behave differently under file://
 * than under http://, and you want to develop against the behaviour you ship.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8106);
const FILE = join(HERE, 'dist', 'recovery.html');

createServer(async (req, res) => {
  try {
    const html = await readFile(FILE);
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      // Always fresh: a cached build during development is a bug hunt that
      // ends in embarrassment.
      'cache-control': 'no-store',
    });
    res.end(html);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not built yet — run `npm run build` first.\n');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`recovery → http://127.0.0.1:${PORT}`);
});
