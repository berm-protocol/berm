import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const f = new URL('./dist/who.html', import.meta.url);
createServer((_q,r)=>{r.setHeader('content-type','text/html; charset=utf-8');r.end(readFileSync(f));})
  .listen(8104,()=>console.log('who → http://localhost:8104'));
