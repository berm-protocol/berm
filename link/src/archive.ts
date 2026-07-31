/**
 * Wayback archiving for NIP-39 proof posts.
 *
 * THE PROBLEM THIS SOLVES: the proof post dies with the X account. Delete the
 * account and the evidence for your identity claim evaporates at exactly the
 * moment you need it — when someone else has taken your handle and is claiming
 * to be you.
 *
 * An archived copy survives, is held by a third party with no stake in the
 * dispute, and carries its own timestamp.
 *
 * WHAT THE APIS ACTUALLY ALLOW (measured, not assumed):
 *
 *   availability   archive.org/wayback/available   HTTP 200, CORS: *
 *                  -> a browser can check snapshots directly, no server needed
 *
 *   capture        web.archive.org/save/<url>      no CORS headers
 *                  -> a browser CANNOT submit a capture and read the result
 *
 * So capture is user-triggered by default: open the save URL in a tab, let the
 * user watch it happen, then poll the CORS-open availability API until the
 * snapshot appears. Zero credentials, zero server, works today.
 *
 * Server-side automatic capture is an optional upgrade for nodes that configure
 * archive.org credentials — the same shape as the X API decision. The free path
 * is primary; automation is a convenience.
 */

export interface Snapshot {
  url: string;
  /** Wayback timestamp, YYYYMMDDhhmmss. */
  timestamp: string;
  /** Parsed to epoch seconds, for the attestation. */
  capturedAt: number;
}

const AVAILABILITY = 'https://archive.org/wayback/available';
const SAVE = 'https://web.archive.org/save/';

/** Wayback timestamps are YYYYMMDDhhmmss in UTC. */
export function parseWaybackTimestamp(ts: string): number {
  const m = ts.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m) return 0;
  return Math.floor(
    Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!) / 1000,
  );
}

/**
 * Is this URL already archived?
 *
 * Safe to call from a browser — this endpoint sends `Access-Control-Allow-Origin: *`.
 */
export async function checkSnapshot(url: string): Promise<Snapshot | null> {
  const q = `${AVAILABILITY}?url=${encodeURIComponent(url)}`;
  try {
    const res = await fetch(q, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const json = await res.json();
    const closest = json?.archived_snapshots?.closest;
    if (!closest?.available || !closest.url) return null;
    return {
      // The API returns http://; upgrade so the stored evidence is not a
      // downgrade vector when someone follows it years from now.
      url: String(closest.url).replace(/^http:\/\//, 'https://'),
      timestamp: String(closest.timestamp ?? ''),
      capturedAt: parseWaybackTimestamp(String(closest.timestamp ?? '')),
    };
  } catch {
    return null;
  }
}

/** The URL a user opens to trigger a capture. Not fetchable cross-origin. */
export function captureUrl(url: string): string {
  return SAVE + url;
}

export interface PollOptions {
  /** How long to keep checking. Captures of a busy site can take a while. */
  timeoutMs?: number;
  intervalMs?: number;
  onTick?: (elapsedMs: number) => void;
  /** Ignore snapshots older than this — otherwise an ancient capture of the
   *  same URL would be mistaken for the one just requested. */
  newerThan?: number;
}

/**
 * Poll until a snapshot appears.
 *
 * `newerThan` matters more than it looks: popular URLs may already have old
 * captures, and accepting one of those would attach evidence that predates the
 * proof post itself — which is worse than no evidence, because it looks valid.
 */
export async function waitForSnapshot(
  url: string,
  opts: PollOptions = {},
): Promise<Snapshot | null> {
  const timeout = opts.timeoutMs ?? 90_000;
  const interval = opts.intervalMs ?? 5_000;
  const started = Date.now();

  for (;;) {
    const snap = await checkSnapshot(url);
    if (snap && (!opts.newerThan || snap.capturedAt >= opts.newerThan)) return snap;

    const elapsed = Date.now() - started;
    if (elapsed > timeout) return null;
    opts.onTick?.(elapsed);
    await new Promise((r) => setTimeout(r, interval));
  }
}

/* ------------------------------------------------------------------ */
/* Proof post URLs                                                     */
/* ------------------------------------------------------------------ */

export interface ParsedPost {
  handle: string;
  postId: string;
  /** Canonical x.com form, so the archived URL is predictable. */
  canonical: string;
}

/**
 * Accept the many shapes people paste: x.com, twitter.com, mobile subdomains,
 * tracking parameters, trailing slashes, /photo/1 suffixes.
 */
export function parsePostUrl(input: string): ParsedPost | null {
  const raw = input.trim();
  const m = raw.match(
    /(?:https?:\/\/)?(?:[\w-]+\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})/i,
  );
  if (!m) return null;
  const handle = m[1]!;
  const postId = m[2]!;
  return { handle, postId, canonical: `https://x.com/${handle}/status/${postId}` };
}
