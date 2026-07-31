/**
 * The half that runs in the visitor's browser.
 *
 * It reads the claim the page embedded, fetches that event from the author's
 * relays, RE-VERIFIES EVERY SIGNATURE LOCALLY, hashes the card bytes, and writes
 * the verdict into the page. Nothing here trusts the server that served it —
 * which is the only reason the resulting line is worth anything.
 *
 * WHY THE PAGE STARTS AT "checking". The markup ships with `data-state="checking"`
 * and neutral copy, never a pre-set pass. If this script fails to load, is blocked,
 * or throws, the visitor sees an unresolved check rather than a green tick that
 * nothing computed. Failing closed is the whole discipline of the file.
 *
 * THE HONEST CEILING. This script is served by the same origin as the page, so a
 * hostile origin could ship a version that paints "verified" unconditionally.
 * Browser-delivered cryptography cannot verify itself — the same limit as the
 * signer. It is mitigated the same way (published SHA-256, SRI, a build
 * attestation a third party can check), and it is stated rather than papered over.
 */

import { verifyEvent } from 'nostr-tools';
import { judge, judgeCard, summarise, type EvidenceItem, type FetchedEvent } from './verdict.js';
import { candidateUrls, parseImeta, type ImetaFields } from './blossom.js';

interface Claim {
  eventId: string;
  pubkeyHex: string;
  signedContent: string;
  relays: string[];
  nevent: string;
  card: ImetaFields | null;
  imetaTag: string[] | null;
}

/** Ask one relay for one event id. Resolves to null on anything unhelpful. */
export function fetchFromRelay(
  url: string,
  id: string,
  timeoutMs = 4000,
): Promise<FetchedEvent | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ev: FetchedEvent | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closing */ }
      resolve(ev);
    };
    const timer = setTimeout(() => done(null), timeoutMs);

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      clearTimeout(timer);
      return resolve(null);
    }

    const sub = 'v' + Math.floor(performance.now()).toString(36);
    ws.onopen = () => ws.send(JSON.stringify(['REQ', sub, { ids: [id], limit: 1 }]));
    ws.onmessage = (m) => {
      let msg: unknown;
      try { msg = JSON.parse(String(m.data)); } catch { return; }
      if (!Array.isArray(msg)) return;
      if (msg[0] === 'EVENT' && msg[1] === sub) done(msg[2] as FetchedEvent);
      else if (msg[0] === 'EOSE' && msg[1] === sub) done(null);
    };
    ws.onerror = () => done(null);
    ws.onclose = () => done(null);
  });
}

/** SHA-256 of a fetched blob, lower-case hex. Null when it cannot be fetched. */
export async function hashOfUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/**
 * Walk the candidate hosts until one serves bytes matching the committed hash.
 *
 * The NIP-B7 recovery rule. A host that serves the wrong bytes is skipped rather
 * than believed, so a hostile entry in the list costs a request and nothing more.
 * Returns the hash actually observed at the first host that answered at all, so a
 * genuine substitution is reported as a mismatch instead of being hidden by a
 * later good mirror.
 */
export async function resolveCard(
  card: ImetaFields,
  extraServers: string[] = [],
): Promise<{ observed: string | null; from?: string; substitutedAt?: string }> {
  if (!card.sha256) return { observed: null };
  const urls = candidateUrls({ sha256: card.sha256, declared: card.urls, servers: extraServers });

  let firstAnswer: { hash: string; url: string } | null = null;
  for (const url of urls) {
    const hash = await hashOfUrl(url);
    if (hash === null) continue;
    if (!firstAnswer) firstAnswer = { hash, url };
    if (hash === card.sha256) return { observed: hash, from: url };
  }

  // Nothing matched. If a host answered with something else, that is the finding.
  return firstAnswer
    ? { observed: firstAnswer.hash, substitutedAt: firstAnswer.url }
    : { observed: null };
}

export interface HydrateResult {
  state: 'verified' | 'unverified' | 'mismatch';
  line: string;
  detail: string;
}

export async function runCheck(claim: Claim): Promise<HydrateResult> {
  const relays = claim.relays.length ? claim.relays : [];

  const evidence: EvidenceItem[] = await Promise.all(
    relays.map(async (relay): Promise<EvidenceItem> => {
      const event = await fetchFromRelay(relay, claim.eventId);
      if (!event) return { relay, event: null };
      // Verified HERE, in the visitor's browser, against a library the page did
      // not choose for them. A relay serving a forgery cannot get onto the page.
      let signatureValid = false;
      try {
        signatureValid = verifyEvent(structuredClone(event) as never);
      } catch {
        signatureValid = false;
      }
      return { relay, event, signatureValid };
    }),
  );

  const post = judge({
    declaredId: claim.eventId,
    declaredPubkey: claim.pubkeyHex,
    renderedContent: claim.signedContent,
    evidence,
  });

  // Guarded on the presence of an IMAGE, not of a hash. A displayed image with no
  // committed hash is unverifiable and must downgrade the page; only a post with
  // no image at all skips this.
  let card;
  if (claim.card) {
    const found = claim.card.sha256 ? await resolveCard(claim.card) : { observed: null };
    card = judgeCard(claim.card.sha256 ?? '', found.observed);
  }

  const s = summarise(post, card);
  const parts = [post.message];
  if (card && card.state !== 'verified') parts.push(card.message);
  if (post.servedForgery.length) {
    parts.push(`Relays that returned an invalid signature: ${post.servedForgery.join(', ')}.`);
  }

  return { state: s.state, line: s.line, detail: parts.join(' ') };
}

/** Read the embedded claim, run the check, write the result into the page. */
export async function hydrate(doc: Document = document): Promise<HydrateResult | null> {
  const el = doc.getElementById('claim');
  if (!el?.textContent) return null;

  let claim: Claim;
  try {
    claim = JSON.parse(el.textContent) as Claim;
  } catch {
    return null;
  }

  const box = doc.getElementById('attest');
  const line = doc.getElementById('vline');
  const detail = doc.getElementById('vdetail');

  let result: HydrateResult;
  try {
    result = await runCheck(claim);
  } catch (e) {
    // An error in the checker is not a pass. It is an unresolved check.
    result = {
      state: 'unverified',
      line: 'Could not complete the check.',
      detail: `The verification step failed in this browser: ${(e as Error).message}. ` +
              'Open the post in a Nostr client to check independently.',
    };
  }

  if (box) box.dataset.state = result.state;
  if (line) line.textContent = result.line;
  if (detail) detail.textContent = result.detail;
  // A hook for the browser suite, and for anyone who wants to read the verdict
  // without scraping the DOM.
  (globalThis as { __bermVerdict?: HydrateResult }).__bermVerdict = result;
  return result;
}

export function bootstrap(): void {
  if (typeof document === 'undefined') return;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void hydrate());
  } else {
    void hydrate();
  }
}
