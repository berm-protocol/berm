import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const f = new URL('./dist/link.html', import.meta.url);
createServer((_q,r)=>{r.setHeader('content-type','text/html; charset=utf-8');r.end(readFileSync(f));})
  .listen(8105,()=>console.log('link → http://localhost:8105'));
