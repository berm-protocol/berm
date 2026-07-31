#!/usr/bin/env node
/**
 * X Articles API — draft creation harness.
 *
 * Zero dependencies. Node 18+ only (uses built-in fetch and crypto).
 *
 *   node x-articles-test.mjs --client-id=YOUR_CLIENT_ID
 *
 * WHY IT ESCALATES: if you fire a rich payload at an untested endpoint and get
 * a 400, you cannot tell whether the token is wrong, the scope is missing, or
 * the JSON shape is wrong. So this runs the cheapest test first and stops at
 * the first failure with the full response body.
 *
 *   T1  auth        GET  /2/users/me            — is the token real?
 *   T2  minimal     POST /2/articles/draft      — verbatim from X's own docs
 *   T3  entities[]  POST /2/articles/draft      — link as `entities` array
 *   T4  entityMap{} POST /2/articles/draft      — link as standard DraftJS map
 *   T5  rich        POST /2/articles/draft      — headings, marks, lists
 *   T6  publish     POST /2/articles/{id}/publish   (only with --publish)
 *
 * T3 vs T4 exists because X's docs show `entities: []` while standard DraftJS
 * ContentState uses `entityMap: {}`. One of them is right. This finds out.
 */

import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.length ? v.join('=') : true];
  }),
);

const CLIENT_ID     = args['client-id']     || process.env.X_CLIENT_ID;
const CLIENT_SECRET = args['client-secret'] || process.env.X_CLIENT_SECRET || null;
const PORT          = Number(args.port || 8765);
const REDIRECT_URI  = `http://127.0.0.1:${PORT}/callback`;
const TOKEN_FILE    = new URL('./.x-token.json', import.meta.url);
const PAYLOAD_FILE  = args.payload || null;
const DO_PUBLISH    = Boolean(args.publish);

if (!CLIENT_ID) {
  console.error(`
Missing client id.

  node x-articles-test.mjs --client-id=YOUR_CLIENT_ID [--client-secret=...] [--publish] [--payload=draftjs.json]

Before the first run, add this exact callback URL to your X app settings:

  ${REDIRECT_URI}

Use --client-secret only if your app is a Confidential client. Public /
Native clients use PKCE alone and need no secret.
`);
  process.exit(1);
}

const SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access'];

const c = {
  dim:  (s) => `\x1b[2m${s}\x1b[0m`,
  ok:   (s) => `\x1b[32m${s}\x1b[0m`,
  bad:  (s) => `\x1b[31m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  b:    (s) => `\x1b[1m${s}\x1b[0m`,
};

/* ------------------------------------------------------------------ */
/* OAuth 2.0 Authorization Code + PKCE                                 */
/* ------------------------------------------------------------------ */

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function getToken() {
  if (existsSync(TOKEN_FILE) && !args.reauth) {
    const saved = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
    if (saved.expires_at > Date.now() + 60_000) {
      console.log(c.dim(`using cached token (expires ${new Date(saved.expires_at).toLocaleTimeString()})`));
      console.log(c.dim('pass --reauth to force a fresh login\n'));
      return saved.access_token;
    }
    if (saved.refresh_token) {
      console.log(c.dim('cached token expired — refreshing…'));
      const refreshed = await exchange({ grant_type: 'refresh_token', refresh_token: saved.refresh_token });
      if (refreshed) return refreshed;
      console.log(c.warn('refresh failed, falling back to full login\n'));
    }
  }
  return await interactiveLogin();
}

function interactiveLogin() {
  return new Promise((resolve, reject) => {
    const verifier  = b64url(randomBytes(48));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    const state     = b64url(randomBytes(16));

    const url = 'https://x.com/i/oauth2/authorize?' + new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: SCOPES.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

    const server = createServer(async (req, res) => {
      const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
      if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }

      const err = u.searchParams.get('error');
      if (err) {
        res.writeHead(200, { 'content-type': 'text/html' })
           .end(`<h2>Authorisation failed</h2><pre>${err}: ${u.searchParams.get('error_description') ?? ''}</pre>`);
        server.close();
        return reject(new Error(`${err}: ${u.searchParams.get('error_description') ?? ''}`));
      }
      if (u.searchParams.get('state') !== state) {
        res.writeHead(400).end('state mismatch');
        server.close();
        return reject(new Error('state mismatch — possible CSRF, aborting'));
      }

      const token = await exchange({
        grant_type: 'authorization_code',
        code: u.searchParams.get('code'),
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      });

      res.writeHead(200, { 'content-type': 'text/html' }).end(
        token
          ? '<h2>Authorised.</h2><p>Close this tab and return to the terminal.</p>'
          : '<h2>Token exchange failed.</h2><p>See the terminal.</p>',
      );
      server.close();
      token ? resolve(token) : reject(new Error('token exchange failed'));
    });

    server.listen(PORT, '127.0.0.1', () => {
      console.log(c.b('\n1. Open this URL and approve:\n'));
      console.log('   ' + url + '\n');
      console.log(c.dim(`   (waiting on ${REDIRECT_URI} …)\n`));
    });
  });
}

async function exchange(params) {
  const body = new URLSearchParams({ ...params, client_id: CLIENT_ID });
  const headers = { 'content-type': 'application/x-www-form-urlencoded' };

  // Confidential clients authenticate with Basic; public clients use PKCE alone.
  if (CLIENT_SECRET) {
    headers.authorization = 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  }

  const res  = await fetch('https://api.x.com/2/oauth2/token', { method: 'POST', headers, body });
  const text = await res.text();

  if (!res.ok) {
    console.log(c.bad(`\ntoken exchange ${res.status}`));
    console.log(text.slice(0, 600) + '\n');
    if (/redirect_uri/i.test(text)) {
      console.log(c.warn(`Hint: register exactly this callback in your X app settings:\n  ${REDIRECT_URI}\n`));
    }
    if (/client/i.test(text) && !CLIENT_SECRET) {
      console.log(c.warn('Hint: if your app is a Confidential client, pass --client-secret=…\n'));
    }
    return null;
  }

  const json = JSON.parse(text);
  writeFileSync(TOKEN_FILE, JSON.stringify({
    ...json,
    expires_at: Date.now() + (json.expires_in ?? 7200) * 1000,
  }, null, 2));
  console.log(c.ok(`\ntoken acquired — scopes: ${json.scope ?? '(not reported)'}\n`));
  return json.access_token;
}

/* ------------------------------------------------------------------ */
/* Test payloads                                                       */
/* ------------------------------------------------------------------ */

const MINIMAL = {
  title: 'XOnly API test — minimal',
  content_state: {
    blocks: [{ text: 'Hello from the Articles API!', type: 'unstyled' }],
    entities: [],
  },
};

/** X's docs show `entities: []`. */
const ENTITIES_ARRAY = {
  title: 'XOnly API test — entities array',
  content_state: {
    blocks: [
      { text: 'Heading', type: 'header-one' },
      {
        text: 'A link to xonly.ai lives in this sentence.',
        type: 'unstyled',
        inlineStyleRanges: [{ offset: 2, length: 4, style: 'BOLD' }],
        entityRanges: [{ offset: 2, length: 18, key: 0 }],
      },
    ],
    entities: [{ type: 'LINK', mutability: 'MUTABLE', data: { url: 'https://xonly.ai' } }],
  },
};

/** Standard DraftJS ContentState uses `entityMap` keyed by string. */
const ENTITY_MAP = {
  title: 'XOnly API test — entityMap object',
  content_state: {
    blocks: [
      { key: 'aaaaa', text: 'Heading', type: 'header-one', depth: 0, inlineStyleRanges: [], entityRanges: [], data: {} },
      {
        key: 'aaaab',
        text: 'A link to xonly.ai lives in this sentence.',
        type: 'unstyled',
        depth: 0,
        inlineStyleRanges: [{ offset: 2, length: 4, style: 'BOLD' }],
        entityRanges: [{ offset: 2, length: 18, key: 0 }],
        data: {},
      },
    ],
    entityMap: { 0: { type: 'LINK', mutability: 'MUTABLE', data: { url: 'https://xonly.ai' } } },
  },
};

/** Everything the editor can emit, to discover what X actually renders. */
const RICH = {
  title: 'XOnly API test — rich',
  content_state: {
    blocks: [
      { text: 'Heading level one', type: 'header-one' },
      { text: 'Heading level two', type: 'header-two' },
      { text: 'Heading level three', type: 'header-three' },
      {
        text: 'Bold italic strike here.',
        type: 'unstyled',
        inlineStyleRanges: [
          { offset: 0,  length: 4, style: 'BOLD' },
          { offset: 5,  length: 6, style: 'ITALIC' },
          { offset: 12, length: 6, style: 'STRIKETHROUGH' },
        ],
      },
      { text: 'A quotation that should render as a blockquote.', type: 'blockquote' },
      { text: 'First bullet',  type: 'unordered-list-item' },
      { text: 'Second bullet', type: 'unordered-list-item' },
      { text: 'First number',  type: 'ordered-list-item' },
      { text: 'Second number', type: 'ordered-list-item' },
      { text: 'const x = 1; // code block', type: 'code-block' },
      { text: 'Unicode: café naïve 日本語 🚀 — "curly" & <less>', type: 'unstyled' },
    ],
    entities: [],
  },
};

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

let token;
const results = [];

async function call(label, method, url, body) {
  const headers = { authorization: `Bearer ${token}` };
  if (body) headers['content-type'] = 'application/json';

  const started = Date.now();
  const res  = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const ms   = Date.now() - started;

  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }

  const ok = res.ok;
  console.log(`${ok ? c.ok('  PASS') : c.bad('  FAIL')}  ${label}  ${c.dim(`${res.status} · ${ms}ms`)}`);
  if (!ok || args.verbose) {
    console.log(c.dim('        ' + text.slice(0, 700).replace(/\n/g, '\n        ')));
  }

  results.push({ label, status: res.status, ok, response: json ?? text.slice(0, 700) });
  return { ok, json, text, status: res.status };
}

(async () => {
  console.log(c.b('\nX Articles API harness'));
  console.log(c.dim(`client ${CLIENT_ID.slice(0, 8)}…  callback ${REDIRECT_URI}\n`));

  try {
    token = await getToken();
  } catch (e) {
    console.error(c.bad('\nauthorisation failed: ' + e.message));
    process.exit(1);
  }

  console.log(c.b('T1 — auth'));
  const me = await call('GET /2/users/me', 'GET', 'https://api.x.com/2/users/me');
  if (!me.ok) {
    console.log(c.bad('\nToken is not usable. Nothing below would be diagnostic — stopping.\n'));
    finish();
    return;
  }
  console.log(c.dim(`        signed in as @${me.json?.data?.username}\n`));

  console.log(c.b('T2 — minimal draft (verbatim from X docs)'));
  const minimal = await call('POST /2/articles/draft', 'POST', 'https://api.x.com/2/articles/draft', MINIMAL);
  if (!minimal.ok) {
    console.log(c.warn(`
Minimal payload rejected. That points at access rather than JSON shape:
  · does your access tier include the Articles endpoints?
  · is tweet.write among the granted scopes shown above?
  · does the authorising account have X Premium?
`));
    finish();
    return;
  }
  const draftId = minimal.json?.data?.id ?? minimal.json?.id;
  console.log(c.ok(`        draft created: ${draftId}\n`));

  console.log(c.b('T3 / T4 — which entity shape does X accept?'));
  const a = await call('entities: []   (per docs)', 'POST', 'https://api.x.com/2/articles/draft', ENTITIES_ARRAY);
  const b = await call('entityMap: {}  (standard DraftJS)', 'POST', 'https://api.x.com/2/articles/draft', ENTITY_MAP);
  console.log(c.dim(`        -> serializer should emit: ${
    a.ok && !b.ok ? 'entities array' : b.ok && !a.ok ? 'entityMap object' : a.ok && b.ok ? 'either (both accepted)' : 'neither worked — inspect above'
  }\n`));

  console.log(c.b('T5 — rich payload'));
  const rich = await call('POST /2/articles/draft', 'POST', 'https://api.x.com/2/articles/draft', RICH);
  if (rich.ok) {
    console.log(c.ok(`        draft created: ${rich.json?.data?.id ?? rich.json?.id}`));
    console.log(c.dim('        open x.com/compose/articles and check which block types actually render\n'));
  }

  if (PAYLOAD_FILE) {
    console.log(c.b('T5b — your payload file'));
    const custom = JSON.parse(readFileSync(PAYLOAD_FILE, 'utf8'));
    await call(`POST /2/articles/draft  (${PAYLOAD_FILE})`, 'POST', 'https://api.x.com/2/articles/draft', custom);
    console.log('');
  }

  if (DO_PUBLISH && draftId) {
    console.log(c.b('T6 — publish'));
    console.log(c.warn('        this posts publicly to your account\n'));
    await call(`POST /2/articles/${draftId}/publish`, 'POST', `https://api.x.com/2/articles/${draftId}/publish`);
  } else if (draftId) {
    console.log(c.dim(`T6 — publish skipped. Add --publish to publish draft ${draftId}.\n`));
  }

  finish();
})();

function finish() {
  const pass = results.filter((r) => r.ok).length;
  console.log(c.b(`\n${pass}/${results.length} calls succeeded`));
  const out = new URL('./x-articles-result.json', import.meta.url);
  writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
  console.log(c.dim(`full log written to ${out.pathname}\n`));
  console.log(c.dim('drafts are not public — review them at x.com/compose/articles\n'));
}
