/**
 * Read-only probe of the Bags fee-share resolution.
 *
 * WHAT THIS DOES: GET requests. Nothing else.
 * WHAT THIS DOES NOT DO: build a transaction, sign anything, touch a wallet,
 * spend a lamport, or launch a token. There is no code path here that can.
 *
 * WHY IT EXISTS: everything in `src/` is modelled from public documentation.
 * Until this runs, our integration is a hypothesis. Four questions matter, and
 * none of them can be answered by reading docs:
 *
 *   Q1  Does a handle resolve for anyone, or only after onboarding to Bags?
 *   Q2  What comes back for a handle that does not exist?
 *   Q3  Is resolution case-sensitive?
 *   Q4  Does a renamed handle resolve to the old wallet, a new one, or nothing?
 *
 * Q4 is the one that decides whether fee continuity is a real problem or a
 * theoretical one. It needs a handle known to have been renamed.
 *
 *   BAGS_API_KEY=... node probe.mjs @somehandle @another
 *
 * Put the key in a file and source it. Do not paste it into a chat window.
 */

const KEY = process.env.BAGS_API_KEY;
const BASE = process.env.BAGS_API_BASE ?? 'https://public-api-v2.bags.fm/api/v1';

// Documented as the social-username fee-claimer lookup. If Bags moves it, this
// is the one line to change.
const PATH = '/token-launch/fee-share/wallet/v2';

if (!KEY) {
  console.error(`
No BAGS_API_KEY set.

  1. Get a key from the Bags developer portal
  2. Put it in a file — never in a shell history or a chat message:

       echo 'BAGS_API_KEY=...' > .env.local
       set -a; . ./.env.local; set +a
       node probe.mjs @yourhandle

This script only ever issues GET requests. It cannot spend anything.
`);
  process.exit(2);
}

const handles = process.argv.slice(2).map((h) => h.replace(/^@/, ''));
if (!handles.length) {
  console.error('Usage: node probe.mjs @handle [@handle …]');
  process.exit(2);
}

async function lookup(provider, username) {
  const url = `${BASE}${PATH}?provider=${encodeURIComponent(provider)}&username=${encodeURIComponent(username)}`;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: 'GET',                       // stated explicitly; never changes
      headers: { 'x-api-key': KEY, accept: 'application/json' },
    });
    const ms = Date.now() - started;
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
    return { ok: res.ok, status: res.status, ms, body };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - started, body: String(e.message ?? e) };
  }
}

const wallet = (b) =>
  (typeof b === 'object' && b !== null &&
    (b.wallet ?? b.address ?? b.response?.wallet ?? b.data?.wallet)) || null;

console.log(`\nBags fee-share resolution probe`);
console.log(`base: ${BASE}${PATH}`);
console.log(`mode: READ ONLY — GET requests only, no transaction is ever built\n`);
console.log('─'.repeat(72));

const findings = [];

/* ---- Q1 + Q3: the handles you supplied, exact and case-flipped ---- */
for (const h of handles) {
  const exact = await lookup('twitter', h);
  const w = wallet(exact.body);
  console.log(`  @${h.padEnd(20)} ${exact.status}  ${exact.ms}ms  ${w ?? '(no wallet)'}`);
  if (!w && exact.body) console.log(`    ↳ ${JSON.stringify(exact.body).slice(0, 160)}`);
  findings.push({ handle: h, status: exact.status, wallet: w });

  const flipped = h === h.toLowerCase() ? h.toUpperCase() : h.toLowerCase();
  if (flipped !== h) {
    const alt = await lookup('twitter', flipped);
    const w2 = wallet(alt.body);
    const same = w && w2 && w === w2;
    console.log(`  @${flipped.padEnd(20)} ${alt.status}  case-${same ? 'INSENSITIVE' : w2 ? 'DIFFERENT WALLET' : 'no wallet'}`);
  }
}

/* ---- Q2: a handle that certainly does not exist ---- */
const nonsense = 'berm_probe_' + 'zzzz9q7w3';
const missing = await lookup('twitter', nonsense);
console.log(`\n  control @${nonsense}`);
console.log(`    status ${missing.status} — ${wallet(missing.body) ? 'RESOLVED (!)' : 'no wallet, as expected'}`);
console.log(`    body: ${JSON.stringify(missing.body).slice(0, 200)}`);

console.log('─'.repeat(72));

const resolved = findings.filter((f) => f.wallet).length;
console.log(`
${resolved}/${findings.length} handle(s) resolved to a wallet.

Still unanswered, and not answerable from here:

  Q4  Does a RENAMED handle resolve to the old wallet, a new one, or nothing?
      Needs a handle known to have changed. This decides whether fee continuity
      is a live problem or a theoretical one.

  Q5  Can a claimer re-point their wallet after the fact, or is the binding
      fixed at launch? Not visible in the public docs.

Record the answers in bags/README.md so the model in src/ stops being a guess.
`);
