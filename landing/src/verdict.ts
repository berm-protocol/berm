/**
 * The verdict — what a visitor's own browser concludes about the page it is
 * looking at.
 *
 * THE PROBLEM THIS SOLVES. A landing page renders content and asks to be
 * believed. Every platform does this and none of them can be checked. Here the
 * page declares which signed event it claims to be rendering, and the visitor's
 * browser fetches that event from relays, re-verifies the signature locally, and
 * compares. So the claim is not "this server says the content is real" — it is
 * "this server handed you a rendering and your own browser checked it."
 *
 * WHY THE EVENT ID MAKES THE COMPARISON STRONG. A Nostr event id is a hash over
 * its content (NIP-01). So an event fetched by id cannot have content other than
 * what that id commits to. A `mismatch` therefore has exactly one meaning: the
 * page rendered something the signed event does not say. Stale, or lying. There
 * is no third innocent explanation, which is why it is never softened.
 *
 * THREE STATES, and the middle one is the point:
 *
 *   verified      enough relays returned the event, signatures check, the page's
 *                 rendering matches the signed content
 *   unverified    nothing to compare against — unreachable relays, no relay had
 *                 it, or every copy offered was forged. UNKNOWN, not fine.
 *   mismatch      a valid signed copy exists and it disagrees with this page
 *
 * The same machinery grades two subjects: the event, and the card image bytes
 * against the `x <sha256>` the author committed to. Both can be substituted by a
 * host; both are therefore checked.
 */

/** A signed Nostr event, as fetched from a relay. */
export interface FetchedEvent {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  sig: string;
}

export type VerdictState = 'verified' | 'unverified' | 'mismatch';

export interface Verdict {
  state: VerdictState;
  /** True ONLY for `verified`. Never derive this from `state !== 'mismatch'`. */
  ok: boolean;
  /** One sentence a visitor can act on. */
  message: string;
  /** Relays that returned a validly signed copy of the declared event. */
  corroborating: string[];
  /** Relays that answered with something whose signature did not verify. */
  servedForgery: string[];
  /** Relays that did not answer, or did not have it. */
  silent: string[];
}

export interface EvidenceItem {
  relay: string;
  /** null when the relay answered with nothing, or could not be reached. */
  event: FetchedEvent | null;
  /**
   * Whether the signature verified. Passed in rather than computed here so this
   * module stays pure and testable — the caller uses nostr-tools in the browser.
   */
  signatureValid?: boolean;
}

export interface VerdictInput {
  /** Event id this page claims to be rendering. */
  declaredId: string;
  /** Author pubkey this page claims. */
  declaredPubkey: string;
  /**
   * The content the page actually rendered, normalised the same way on both
   * sides. If this does not match the signed content, the page is wrong.
   */
  renderedContent: string;
  evidence: EvidenceItem[];
  /**
   * How many corroborating relays are needed. Two by default, for the same
   * reason publishing requires two: one relay is a single point of failure
   * wearing the costume of a fact.
   */
  quorum?: number;
}

/**
 * Compare rendered content against the signed original.
 *
 * Whitespace at the ends is insignificant — a renderer may trim. Nothing else is
 * normalised, deliberately: collapsing internal whitespace would let a page
 * reflow a table and still claim a match.
 */
export function contentMatches(rendered: string, signed: string): boolean {
  return rendered.replace(/\s+$/, '') === signed.replace(/\s+$/, '');
}

export function judge(input: VerdictInput): Verdict {
  const quorum = input.quorum ?? 2;

  const corroborating: string[] = [];
  const servedForgery: string[] = [];
  const silent: string[] = [];
  let disagreeing: FetchedEvent | null = null;

  for (const item of input.evidence) {
    if (!item.event) {
      silent.push(item.relay);
      continue;
    }
    // A forged copy is not evidence in either direction. It says something about
    // the relay and nothing about our rendering, so it is counted separately and
    // never allowed to satisfy the quorum.
    if (item.signatureValid !== true) {
      servedForgery.push(item.relay);
      continue;
    }
    // Wrong id or wrong author means the relay answered a different question.
    if (item.event.id !== input.declaredId || item.event.pubkey !== input.declaredPubkey) {
      silent.push(item.relay);
      continue;
    }
    if (!contentMatches(input.renderedContent, item.event.content)) {
      disagreeing = item.event;
      continue;
    }
    corroborating.push(item.relay);
  }

  // Mismatch outranks everything. A single validly signed copy that disagrees is
  // proof this page is wrong, and no number of agreeing relays makes that untrue.
  if (disagreeing) {
    return {
      state: 'mismatch',
      ok: false,
      message:
        'This page does not match the signed original. A relay returned a validly ' +
        'signed copy of this post whose content differs from what is shown here. ' +
        'Trust the signed copy, not this page.',
      corroborating,
      servedForgery,
      silent,
    };
  }

  if (corroborating.length >= quorum) {
    return {
      state: 'verified',
      ok: true,
      message:
        `Signed by this author and confirmed byte-for-byte against ` +
        `${corroborating.length} independent relays, checked in your browser.`,
      corroborating,
      servedForgery,
      silent,
    };
  }

  // Everything else is unknown, and unknown never gets a tick. Distinguishing the
  // reasons matters because "one relay agreed" and "three relays served
  // forgeries" are very different things to tell somebody.
  const why =
    servedForgery.length > 0
      ? `${servedForgery.length} relay(s) returned an invalid signature and were discarded`
      : corroborating.length > 0
        ? `only ${corroborating.length} of ${quorum} relays confirmed it`
        : 'no relay returned this post';

  return {
    state: 'unverified',
    ok: false,
    message:
      `Not confirmed — ${why}. This page may be accurate; your browser could not ` +
      'prove it. Open the post in a Nostr client to check independently.',
    corroborating,
    servedForgery,
    silent,
  };
}

/* ------------------------------------------------------------------ *
 * The card image
 * ------------------------------------------------------------------ */

export interface CardVerdict {
  state: VerdictState;
  ok: boolean;
  message: string;
  expected: string;
  observed?: string;
}

/**
 * Grade the card bytes against the hash the author committed to.
 *
 * The card is the entire visual payload of the post on X, and it is served by a
 * host that may not be the author. Without this check, whoever holds that host
 * can substitute the image and the signed event will not contradict them — the
 * post would say one thing and the picture in the feed another.
 *
 * `observedSha256` is computed by the caller (WebCrypto in the browser), so this
 * stays pure.
 */
export function judgeCard(expectedSha256: string, observedSha256: string | null): CardVerdict {
  const expected = expectedSha256.toLowerCase();

  if (!/^[0-9a-f]{64}$/.test(expected)) {
    return {
      state: 'unverified',
      ok: false,
      message: 'This post did not commit to an image hash, so the image cannot be checked.',
      expected,
    };
  }

  if (observedSha256 === null) {
    return {
      state: 'unverified',
      ok: false,
      message: 'Could not fetch the image to check it.',
      expected,
    };
  }

  const observed = observedSha256.toLowerCase();
  if (observed !== expected) {
    return {
      state: 'mismatch',
      ok: false,
      message:
        'The image served here is not the image the author signed for. ' +
        'Someone with access to the image host has replaced it.',
      expected,
      observed,
    };
  }

  return {
    state: 'verified',
    ok: true,
    message: 'The image matches the hash the author published.',
    expected,
    observed,
  };
}

/**
 * The single line shown above the fold.
 *
 * Both subjects collapse into one sentence, and the rule is that the WORST state
 * wins. A page whose text verifies but whose image was swapped is not a verified
 * page — and showing a tick because the majority of checks passed is how a
 * partial failure gets read as a pass.
 */
export function summarise(post: Verdict, card?: CardVerdict): { state: VerdictState; line: string } {
  const rank: Record<VerdictState, number> = { mismatch: 0, unverified: 1, verified: 2 };
  const worst = card && rank[card.state] < rank[post.state] ? card.state : post.state;

  if (worst === 'mismatch') {
    const which = card?.state === 'mismatch' && post.state !== 'mismatch' ? 'image' : 'content';
    return { state: 'mismatch', line: `Does not match the signed original (${which}).` };
  }
  if (worst === 'unverified') {
    return { state: 'unverified', line: 'Not confirmed against relays.' };
  }
  return {
    state: 'verified',
    line: `Verified against ${post.corroborating.length} relays in your browser.`,
  };
}
