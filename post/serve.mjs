import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const f = new URL('./dist/xonly-post.html', import.meta.url);
createServer((q, r) => {
  // 204 for the favicon: a 404 in the console makes "console clean" a weaker
  // claim than it looks.
  if (q.url === '/favicon.ico') { r.statusCode = 204; return r.end(); }
  r.setHeader('content-type', 'text/html; charset=utf-8');
  r.end(readFileSync(f));
}).listen(8112, () => console.log('post → http://localhost:8112'));
