import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const file = new URL('./dist/xonly-editor.html', import.meta.url);
createServer((_req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(readFileSync(file));
}).listen(8100, () => console.log('XOnly editor → http://localhost:8100'));
