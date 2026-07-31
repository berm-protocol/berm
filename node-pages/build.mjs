/**
 * Fork this, set three values, get a node.
 *
 * Reads an author's signed events from relays, verifies every signature locally,
 * renders `/@handle/slug` pages with the same `renderLanding()` the rest of the
 * project uses, and writes a static site. Deploy it to GitHub Pages and you are
 * running a node — no server, no database, no PHP.
 *
 *   node build.mjs                 read node.config.json, write dist/
 *   node build.mjs --allow-shrink  publish even if fewer events were fetched
 *
 * WHY THIS EXISTS. A node is a mirror and a witness at the same time. It holds a
 * copy of the author's work that outlives any one host, and the page it serves
 * re-checks itself against relays in the visitor's browser — so a discrepancy
 * shows up in public rather than only to whoever runs the server. That argument
 * gets stronger the more independent nodes exist, which is the whole reason to
 * make one forkable instead of installable.
 *
 * TRUST NOTE, stated rather than implied: forking this means you run the build,
 * from source you can read, on infrastructure you chose. It does not mean you
 * trust us — and if it did, the exercise would be pointless.
 */

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nip19 } from 'nostr-tools';
import WebSocketImpl from 'ws';

// Compiled by prepare.mjs so this runs on a stock Node with no flags.
import {
  collect, shouldPublish, renderLanding, slugOrDigest, pageUrl, normaliseHandle,
} from './lib/berm.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'dist');
const STATE = join(HERE, '.state.json');

// Node has no global WebSocket in every runtime the action might use.
globalThis.WebSocket ??= WebSocketImpl;

const allowShrink = process.argv.includes('--allow-shrink');

/* ---------- config ---------- */
const configPath = join(HERE, 'node.config.json');
if (!existsSync(configPath)) {
  console.error(`\nNo node.config.json. Copy node.config.example.json and set your npub.\n`);
  process.exit(1);
}
const cfg = JSON.parse(await readFile(configPath, 'utf8'));

let pubkeyHex;
try {
  const decoded = nip19.decode(cfg.npub);
  if (decoded.type !== 'npub') throw new Error('not an npub');
  pubkeyHex = decoded.data;
} catch (e) {
  console.error(`\nnode.config.json: "npub" is not a valid npub — ${e.message}\n`);
  process.exit(1);
}

const relays = cfg.relays ?? [];
if (relays.length < 2) {
  // One relay is a single point of failure wearing the costume of a source.
  console.error('\nnode.config.json: list at least two relays.\n');
  process.exit(1);
}

const origin = (cfg.origin ?? '').replace(/\/+$/, '');
const handle = normaliseHandle(cfg.handle ?? 'me');

/* ---------- collect ---------- */
console.log(`\ncollecting for ${cfg.npub.slice(0, 20)}… from ${relays.length} relays`);
const report = await collect({ pubkeyHex, relays, kinds: cfg.kinds ?? [1, 30023] });

for (const [relay, n] of Object.entries(report.rejected)) {
  console.log(`  ! ${relay} served ${n} event(s) that failed verification here — dropped`);
}
for (const r of report.unreachable) console.log(`  · ${r} unreachable`);
for (const r of report.silent) console.log(`  · ${r} had nothing`);

const previous = existsSync(STATE) ? JSON.parse(await readFile(STATE, 'utf8')).count ?? 0 : 0;
const verdict = shouldPublish(report, previous, { allowShrink });
if (!verdict.ok) {
  console.error(`\nREFUSING TO PUBLISH — ${verdict.reason}\n`);
  process.exit(1);
}
console.log(`  ${verdict.reason}`);

/* ---------- render ---------- */
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const manifest = { npub: cfg.npub, relays, files: {} };
const write = async (name, body) => {
  const path = join(OUT, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
  manifest.files[name] = createHash('sha256').update(body).digest('hex');
};

const tagValue = (ev, name) => ev.tags.find((t) => t[0] === name)?.[1];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A kind-1 post's first line, or a NIP-23 article's title. */
const titleOf = (ev) => tagValue(ev, 'title') ?? tagValue(ev, 'subject')
  ?? (ev.content.trim().split('\n')[0] ?? '').slice(0, 90);

const pages = [];

for (const ev of report.events) {
  const title = titleOf(ev) || 'A post';
  const { slug } = slugOrDigest(title, ev.id);
  const canonical = pageUrl(origin || 'https://example.invalid', handle, slug);

  const imeta = ev.tags.find((t) => t[0] === 'imeta');
  const field = (k) => imeta?.find((s) => s.startsWith(`${k} `))?.slice(k.length + 1);

  const html = renderLanding({
    text: ev.content,
    heading: tagValue(ev, 'title') ?? tagValue(ev, 'subject'),
    // Content is carried whole in the event; the node does not reformat it.
    artifact: { kind: 'none', text: '' },
    authorName: cfg.name ?? handle,
    handle: cfg.handle,
    npub: cfg.npub,
    pubkeyHex,
    createdAt: ev.created_at,
    canonicalUrl: canonical,
    nevent: nip19.neventEncode({ id: ev.id, author: pubkeyHex, relays: relays.slice(0, 2) }),
    eventId: ev.id,
    signedContent: ev.content,
    cardUrl: field('url'),
    cardSha256: field('x'),
    cardAlt: field('alt'),
    cardUrls: imeta?.filter((s) => s.startsWith('url ')).map((s) => s.slice(4)),
    // The relays this node actually saw the event on, not the ones it asked.
    relays: ev.seenOn,
    profileUrl: `${origin}/@${encodeURIComponent(handle)}/`,
    ctaUrl: cfg.ctaUrl ?? 'https://xonly.ai',
  }, { hydrateScript: await readFile(join(HERE, 'lib/hydrate.js'), 'utf8') });

  const path = `@${handle}/${slug}.html`;
  await write(path, html);
  pages.push({ path, title, id: ev.id, created_at: ev.created_at, seenOn: ev.seenOn.length });
}

/* ---------- index ---------- */
const index = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(cfg.name ?? handle)}</title>
<style>
:root{--ink:#16181c;--dim:#5b6270;--line:#e6e8ec;--bg:#fff;--accent:#3b5bdb;
      --sans:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,system-ui,sans-serif}
@media(prefers-color-scheme:dark){:root{--ink:#e8eaed;--dim:#9aa1ad;--line:#242832;--bg:#0d0e11;--accent:#7c9cff}}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.65 var(--sans)}
.w{max-width:640px;margin:0 auto;padding:56px 22px 90px}
h1{font-size:30px;margin:0 0 4px;letter-spacing:-.02em}
.sub{color:var(--dim);font-size:15px;margin:0 0 32px}
a.post{display:block;padding:14px 0;border-bottom:1px solid var(--line);text-decoration:none;color:var(--ink)}
a.post:hover .t{color:var(--accent)}
.t{font-weight:600;font-size:17px}
.m{color:var(--dim);font-size:13px;margin-top:3px}
footer{margin-top:44px;padding-top:20px;border-top:1px solid var(--line);color:var(--dim);font-size:13.5px}
code{font:12px ui-monospace,Menlo,Consolas,monospace;word-break:break-all}
</style></head><body><div class="w">
<h1>${esc(cfg.name ?? handle)}</h1>
<p class="sub">${esc(cfg.bio ?? '')}</p>
${pages.map((p) => `<a class="post" href="${esc(p.path)}">
  <div class="t">${esc(p.title)}</div>
  <div class="m">${new Date(p.created_at * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} · seen on ${p.seenOn} relay${p.seenOn === 1 ? '' : 's'}</div>
</a>`).join('')}
<footer>
  This site is a rendering. Every post is signed and stored on Nostr under
  <code>${esc(cfg.npub)}</code> — open any of them in a Nostr client and check for yourself.
  Each page re-verifies itself against relays in your browser.
  File hashes: <a href="manifest.json">manifest.json</a>.
</footer>
</div></body></html>`;

await write('index.html', index);
await write(`@${handle}/index.html`, index);
await write('.nojekyll', '');
await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(STATE, JSON.stringify({ count: report.events.length }, null, 2) + '\n');

console.log(`\nnode → ${OUT}`);
console.log(`  ${pages.length} pages, ${Object.keys(manifest.files).length} files`);
console.log(`  every signature verified locally; ${Object.keys(report.rejected).length} relay(s) served something that failed\n`);
