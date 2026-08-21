import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] ?? 8200);
const html = () => readFileSync(resolve(here, 'dist/xonly-signer.html'), 'utf8');
createServer((req, res) => {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    // Same headers infra/Caddyfile.xonly sets on the signer host.
    'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  });
  res.end(html());
}).listen(port, () => console.log(`signer on http://localhost:${port}`));
