/**
 * End-to-end: relays in, static site out — and a forgery that does not get in.
 *
 * The unit tests prove `merge` and `shouldPublish` given inputs. This runs the
 * real build against real relays over real WebSockets, including one relay that
 * serves a validly-shaped event with a broken signature. A node that published
 * that would be laundering a forgery, which is worse than a node that does not
 * exist.
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ck = (name, ok, note = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(58)} ${note}`);
  ok ? pass++ : fail++;
};

/* ---------- an author with three real posts ---------- */
const sk = generateSecretKey();
const pk = getPublicKey(sk);
const npub = nip19.npubEncode(pk);

const posts = [
  { content: 'Custody is not one thing.\n\n| Tier | Depends on |\n| --- | --- |\n| 1 | a DNS name |', at: 1_780_000_300 },
  { content: 'The second post.', at: 1_780_000_200 },
  { content: 'The oldest post.', at: 1_780_000_100 },
].map((p) => finalizeEvent({ kind: 1, created_at: p.at, tags: [], content: p.content }, sk));

// Another author's validly signed event. A relay returning this is answering a
// different question, and it must not appear on this node's site.
const stranger = generateSecretKey();
const strangerEvent = finalizeEvent(
  { kind: 1, created_at: 1_780_000_400, tags: [], content: 'I am not the author of this site.' },
  stranger,
);

// Right author, tampered content — the signature no longer verifies.
const forged = { ...posts[0], content: posts[0].content + ' — tampered' };

function relay(port, name, events) {
  const wss = new WebSocketServer({ port });
  wss.on('connection', (ws) => {
    ws.on('message', (buf) => {
      let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
      if (msg[0] !== 'REQ') return;
      for (const e of events) ws.send(JSON.stringify(['EVENT', msg[1], e]));
      ws.send(JSON.stringify(['EOSE', msg[1]]));
    });
  });
  return { close: () => wss.close(), name };
}

const honestA = relay(7491, 'A', posts);
const honestB = relay(7492, 'B', posts);
const hostile = relay(7493, 'C', [forged, strangerEvent, ...posts]);

const RELAYS = ['ws://localhost:7491', 'ws://localhost:7492', 'ws://localhost:7493'];

const cfgPath = join(HERE, 'node.config.json');
const statePath = join(HERE, '.state.json');
const savedCfg = existsSync(cfgPath) ? readFileSync(cfgPath) : null;
const savedState = existsSync(statePath) ? readFileSync(statePath) : null;
rmSync(statePath, { force: true });

writeFileSync(cfgPath, JSON.stringify({
  npub, handle: 'dorin', name: 'Dorin', bio: 'Testing a node.',
  origin: 'https://dorin.github.io/berm-node', relays: RELAYS, kinds: [1],
}, null, 2));

console.log('\nnode-pages — end to end');
console.log('-'.repeat(74));

/**
 * Async on purpose.
 *
 * The relays below live in THIS process, and `spawnSync` blocks this process's
 * event loop — so a synchronous spawn leaves the WebSocket servers unable to
 * accept the connection the child is making, and every relay reads as
 * unreachable. The first version of this file did exactly that and looked like
 * a build failure.
 */
const run = (args = []) =>
  new Promise((resolve) => {
    const c = spawn('node', ['build.mjs', ...args], { cwd: HERE });
    let stdout = '', stderr = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.stderr.on('data', (d) => { stderr += d; });
    c.on('close', (status) => resolve({ status, stdout, stderr }));
  });

/* ---- 1. the build ---- */
let r = await run();
const out = r.stdout + r.stderr;
ck('build succeeds against live relays', r.status === 0, `exit ${r.status}`);
ck('it reports the hostile relay served events that failed verification',
   /7493 served \d+ event\(s\) that failed verification/.test(out),
   (out.match(/7493 served [^\n]*/) ?? [''])[0].slice(0, 46));

/* ---- 2. what reached the site ---- */
const manifest = JSON.parse(readFileSync(join(HERE, 'dist/manifest.json'), 'utf8'));
const files = Object.keys(manifest.files);
ck('one page per verified post, and no more',
   files.filter((f) => f.startsWith('@dorin/') && f.endsWith('.html') && !f.endsWith('index.html')).length === 3,
   `${files.length} files`);

const all = files.filter((f) => f.endsWith('.html'))
  .map((f) => readFileSync(join(HERE, 'dist', f), 'utf8')).join('\n');

ck('the FORGED post is absent', !all.includes('— tampered'));
ck('the STRANGER’s post is absent', !all.includes('I am not the author of this site'));
ck('the author’s real posts are present',
   posts.every((p) => all.includes(p.content.split('\n')[0])));

/* ---- 3. the page still carries its own verifier ---- */
const one = readFileSync(join(HERE, 'dist', files.find((f) => /@dorin\/.+\.html/.test(f) && !f.endsWith('index.html'))), 'utf8');
ck('rendered pages ship the hydration script', one.includes('__bermVerdict'));
ck('and start unresolved rather than pre-verified',
   one.includes('data-state="checking"') && !one.includes('data-state="verified"'));
ck('the nevent exit is on the page', /nevent1[a-z0-9]{20,}/.test(one));
ck('relays listed are the ones the event was SEEN on', one.includes('ws://localhost:7491'));

/* ---- 4. transparency ---- */
ck('every file is hashed in the manifest',
   files.every((f) => /^[0-9a-f]{64}$/.test(manifest.files[f])));
ck('a hash in the manifest matches the file on disk', (() => {
  const f = files[0];
  const h = spawnSync('sha256sum', [join(HERE, 'dist', f)], { encoding: 'utf8' }).stdout.split(' ')[0];
  return h === manifest.files[f];
})());
ck('the index tells a reader to check elsewhere',
   readFileSync(join(HERE, 'dist/index.html'), 'utf8').includes('open any of them in a Nostr client'));

/* ---- 5. the truncation guard ---- */
// Two relays vanish. The build still "succeeds" at fetching — from one relay —
// and would replace a 3-post archive with a 3-post archive. Force the shrink by
// telling the state file we previously had more.
writeFileSync(statePath, JSON.stringify({ count: 99 }));
r = await run();
ck('a build that would shrink the archive REFUSES to publish', r.status !== 0, `exit ${r.status}`);
ck('and says why, and how to override',
   /Relays may be down/.test(r.stderr) && /allow-shrink/.test(r.stderr));

r = await run(['--allow-shrink']);
ck('the operator can override deliberately', r.status === 0);

/* ---- 6. no relays at all ---- */
honestA.close(); honestB.close(); hostile.close();
rmSync(statePath, { force: true });
r = await run();
ck('with every relay down it refuses rather than publishing an empty site',
   r.status !== 0 && /refusing to publish an empty site/.test(r.stderr), `exit ${r.status}`);

/* ---- restore ---- */
rmSync(cfgPath, { force: true });
rmSync(statePath, { force: true });
if (savedCfg) writeFileSync(cfgPath, savedCfg);
if (savedState) writeFileSync(statePath, savedState);

console.log('-'.repeat(74));
console.log(`  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
