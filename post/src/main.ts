/**
 * The composer.
 *
 * ORDER OF OPERATIONS IS THE PRODUCT:
 *
 *   1. write            prose, plus at most one artifact X would destroy
 *   2. sign  →  relays  unconditional, independent of X, permanent
 *   3. offer  →  X       a pre-filled composer the user submits themselves
 *
 * Step 2 completing is the success condition. Step 3 is a convenience that may
 * never happen, and the UI must never imply it did — `STATE_LABEL.offered` says
 * so in words, because "Posted to X ✓" would be a claim nothing can support.
 */

import { createLocalSigner } from './sdk/local-signer.js';
import type { XnsbSdk } from './sdk/types.js';
import { buildIntent, headroom, X_LIMIT, weightedLength } from './intent.js';
import { buildPostEvent, describePostForApproval, STATE_LABEL, type PostState } from './nostr.js';
import { emptyPost, needsCard, cardAlt, type Post, type Attachment } from './model.js';
import { renderPostCard } from './card.js';
import { postToPage, pageTitle } from './page.js';
import { slugOrDigest, pageUrl } from '../../landing/src/slug.js';

/* ---------- element helpers ---------- */
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const on = (el: Element | null, ev: string, fn: (e: Event) => void) => el?.addEventListener(ev, fn);

/* ---------- state ---------- */
let post: Post = emptyPost();
let state: PostState = 'draft';
let signer: XnsbSdk | null = null;
let npub = '';
let cardDataUrl = '';
let cardSize = { w: 1200, h: 630 };
let signedRef = '';

const params = new URLSearchParams(location.search);
const RELAYS = (params.get('relays') ?? 'ws://localhost:7447,ws://localhost:7448')
  .split(',').map((s) => s.trim()).filter(Boolean);
const DOMAIN = params.get('domain') ?? 'xonly.ai';

/**
 * Permalink for a post: `/@handle/slug`.
 *
 * This used to be `/p/<16 hex>`, which was wrong twice over. The node — the thing
 * actually deployed at a domain — already used `/@handle/slug`, so there were two
 * shapes for one concept. And X deboosts posts containing links, so the link that
 * does get through has to survive a human's "is this spam?" glance:
 * `xonly.ai/p/a1b2c3d4` reads as a tracking redirect, `their-site.com/@dorin/
 * custody-honestly` reads as a page somebody owns.
 */
async function sha256Hex(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function permalinkFor(p: Post): Promise<string> {
  const canon = JSON.stringify([p.text, p.heading ?? '', p.attachment ?? null]);
  const hex = await sha256Hex(new TextEncoder().encode(canon));
  const handle = ($('#handle') as HTMLInputElement).value.trim() || 'anon';
  const { slug } = slugOrDigest(pageTitle(p), hex);
  return pageUrl(`https://${DOMAIN}`, handle, slug);
}

/**
 * SHA-256 of the card PNG.
 *
 * Computed from the exact bytes that will be uploaded, before publishing, so the
 * commitment in the event does not depend on any host being reachable.
 */
async function cardHash(dataUrl: string): Promise<string | undefined> {
  if (!dataUrl) return undefined;
  const b64 = dataUrl.split(',')[1];
  if (!b64) return undefined;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return sha256Hex(bytes);
}

/* ---------- artifact editors ---------- */

function currentAttachment(): Attachment | undefined {
  const kind = ($('#kind') as HTMLSelectElement).value;
  const raw = ($('#artifact') as HTMLTextAreaElement).value;
  if (kind === 'none' || !raw.trim()) return undefined;

  switch (kind) {
    case 'code':
      return { kind: 'code', text: raw.replace(/\s+$/, ''), language: ($('#lang') as HTMLInputElement).value.trim() || undefined };
    case 'art':
      return { kind: 'art', art: { id: 'a', type: 'art', text: raw.replace(/\s+$/, '') } };
    case 'quote':
      return { kind: 'quote', text: raw.trim(), attribution: ($('#lang') as HTMLInputElement).value.trim() || undefined };
    case 'table':
      return { kind: 'table', table: parsePipeTable(raw) };
  }
  return undefined;
}

/**
 * Parse a pipe table.
 *
 * Deliberately the same syntax the user would paste out of markdown, so the
 * round trip is lossless and nobody has to learn a table editor to post a table.
 */
export function parsePipeTable(raw: string): import('./model.js').TableBlock {
  const lines = raw.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  const isRule = (l: string) => /^\|?[\s:|-]+\|?$/.test(l) && l.includes('-');
  const cells = (l: string) =>
    l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => [{ text: c.trim() }]);

  const body = lines.filter((l) => !isRule(l));
  const header = lines.length > 1 && isRule(lines[1] ?? '');
  return { id: 't', type: 'table', header, rows: body.map(cells) };
}

/* ---------- render ---------- */

function readPost(): Post {
  return {
    text: ($('#text') as HTMLTextAreaElement).value,
    heading: ($('#heading') as HTMLInputElement).value.trim() || undefined,
    attachment: currentAttachment(),
  };
}

async function refresh(): Promise<void> {
  post = readPost();
  const url = await permalinkFor(post);
  const willLink = needsCard(post);

  const count = weightedLength(post.text);
  const left = headroom(post.text, { url: willLink ? url : undefined });
  const intent = buildIntent({ text: post.text, url: willLink ? url : undefined });

  // The counter states X's units, not characters, and says so — the difference
  // is the entire reason it exists.
  $('#count').textContent = `${X_LIMIT - left} / ${X_LIMIT} units`;
  $('#count').className = left < 0 ? 'count over' : left < 25 ? 'count near' : 'count';
  $('#count-note').textContent =
    count.urls > 0
      ? `${count.urls} link${count.urls > 1 ? 's' : ''} charged at 23 units each · ${count.characters} characters typed`
      : `${count.characters} characters typed`;

  $('#advice').textContent = needsCard(post)
    ? 'This has something X would damage on paste. The card carries it, the permalink carries the real thing.'
    : 'Nothing here needs a card. Plain text reaches more people on X — consider just posting it there.';

  const btn = $<HTMLButtonElement>('#offer');
  btn.disabled = !intent.ok || state === 'draft';
  // Content problems win over workflow hints. Telling someone to "sign first"
  // while their post is 20 units too long hides the thing they need to fix and
  // makes them discover it after signing.
  $('#intent-msg').textContent =
    !intent.ok ? (intent.message ?? '')
    : state === 'draft' ? 'Sign first — the durable copy comes before the X copy.'
    : `Opens X’s composer, pre-filled. ${left} units to spare.`;
  btn.dataset.href = intent.ok ? intent.href! : '';

  $('#approval').textContent = describePostForApproval(post, { createdAt: now(), permalink: url });
  $('#state').textContent = STATE_LABEL[state];
  $('#state').dataset.s = state;

  await drawCard();
  $('#page-preview').textContent = postToPage(post, {
    canonicalUrl: url, authorName: 'You', npub: npub || 'npub1…', createdAt: now(),
    cardUrl: cardDataUrl ? `${url}.png` : undefined, cardSize,
    nostrRef: signedRef || undefined,
  });
  $('#permalink').textContent = url;
  $('#alt').textContent = cardAlt(post);
  $('#ptitle').textContent = pageTitle(post);
}

const now = () => Math.floor(Date.now() / 1000);

async function drawCard(): Promise<void> {
  try {
    const img = await renderPostCard(post, {
      domain: DOMAIN,
      authorName: ($('#author') as HTMLInputElement).value.trim() || 'Anonymous',
      handle: ($('#handle') as HTMLInputElement).value.trim() || undefined,
      npubShort: npub ? `${npub.slice(0, 10)}…${npub.slice(-4)}` : undefined,
    });
    cardDataUrl = img.dataUrl;
    cardSize = { w: img.width, h: img.height };
    ($('#card') as HTMLImageElement).src = img.dataUrl;
    ($('#card') as HTMLImageElement).alt = img.alt;
  } catch {
    cardDataUrl = '';
  }
}

/**
 * The approval gate.
 *
 * An in-page sheet rather than `confirm()`, for the same reason the other packages
 * use one: the summary has to be readable, and a native dialog cannot show a
 * sentence with any structure. A decline is a first-class outcome — it resolves
 * false, `signEvent` throws `UserDeclinedError`, and nothing is published.
 *
 * WHOSE WORDS APPEAR HERE, and why it is not ours. `summary` is produced by the
 * SIGNER from the event it is about to sign. It stays authoritative and is shown
 * verbatim, because a sheet that describes the event in the app's own words can
 * describe something other than what is actually being signed — which is the
 * whole failure this project cares about, in miniature.
 *
 * Our contribution is the second line only: what signing does NOT do. The
 * browser check caught this showing one sentence while the panel below promised
 * another, and two descriptions of one signature is worse than either alone.
 */
function requestApproval(summary: string): Promise<boolean> {
  return new Promise((resolve) => {
    const sheet = $('#approval-sheet');
    $('#approval-what').textContent = summary;
    $('#approval-not').textContent =
      'This publishes to your relays only. Nothing is sent to X until you press the ' +
      'button yourself, and this app can never confirm whether you did.';
    sheet.classList.remove('hidden');
    const done = (ok: boolean) => { sheet.classList.add('hidden'); resolve(ok); };
    ($('#approve-yes') as HTMLButtonElement).onclick = () => done(true);
    ($('#approve-no') as HTMLButtonElement).onclick = () => done(false);
  });
}

/* ---------- actions ---------- */

on($('#connect'), 'click', async () => {
  try {
    signer = createLocalSigner({ relays: RELAYS, approve: requestApproval, displayName: 'You' });
    const session = await signer.connect();
    npub = session.npub;
    $('#who').textContent = `${npub}  ·  ${session.custody}`;
    $('#connect').setAttribute('hidden', '');
    await refresh();
  } catch (e) {
    $('#who').textContent = `signer refused: ${(e as Error).message}`;
  }
});

on($('#sign'), 'click', async () => {
  if (!signer) { $('#result').textContent = 'Connect a signer first.'; return; }
  const url = await permalinkFor(post);
  const sha = await cardHash(cardDataUrl);
  // Hash-shaped, so X treats it as an opaque URL while any Nostr client meeting
  // the same URL can recover it from the author's server list (NIP-B7).
  const cardHref = sha ? `https://${DOMAIN}/${sha}.png` : undefined;
  const unsigned = buildPostEvent(post, {
    createdAt: now(),
    permalink: needsCard(post) ? url : undefined,
    cardUrl: cardHref,
    cardSha256: sha,
    cardDim: `${cardSize.w}x${cardSize.h}`,
    subject: post.heading,
  });

  let ev;
  try {
    ev = await signer.signEvent(unsigned);
  } catch (e) {
    // A decline is a normal outcome, not an error state. Nothing is published,
    // and the UI must not look like something went wrong.
    $('#result').textContent = `Not signed — ${(e as Error).message}`;
    state = 'draft';
    await refresh();
    return;
  }

  // Published through the SDK rather than a local WebSocket loop, so the >=2
  // acceptance rule being exercised here is the one apps actually ship with
  // (Berm v2 §4.4) instead of a second implementation that could drift from it.
  const receipt = await signer.publish(ev);
  if (receipt.success) {
    state = 'signed';
    signedRef = ev.id;
    $('#result').textContent =
      `Published to ${receipt.accepted.length} relays. id ${ev.id.slice(0, 16)}… — ` +
      'this exists now whether or not you post it to X.';
  } else {
    state = 'draft';
    $('#result').textContent =
      `Only ${receipt.accepted.length} relay accepted (${receipt.failed.length} refused). ` +
      'Not treated as published — one relay is a single point of failure wearing the costume of success.';
  }
  $('#event').textContent = JSON.stringify(ev, null, 2);
  await refresh();
});

on($('#offer'), 'click', () => {
  const href = $<HTMLButtonElement>('#offer').dataset.href;
  if (!href) return;
  window.open(href, '_blank', 'noopener,noreferrer');
  // 'offered', never 'posted'. Nothing comes back from an intent.
  state = 'offered';
  void refresh();
});

on($('#kind'), 'change', () => {
  const kind = ($('#kind') as HTMLSelectElement).value;
  $('#artifact-wrap').toggleAttribute('hidden', kind === 'none');
  const lang = $('#lang') as HTMLInputElement;
  lang.placeholder = kind === 'quote' ? 'attribution (optional)' : 'language (optional)';
  lang.toggleAttribute('hidden', kind === 'art' || kind === 'table');
  ($('#artifact') as HTMLTextAreaElement).placeholder =
    kind === 'table' ? '| Tier | Depends on |\n| --- | --- |\n| 1 | a DNS name |\n| 2 | your hardware |'
    : kind === 'code' ? 'if (!ok) return;'
    : kind === 'art' ? 'A ──▶ B\n│     │\n└─────┘'
    : 'The quote.';
  void refresh();
});

for (const sel of ['#text', '#heading', '#artifact', '#lang', '#author', '#handle']) {
  on($(sel), 'input', () => void refresh());
}

on($('#download'), 'click', () => {
  if (!cardDataUrl) return;
  const a = document.createElement('a');
  a.href = cardDataUrl;
  a.download = 'card-1200x630.png';
  a.click();
});

void refresh();
