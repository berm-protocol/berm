/**
 * Public URL shape: `/@handle/slug`.
 *
 * WHY NOT A HASH. The composer originally emitted `/p/<16 hex>`, while the node —
 * the thing actually deployed at a domain — already used `/@handle/slug`. Two
 * shapes for one concept, and the node's was right for a reason that is not
 * cosmetic:
 *
 * X deboosts posts containing links, so the link that does get through has to
 * survive a human's split-second "is this spam?" judgement. `xonly.ai/p/a1b2c3d4`
 * reads as a tracking redirect. `their-site.com/@dorin/custody-honestly` reads as
 * a page somebody owns. Same infrastructure, opposite signal.
 *
 * It also puts the author's name in the thing they are publishing, which matters
 * when the alternative is that every user's card advertises our domain instead of
 * theirs.
 */

/** Maximum slug length. Long enough to be descriptive, short enough to read in a URL. */
export const MAX_SLUG = 60;

/**
 * Derive a slug from a title.
 *
 * Unicode letters and digits are kept rather than stripped, so a Japanese or
 * Cyrillic title produces a readable slug instead of an empty one. Percent-encoding
 * handles the rest; browsers display it decoded.
 */
export function slugify(input: string): string {
  const s = input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['’"“”]/g, '')
    // Anything that is not a letter, number or dash becomes a separator.
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');

  if (!s) return '';
  if (s.length <= MAX_SLUG) return s;
  // Cut on a dash so the slug never ends mid-word.
  const cut = s.slice(0, MAX_SLUG);
  const at = cut.lastIndexOf('-');
  return (at > MAX_SLUG * 0.5 ? cut.slice(0, at) : cut).replace(/-+$/, '');
}

/**
 * A slug that is always usable.
 *
 * Falls back to a short digest prefix when a title yields nothing — an emoji-only
 * heading, say. Distinguishing "derived" from "fallback" matters to the caller:
 * a derived slug is stable across edits to unrelated fields, a fallback is not
 * meaningful and should not be shown as though it were.
 */
export function slugOrDigest(title: string, digestHex: string): { slug: string; derived: boolean } {
  const s = slugify(title);
  if (s) return { slug: s, derived: true };
  return { slug: digestHex.slice(0, 12).toLowerCase(), derived: false };
}

/** Handle, normalised the way the URL will carry it — no leading @, lower case. */
export function normaliseHandle(handle: string): string {
  return handle.trim().replace(/^@+/, '').toLowerCase();
}

/**
 * The canonical page URL.
 *
 * `origin` is the author's own domain when they run a node, and the convenience
 * host otherwise. The shape is identical either way, so a user who later moves to
 * their own domain keeps the same path — and old links can be redirected rather
 * than broken.
 */
export function pageUrl(origin: string, handle: string, slug: string): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}/@${encodeURIComponent(normaliseHandle(handle))}/${encodeURIComponent(slug)}`;
}

/** Parse `/@handle/slug` back out of a path. Returns null when it is not that shape. */
export function parsePagePath(pathname: string): { handle: string; slug: string } | null {
  const m = /^\/@([^/]+)\/([^/]+)\/?$/.exec(pathname);
  if (!m) return null;
  try {
    return { handle: decodeURIComponent(m[1]!), slug: decodeURIComponent(m[2]!) };
  } catch {
    return null;
  }
}
