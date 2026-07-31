/**
 * The X share intent — the cheapest write to X that exists.
 *
 * WHY THIS AND NOT THE API. `https://x.com/intent/tweet?text=…` needs no
 * developer app, no OAuth token, no API key, no rate limit and costs nothing per
 * post. The user posts it themselves, in X's own composer, from their own
 * session — so there is no automation to justify and no "posted via" attribution.
 * It is also the one X write path that is not realistically revocable: every
 * share button on the web uses it.
 *
 * The protocol already relies on this for the proof post (`crypto/src/nip39.ts`).
 * This module generalises it, and adds the part that was missing: knowing whether
 * what we hand X will actually fit.
 *
 * TWO BUDGETS, both of which must pass:
 *
 *   1. X's own character budget. X does NOT count characters — it counts
 *      weighted units, where most non-Latin text costs double and every URL
 *      costs a flat 23 regardless of its real length.
 *   2. The length of the intent URL itself, AFTER percent-encoding. This is the
 *      one that bites: a single emoji can become twelve characters encoded, so
 *      a post that passes X's counter can still produce a URL that gets cut.
 *
 * A silently truncated post is the worst outcome available here — the user
 * believes they published their argument and actually published two thirds of
 * it. So `buildIntent` refuses rather than truncates.
 */

/* ------------------------------------------------------------------ *
 * X's weighted character count
 * ------------------------------------------------------------------ */

/**
 * Ranges that cost ONE unit. Everything else costs two.
 *
 * These are the weight-100 ranges from twitter-text's v3 configuration
 * (`defaultWeight: 200`, `scale: 100`). Latin, Cyrillic, Greek and most
 * punctuation are cheap; CJK, emoji and most other scripts are not.
 */
const CHEAP_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x10ff],
  [0x2000, 0x200d],
  [0x2010, 0x201f],
  [0x2032, 0x2037],
];

const isCheap = (cp: number) => CHEAP_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);

/** What X charges for any URL, however long or short. */
export const URL_WEIGHT = 23;

/** X's limit for a standard account. Premium raises it; this is the safe floor. */
export const X_LIMIT = 280;

/**
 * Conservative cap on the intent URL.
 *
 * NOT MEASURED — chosen. X does not document a limit for the intent endpoint and
 * we have not tested where it truncates, so this is deliberately well below any
 * plausible ceiling. Confirming the real number is a browser task, listed in the
 * README alongside the other empirical unknowns. Until then, erring low costs a
 * user nothing and erring high costs them their post.
 *
 * WHEN THIS CHECK ACTUALLY FIRES. The worst encoding ratio available is an
 * emoji: two units for twelve encoded characters, so six characters per unit. At
 * the standard 280-unit limit the URL therefore cannot exceed roughly 1,700
 * characters and X's counter always refuses first. This cap only becomes live
 * above ~333 units — that is, for premium accounts with a raised limit. It looks
 * redundant when read against a standard account and is not; `intent.test.ts`
 * pins the crossover so that deleting it fails a test rather than a user.
 */
export const MAX_INTENT_URL = 2000;

/**
 * TLDs recognised for bare-domain URL detection.
 *
 * WHY A LIST AT ALL. X counts `example.com` as 23 units even though it is 11
 * characters. If we counted it literally we would believe there was more room
 * than there is, and the user would meet X's error instead of ours — the unsafe
 * direction. So bare domains must be detected.
 *
 * HONEST LIMIT: this is not the IANA list. A URL on an unrecognised TLD is
 * counted literally, which under-counts against X. `headroom()` exists because
 * of that: it reports how close to the edge a post is, so the UI can refuse to
 * cut things fine.
 */
const TLDS =
  'com|net|org|edu|gov|mil|int|io|ai|co|xyz|app|dev|me|tv|fm|sh|gg|so|to|ly|is|it|de|fr|es|nl|se|no|fi|pl|ru|uk|us|ca|au|nz|jp|cn|kr|in|br|mx|ar|za|ch|at|be|cz|dk|gr|hu|ie|il|pt|ro|sk|tr|ua';

/**
 * URLs, in roughly the shape twitter-text finds them.
 *
 * Order matters: the scheme form must win over the bare form so that
 * `https://a.com/x` is matched once, not twice.
 */
const URL_RE = new RegExp(
  String.raw`https?:\/\/[^\s<>"]+` +
    String.raw`|www\.[^\s<>"]+` +
    String.raw`|\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:${TLDS})\b(?:\/[^\s<>"]*)?`,
  'gi',
);

/** Split text into URL and non-URL segments, in order. */
function segment(text: string): Array<{ url: boolean; text: string }> {
  const out: Array<{ url: boolean; text: string }> = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ url: false, text: text.slice(last, at) });
    out.push({ url: true, text: m[0] });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ url: false, text: text.slice(last) });
  return out;
}

/**
 * Graphemes, not code points.
 *
 * A ZWJ emoji sequence is several code points and one visible character, and X
 * charges for it once. `Intl.Segmenter` groups them correctly; the fallback
 * iterates code points and will over-count such sequences, which is the safe
 * direction.
 */
function graphemes(s: string): string[] {
  const Seg = (globalThis as { Intl?: { Segmenter?: unknown } }).Intl?.Segmenter;
  if (typeof Seg === 'function') {
    const seg = new (Seg as new (l?: string, o?: object) => Intl.Segmenter)(undefined, {
      granularity: 'grapheme',
    });
    return [...seg.segment(s)].map((g) => g.segment);
  }
  return [...s];
}

export interface WeightedCount {
  /** Units consumed, the way X counts them. */
  weighted: number;
  /** How many URLs were found and charged at the flat rate. */
  urls: number;
  /** Plain code-point length, for comparison. Never used for the budget. */
  characters: number;
}

/**
 * Count a post the way X counts it.
 *
 * Not the same as `text.length`, and the difference is not cosmetic: one CJK
 * sentence or three links is the gap between fitting and not.
 */
export function weightedLength(text: string): WeightedCount {
  let weighted = 0;
  let urls = 0;

  for (const part of segment(text)) {
    if (part.url) {
      weighted += URL_WEIGHT;
      urls += 1;
      continue;
    }
    for (const g of graphemes(part.text)) {
      // A grapheme is cheap only if every code point in it is cheap. One
      // expensive code point makes the whole cluster cost two.
      const cheap = [...g].every((ch) => isCheap(ch.codePointAt(0)!));
      weighted += cheap ? 1 : 2;
    }
  }

  return { weighted, urls, characters: [...text].length };
}

/* ------------------------------------------------------------------ *
 * Building the intent
 * ------------------------------------------------------------------ */

export interface IntentInput {
  /** The post body as the user wrote it. */
  text: string;
  /**
   * Canonical permalink. Passed as `url=` rather than concatenated into `text`
   * so X attaches it as the card source rather than treating it as prose.
   */
  url?: string;
  /** X's limit for this account. Standard 280; premium accounts far more. */
  limit?: number;
  /** Cap on the encoded intent URL. */
  maxUrl?: number;
}

export type IntentRefusal =
  | 'empty'
  | 'over-x-limit'
  | 'intent-url-too-long';

export interface IntentResult {
  ok: boolean;
  /** Present only when ok. Never a truncated URL. */
  href?: string;
  reason?: IntentRefusal;
  /** Human sentence naming the actual problem, for the UI. */
  message?: string;
  count: WeightedCount;
  /** Units still available under X's limit. Negative when over. */
  headroom: number;
  /** Encoded length of the intent URL that would have been produced. */
  urlLength: number;
}

const INTENT_BASE = 'https://x.com/intent/tweet';

/**
 * Build the share URL, or explain why not.
 *
 * Refuses rather than truncates. A truncating share button is worse than a
 * disabled one, because the user finds out after the fact and in public.
 */
export function buildIntent(input: IntentInput): IntentResult {
  const limit = input.limit ?? X_LIMIT;
  const maxUrl = input.maxUrl ?? MAX_INTENT_URL;

  const text = input.text.replace(/\s+$/, '');
  const url = input.url?.trim() || undefined;

  // The permalink costs X the flat URL rate on top of the prose.
  const count = weightedLength(text);
  const total = count.weighted + (url ? URL_WEIGHT + 1 /* separating space */ : 0);
  const headroom = limit - total;

  const params = new URLSearchParams();
  params.set('text', text);
  if (url) params.set('url', url);
  const href = `${INTENT_BASE}?${params.toString()}`;
  const urlLength = href.length;

  const base = { count, headroom, urlLength };

  if (!text && !url) {
    return { ok: false, reason: 'empty', message: 'Nothing to post yet.', ...base };
  }
  if (headroom < 0) {
    return {
      ok: false,
      reason: 'over-x-limit',
      message:
        `${total} of ${limit} units used — ${-headroom} over. ` +
        (count.urls ? `Each link counts as ${URL_WEIGHT} whatever its length. ` : '') +
        'X would reject this.',
      ...base,
    };
  }
  if (urlLength > maxUrl) {
    return {
      ok: false,
      reason: 'intent-url-too-long',
      message:
        `The share link would be ${urlLength} characters once encoded, over the ${maxUrl} ` +
        'limit this app enforces. Percent-encoding inflates emoji and non-Latin text, ' +
        'so a post can pass X’s counter and still be cut here.',
      ...base,
    };
  }

  return { ok: true, href, ...base };
}

/**
 * Units left under the limit, for a live counter.
 *
 * Separate from `buildIntent` so the UI can update on every keystroke without
 * constructing a URL it is not going to open.
 */
export function headroom(text: string, opts: { url?: string; limit?: number } = {}): number {
  const limit = opts.limit ?? X_LIMIT;
  const c = weightedLength(text);
  return limit - c.weighted - (opts.url ? URL_WEIGHT + 1 : 0);
}

/**
 * What the intent path can and cannot carry — stated in code so it is not
 * rediscovered as a bug.
 *
 * There is no `media` parameter. An image reaches a post only by being the
 * `og:image` of the linked page, which X's crawler fetches and unfurls. That is
 * why the card renderer and the permalink page exist, and why a post carrying a
 * card necessarily also carries a link.
 */
export const INTENT_CAPABILITIES = {
  text: true,
  url: true,
  /** No parameter exists. Cards arrive via unfurl, never upload. */
  mediaUpload: false,
  /** Intent opens a single composer; a thread cannot be pre-filled. */
  thread: false,
  /**
   * The critical one. Nothing comes back — no callback, no post id, no
   * confirmation. Opening the intent proves the composer was OFFERED and
   * nothing more, which is why no code in this package records a post as
   * having reached X.
   */
  deliveryConfirmation: false,
} as const;
