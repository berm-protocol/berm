/**
 * Fetch an author's posts from relays and refuse everything that does not check.
 *
 * WHAT THIS IS FOR. A node is the thing that renders somebody's signed events as
 * web pages. The WordPress plugin is one. This is the other: a static site built
 * from relays at build time, deployable to GitHub Pages, forkable by anyone with
 * a GitHub account and no server.
 *
 * WHY THAT MATTERS BEYOND CONVENIENCE. Every additional node is both a mirror and
 * a witness. It holds a copy of the author's work that survives any single host
 * going away, and — because the page it renders re-verifies against relays in the
 * visitor's browser — it is one more place where a discrepancy becomes visible.
 * The signer gate makes the same argument about signers: detection improves with
 * the number of independent parties who have no incentive to cover for each other.
 *
 * THE RULE HERE. Nothing reaches the site that this module has not verified
 * itself. A relay is an untrusted party that can return whatever it likes, so
 * every signature is checked locally and every event that fails is dropped and
 * counted. A build that silently published a forgery would make the node worse
 * than useless — it would launder one.
 */

import { verifyEvent } from 'nostr-tools';

export interface CollectedEvent {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  sig: string;
  /** Relays that served a validly signed copy of this exact event. */
  seenOn: string[];
}

export interface CollectReport {
  events: CollectedEvent[];
  /** Relay → how many events it served that failed verification here. */
  rejected: Record<string, number>;
  /** Relays that answered nothing at all. */
  silent: string[];
  /** Relays that could not be reached. */
  unreachable: string[];
}

export interface CollectOptions {
  pubkeyHex: string;
  relays: string[];
  kinds?: number[];
  limit?: number;
  timeoutMs?: number;
  /** Injected so the build is testable without a network. */
  open?: (url: string) => WebSocketLike;
}

export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
}

/** Ask one relay for an author's events. Never throws; failures become findings. */
export function fetchFrom(
  url: string,
  opts: CollectOptions,
): Promise<{ url: string; events: unknown[]; reachable: boolean }> {
  const kinds = opts.kinds ?? [1, 30023];
  const limit = opts.limit ?? 200;
  const timeoutMs = opts.timeoutMs ?? 8000;

  return new Promise((resolve) => {
    const events: unknown[] = [];
    let settled = false;
    let opened = false;

    const done = (reachable: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closing */ }
      resolve({ url, events, reachable });
    };

    const timer = setTimeout(() => done(opened), timeoutMs);

    let ws: WebSocketLike;
    try {
      ws = opts.open ? opts.open(url) : (new WebSocket(url) as unknown as WebSocketLike);
    } catch {
      clearTimeout(timer);
      return resolve({ url, events, reachable: false });
    }

    const sub = 'collect';
    ws.onopen = () => {
      opened = true;
      ws.send(JSON.stringify(['REQ', sub, { authors: [opts.pubkeyHex], kinds, limit }]));
    };
    ws.onmessage = (m) => {
      let msg: unknown;
      try { msg = JSON.parse(String(m.data)); } catch { return; }
      if (!Array.isArray(msg)) return;
      if (msg[0] === 'EVENT' && msg[1] === sub) events.push(msg[2]);
      else if (msg[0] === 'EOSE' && msg[1] === sub) done(true);
    };
    ws.onerror = () => done(opened);
    ws.onclose = () => done(opened);
  });
}

/** Shape check before signature check — a malformed object must not reach verifyEvent. */
function looksLikeEvent(e: unknown): e is CollectedEvent {
  if (!e || typeof e !== 'object') return false;
  const o = e as Record<string, unknown>;
  return (
    typeof o.id === 'string' && /^[0-9a-f]{64}$/.test(o.id) &&
    typeof o.pubkey === 'string' && /^[0-9a-f]{64}$/.test(o.pubkey) &&
    typeof o.sig === 'string' && /^[0-9a-f]{128}$/.test(o.sig) &&
    typeof o.kind === 'number' && typeof o.created_at === 'number' &&
    typeof o.content === 'string' && Array.isArray(o.tags)
  );
}

/**
 * Merge relay responses into one verified set.
 *
 * `verify` is injected so tests can exercise the rejection path without forging
 * real signatures. It defaults to nostr-tools, and the clone is deliberate:
 * nostr-tools memoises verification results on the object via a Symbol, so an
 * event that arrived pre-poisoned could otherwise skip the check entirely.
 */
export function merge(
  responses: Array<{ url: string; events: unknown[]; reachable: boolean }>,
  pubkeyHex: string,
  verify: (e: CollectedEvent) => boolean = (e) =>
    verifyEvent(JSON.parse(JSON.stringify(e)) as never),
): CollectReport {
  const byId = new Map<string, CollectedEvent>();
  const rejected: Record<string, number> = {};
  const silent: string[] = [];
  const unreachable: string[] = [];

  for (const res of responses) {
    if (!res.reachable) { unreachable.push(res.url); continue; }
    if (res.events.length === 0) { silent.push(res.url); continue; }

    for (const raw of res.events) {
      // Wrong author is not a forgery, it is an answer to a different question.
      if (!looksLikeEvent(raw) || raw.pubkey !== pubkeyHex) {
        rejected[res.url] = (rejected[res.url] ?? 0) + 1;
        continue;
      }
      if (!verify(raw)) {
        rejected[res.url] = (rejected[res.url] ?? 0) + 1;
        continue;
      }
      const existing = byId.get(raw.id);
      if (existing) {
        if (!existing.seenOn.includes(res.url)) existing.seenOn.push(res.url);
      } else {
        byId.set(raw.id, { ...raw, seenOn: [res.url] });
      }
    }
  }

  // Newest first — the order a reader expects, and stable for a byte-identical
  // rebuild because ties break on id.
  const events = [...byId.values()].sort(
    (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id),
  );

  return { events, rejected, silent, unreachable };
}

export async function collect(opts: CollectOptions): Promise<CollectReport> {
  const responses = await Promise.all(opts.relays.map((r) => fetchFrom(r, opts)));
  return merge(responses, opts.pubkeyHex);
}

/**
 * Should this build be published?
 *
 * A node that publishes whatever it managed to fetch will, on the day two relays
 * are down, quietly replace a complete archive with a partial one — and a visitor
 * cannot tell a short site from a censored one. So a build that lost events it
 * previously had must be refused rather than deployed, unless the operator says
 * otherwise.
 */
export function shouldPublish(
  report: CollectReport,
  previousCount: number,
  opts: { allowShrink?: boolean } = {},
): { ok: boolean; reason: string } {
  if (report.events.length === 0) {
    return { ok: false, reason: 'no verified events were fetched — refusing to publish an empty site' };
  }
  if (!opts.allowShrink && report.events.length < previousCount) {
    return {
      ok: false,
      reason:
        `fetched ${report.events.length} events but the previous build had ${previousCount}. ` +
        'Relays may be down. Publishing would silently truncate the archive; ' +
        'pass --allow-shrink if the loss is intentional.',
    };
  }
  return { ok: true, reason: `${report.events.length} verified events` };
}
