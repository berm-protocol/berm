/**
 * Blossom — hash-addressed blobs, and why that makes the image host replaceable.
 *
 * Blossom servers store blobs at a path that IS the SHA-256 of the content, so
 * the same blob has the same path on every server:
 *
 *   https://blossom.example/<sha256>.png
 *   https://their-own-node.com/<sha256>.png     ← identical bytes
 *
 * NIP-B7 defines the recovery rule that makes this useful: when a URL whose path
 * is a 64-character hex string fails, a client recognises the hex as a SHA-256,
 * reads the author's `kind:10063` server list (BUD-03), and retries the same hash
 * on their other servers. Clients SHOULD verify that the fetched bytes hash to
 * that value.
 *
 * TWO CONSUMERS, TWO BEHAVIOURS, and the design has to serve both:
 *
 *   Nostr clients   many hosts, self-healing, verifiable
 *   X's crawler     exactly one `og:image` URL, cached, no fallback, and it will
 *                   never read a kind:10063 event
 *
 * Hence `ogImageUrl` picks one and `candidateUrls` returns all of them. Making the
 * og:image URL hash-shaped too costs nothing — X treats it as opaque, and any
 * Nostr client that meets the same URL can recover it.
 *
 * HONEST LIMIT: content-addressed is immutable, not permanent. BUD-12 defines
 * `DELETE /<sha256>` and nothing in the spec obliges a server to retain anything.
 * Free public servers do delete blobs, and BUD-07 exists because some charge. So
 * mirrors are not paranoia, and the author's own server is the only one they
 * control.
 */

export const SHA256_RE = /^[0-9a-f]{64}$/;

/** Kind of the user's Blossom server list (BUD-03). */
export const SERVER_LIST_KIND = 10063;

/** Strip a trailing slash so joins do not produce `//`. */
const trimHost = (h: string) => h.replace(/\/+$/, '');

export function isSha256(s: string): boolean {
  return SHA256_RE.test(s.toLowerCase());
}

/** Canonical retrieval URL for a blob on a given server. */
export function blobUrl(server: string, sha256: string, ext = 'png'): string {
  const hash = sha256.toLowerCase();
  if (!isSha256(hash)) throw new Error(`not a sha256: ${sha256}`);
  return `${trimHost(server)}/${hash}${ext ? `.${ext}` : ''}`;
}

/**
 * Recover the hash from a URL, per the NIP-B7 rule.
 *
 * Looks at the LAST path segment only. A hex string appearing elsewhere in a path
 * is not an address, and treating it as one would invent fallbacks for URLs that
 * are not blobs at all.
 */
export function sha256FromUrl(url: string): string | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const last = path.split('/').filter(Boolean).pop();
  if (!last) return null;
  const bare = last.replace(/\.[a-z0-9]{1,8}$/i, '').toLowerCase();
  return isSha256(bare) ? bare : null;
}

/** Extract server URLs from a kind:10063 event's `server` tags. */
export function serversFromList(event: { kind: number; tags: string[][] } | null): string[] {
  if (!event || event.kind !== SERVER_LIST_KIND) return [];
  const out: string[] = [];
  for (const t of event.tags) {
    if (t[0] !== 'server' || !t[1]) continue;
    try {
      const u = new URL(t[1]);
      // Only https. A blob fetched over http can be substituted in transit, which
      // defeats the point of having committed to its hash.
      if (u.protocol !== 'https:') continue;
      out.push(trimHost(u.origin + u.pathname.replace(/\/+$/, '')));
    } catch {
      /* skip malformed entries rather than failing the whole list */
    }
  }
  return [...new Set(out)];
}

/**
 * Every URL worth trying, best first, deduplicated.
 *
 * Order is deliberate: URLs the author put in the event come first because they
 * are the author's stated preference, then their published server list. A caller
 * tries them in order and verifies each response against the hash, so a hostile
 * entry anywhere in the list cannot do worse than waste a request.
 */
export function candidateUrls(opts: {
  sha256: string;
  /** URLs carried in the event's `imeta` tag. */
  declared?: string[];
  /** Servers from the author's kind:10063 list. */
  servers?: string[];
  ext?: string;
}): string[] {
  const hash = opts.sha256.toLowerCase();
  if (!isSha256(hash)) return [];

  const out: string[] = [];
  const push = (u: string) => { if (!out.includes(u)) out.push(u); };

  for (const u of opts.declared ?? []) {
    // Only keep a declared URL if it addresses THIS blob. A declared URL for a
    // different hash is either a mistake or a substitution attempt.
    if (sha256FromUrl(u) === hash) push(u);
  }
  for (const s of opts.servers ?? []) push(blobUrl(s, hash, opts.ext ?? 'png'));

  return out;
}

/* ------------------------------------------------------------------ *
 * imeta
 * ------------------------------------------------------------------ */

export interface ImetaFields {
  urls: string[];
  sha256?: string;
  alt?: string;
  dim?: string;
  mime?: string;
}

/**
 * Build a NIP-92 `imeta` tag.
 *
 * The `x` field is the part that matters. Without it the image host is trusted;
 * with it the host is a cache, because anyone can check the bytes they were
 * served against what the author signed.
 */
export function buildImeta(f: ImetaFields): string[] {
  const tag = ['imeta'];
  for (const u of f.urls) tag.push(`url ${u}`);
  if (f.sha256) tag.push(`x ${f.sha256.toLowerCase()}`);
  if (f.mime) tag.push(`m ${f.mime}`);
  if (f.dim) tag.push(`dim ${f.dim}`);
  if (f.alt) tag.push(`alt ${f.alt}`);
  return tag;
}

/** Parse an `imeta` tag back into fields. Unknown keys are ignored, not an error. */
export function parseImeta(tag: string[]): ImetaFields | null {
  if (tag[0] !== 'imeta') return null;
  const f: ImetaFields = { urls: [] };
  for (const part of tag.slice(1)) {
    const sp = part.indexOf(' ');
    if (sp < 0) continue;
    const key = part.slice(0, sp);
    const val = part.slice(sp + 1);
    if (key === 'url') f.urls.push(val);
    else if (key === 'x' && isSha256(val.toLowerCase())) f.sha256 = val.toLowerCase();
    else if (key === 'alt') f.alt = val;
    else if (key === 'dim') f.dim = val;
    else if (key === 'm') f.mime = val;
  }
  return f;
}

/**
 * Which single URL goes in `og:image`.
 *
 * X reads one and caches it, so this is a durability bet rather than a preference:
 * pick the host most likely to still be answering in a year. The author's own
 * server wins when they have one — it is the only host they control, and it also
 * keeps the click-through and the image on the same domain.
 */
export function ogImageUrl(opts: {
  sha256: string;
  ownServer?: string;
  fallbackServers?: string[];
  ext?: string;
}): string | null {
  const hash = opts.sha256.toLowerCase();
  if (!isSha256(hash)) return null;
  const host = opts.ownServer ?? opts.fallbackServers?.[0];
  return host ? blobUrl(host, hash, opts.ext ?? 'png') : null;
}
