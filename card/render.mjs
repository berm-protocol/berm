/**
 * X link card renderer — 1200×630.
 *
 * THE CONSTRAINT THAT DEFINES THE DESIGN: X strips the title and description
 * from link cards. What renders in a timeline is the IMAGE plus a small domain
 * label. So the headline is not metadata any more — it is pixels, or it does
 * not exist.
 *
 * That turns a limitation into the one distribution surface we can fully
 * control, and into the only place a table, a code block or a chart can appear
 * in an X timeline at all.
 *
 * THREE RULES, all ToS-driven:
 *   1. Never draw X's verified badge, X's chrome, or anything that mimics X UI.
 *      Trademark misuse and deceptive. Our own visual language, always.
 *   2. Never cloak: the card must reflect what is actually on the page. The
 *      crawler and the reader get the same content.
 *   3. Content-address the image URL. X caches cards hard, so a mutable URL
 *      shows a stale card forever. The event id IS the content hash, so
 *      /card/<event-id>.png is self-invalidating by construction.
 *
 * Rendered with headless Chromium — the same engine that will run in the node,
 * so what you preview is what ships.
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const W = 1200, H = 630;

const BASE = `
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:${W}px; height:${H}px; overflow:hidden;
         font-family:"DejaVu Sans","Liberation Sans",system-ui,sans-serif;
         background:#0b0d10; color:#e6e9ef; position:relative; }
  .frame { position:absolute; inset:0; padding:56px 64px; display:flex; flex-direction:column; }
  .glow { position:absolute; width:760px; height:760px; border-radius:50%;
          background:radial-gradient(circle, rgba(76,141,255,.13), transparent 62%);
          top:-300px; right:-220px; }
  .eyebrow { display:flex; align-items:center; gap:12px; font-size:19px;
             letter-spacing:.14em; text-transform:uppercase; color:#7c88a1; }
  .dot { width:7px; height:7px; border-radius:50%; background:#4c8dff; }
  h1 { font-size:62px; line-height:1.09; letter-spacing:-.022em; font-weight:700;
       margin-top:26px; max-width:19ch; }
  /* X deletes the description too, so the deck also has to be pixels. Without
     it the card is a headline floating in dead space, which reads as an ad. */
  .deck { font-size:27px; line-height:1.45; color:#98a2b6; margin-top:22px; max-width:44ch; }
  .spacer { flex:1; }
  .foot { display:flex; align-items:flex-end; justify-content:space-between; gap:28px; }
  .who { display:flex; align-items:center; gap:16px; }
  .avatar { width:60px; height:60px; border-radius:50%; flex:none;
            background:linear-gradient(135deg,#4c8dff,#8b5cf6); display:flex;
            align-items:center; justify-content:center; font-size:26px; font-weight:700; color:#fff; }
  .name { font-size:25px; font-weight:600; line-height:1.25; }
  /* Our own verification language. Never X's badge, never X's blue. */
  .verified { display:inline-flex; align-items:center; gap:7px; font-size:16px;
              color:#6ee7a8; border:1px solid #24503c; background:#0f1f18;
              border-radius:999px; padding:3px 11px; margin-left:10px; vertical-align:2px; }
  .key { font-family:"DejaVu Sans Mono",ui-monospace,monospace; font-size:16px; color:#7c88a1; margin-top:3px; }
  .meta { text-align:right; font-size:17px; color:#7c88a1; line-height:1.7; white-space:nowrap; }
  .meta b { color:#c7cdd9; font-weight:600; }
  .rule { height:1px; background:linear-gradient(90deg,#1f2531,transparent); margin:26px 0 22px; }
  .brand { position:absolute; bottom:26px; right:64px; font-size:15px;
           letter-spacing:.2em; color:#414c60; text-transform:uppercase; }
`;

/** A — the standard article card. Headline is pixels, because X drops text. */
const article = ({ title, deck, handle, npub, verified, words, published, reactions }) => `
<div class="glow"></div>
<div class="frame">
  <div class="eyebrow"><span class="dot"></span> Signed long-form · Nostr</div>
  <h1>${title}</h1>
  <p class="deck">${deck}</p>
  <div class="spacer"></div>
  <div class="rule"></div>
  <div class="foot">
    <div class="who">
      <div class="avatar">${handle[0].toUpperCase()}</div>
      <div>
        <div class="name">@${handle}${verified ? '<span class="verified">◆ key-verified</span>' : ''}</div>
        <div class="key">${npub}</div>
      </div>
    </div>
    <div class="meta">
      <div><b>${words}</b> words · <b>${Math.ceil(words / 220)}</b> min</div>
      <div><b>${reactions}</b> reactions · ${published}</div>
    </div>
  </div>
</div>
<div class="brand">xonly.ai</div>`;

/**
 * B — the escape hatch as distribution.
 *
 * X Articles strip tables and monospace entirely. A card image does not. This
 * is the only way a formatted table appears in an X timeline, and it is the
 * single most "how did they do that" thing available here.
 */
const table = ({ title, rows, handle }) => `
<div class="glow"></div>
<div class="frame" style="padding:48px 64px">
  <div class="eyebrow"><span class="dot"></span> ${title}</div>
  <table style="margin-top:28px; width:100%; border-collapse:collapse; font-size:24px">
    <thead>
      <tr style="color:#7c88a1; font-size:18px; letter-spacing:.1em; text-transform:uppercase">
        ${rows[0].map((c, i) => `<th style="text-align:${i ? 'right' : 'left'}; padding:0 0 14px">${c}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${rows.slice(1).map((r) => `<tr style="border-top:1px solid #1b202a">
        ${r.map((c, i) => `<td style="text-align:${i ? 'right' : 'left'}; padding:17px 0;
          ${i ? 'font-family:monospace; color:#c7cdd9' : 'font-weight:600'}">${c}</td>`).join('')}
      </tr>`).join('')}
    </tbody>
  </table>
  <div class="spacer"></div>
  <div style="font-size:18px; color:#7c88a1">
    Rendered from a signed event · @${handle} · verify at xonly.ai/who
  </div>
</div>
<div class="brand">xonly.ai</div>`;

/** C — the receipt. A verifiable claim, rendered. */
const receipt = ({ handle, npub, eventId, archived, relays }) => `
<div class="glow"></div>
<div class="frame">
  <div class="eyebrow"><span class="dot"></span> Identity receipt</div>
  <h1 style="font-size:54px; max-width:22ch">@${handle} controls this key.<br>Provably, and after X.</h1>
  <p class="deck" style="max-width:34ch">Checked against a proof post that has been archived by a
    third party. It stays checkable after the account is gone.</p>
  <div class="spacer"></div>
  <div style="display:grid; grid-template-columns:auto 1fr; gap:11px 26px; font-size:19px">
    <div style="color:#7c88a1">key</div>
    <div style="font-family:'DejaVu Sans Mono',monospace; color:#c7cdd9">${npub}</div>
    <div style="color:#7c88a1">proof</div>
    <div style="font-family:'DejaVu Sans Mono',monospace; color:#c7cdd9">${eventId}</div>
    <div style="color:#7c88a1">archived</div>
    <div style="color:#6ee7a8">${archived}</div>
    <div style="color:#7c88a1">relays</div>
    <div style="color:#c7cdd9">${relays}</div>
  </div>
</div>
<div class="brand">xonly.ai</div>`;

/* ------------------------------------------------------------------ */

const CARDS = [
  ['card-article.png', article({
    title: 'Your identity should outlive the platform',
    deck: 'An account you do not control is a lease, not a home. Here is what it costs to fix that, and what it does not fix.',
    handle: 'dorian',
    npub: 'npub1fn27skur6m05z747px3epnlclf8etedhahky9zxrwxad8gll2lm',
    verified: true,
    words: 1840,
    published: '26 Jul 2026',
    reactions: 127,
  })],
  ['card-table.png', table({
    title: 'What survives an account ban',
    handle: 'dorian',
    rows: [
      ['', 'Conventional login', 'Berm'],
      ['Your identity', 'gone', 'untouched'],
      ['Your writing', 'gone', 'on relays'],
      ['Your follow graph', 'gone', 'yours, encrypted'],
      ['App access', 'gone', 'unaffected'],
      ['The blue badge', 'gone', 'gone'],
    ],
  })],
  ['card-receipt.png', receipt({
    handle: 'dorian',
    npub: 'npub1fn27skur6m05z747px3epnlclf8etedhahky9zxrwxad8gll2lm',
    eventId: 'b83846a3160cdce57da4bf663ebc671bdbe98702968671d3ab11f654',
    archived: 'web.archive.org · 27 Jul 2026 22:44 UTC',
    relays: 'nos.lol · relay.primal.net · relay.damus.io',
  })],
];

if (!existsSync('out')) mkdirSync('out');

const browser = await chromium.launch(
  existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });

for (const [name, body] of CARDS) {
  await page.setContent(`<style>${BASE}</style>${body}`);
  const buf = await page.screenshot({ path: `out/${name}` });
  // Content-addressed in production: the URL carries the hash, so X's cache
  // can never serve a stale card for changed content.
  console.log(`${name}  ${(buf.length / 1024).toFixed(0)} KB  sha256:${createHash('sha256').update(buf).digest('hex').slice(0, 16)}`);
}

await browser.close();
