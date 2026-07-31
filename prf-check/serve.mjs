/**
 * Serves the harness on 0.0.0.0 so it is reachable at BOTH `localhost` and
 * `127.0.0.1`.
 *
 * That detail is the whole trick for testing RP-ID scoping without deploying
 * anything: a WebAuthn RP ID is the hostname, so those two are different
 * relying parties even on the same port. Create a credential at one, try to use
 * it at the other, and the browser must refuse.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const file = new URL('./dist/prf-check.html', import.meta.url);
const PORT = 8102;

createServer((_req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(readFileSync(file));
}).listen(PORT, '0.0.0.0', () => {
  console.log('PRF hardware check:');
  console.log(`  http://localhost:${PORT}`);
  console.log(`  http://127.0.0.1:${PORT}   <- different RP ID, use for the scoping test`);
  console.log('\nBoth are secure contexts, so WebAuthn works on each.');
});
