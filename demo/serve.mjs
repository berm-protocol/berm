/**
 * Serves the proof page on localhost.
 *
 * WebAuthn requires a secure context, and localhost counts as one. Opening the
 * HTML file directly from disk (file://) works for everything except the
 * passkey flow, which the page detects and reports honestly.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const file = new URL('./dist/berm-live-proof.html', import.meta.url);

createServer((_req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(readFileSync(file));
}).listen(8099, () => {
  console.log('Berm proof page → http://localhost:8099');
  console.log('localhost is a secure context, so the passkey flow is enabled here.');
});
