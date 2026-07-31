import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const js = readFileSync(new URL('./dist/hydrate.js', import.meta.url), 'utf8');
createServer((q, r) => {
  if (q.url === '/favicon.ico') { r.statusCode = 204; return r.end(); }
  r.setHeader('content-type', 'text/html; charset=utf-8');
  r.end(`<!doctype html><title>landing demo</title><p>Run <code>npm run verify</code>.</p><script>${js}</script>`);
}).listen(8114, () => console.log('landing → http://localhost:8114'));
