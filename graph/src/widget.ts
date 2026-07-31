/**
 * Social proof, computed in the reader's browser.
 *
 * THE TENSION: personalised social proof requires someone to know both what you
 * are reading AND who you follow. There are only three places that can happen.
 *
 *   relay knows      — query {kinds:[7], authors:[...your follows]} and the
 *                      relay learns your entire graph
 *   node knows       — render per-reader server-side and the node learns both
 *   your browser     — the only party that already knew both
 *
 * So the node embeds the article's PUBLIC reaction set — identical bytes for
 * every reader, fully cacheable — and the intersection happens here, against a
 * follow list decrypted locally.
 *
 * The node already knew you requested the page, so this adds ZERO information.
 * And the guarantee is observable rather than asserted: two readers receive
 * byte-identical responses, which anyone can diff. A personalised response would
 * prove the node knew something about the reader; an identical one proves it
 * did not.
 */

export interface ReactionEvent {
  id: string;
  pubkey: string;
  kind: number;
  content: string;
  created_at: number;
}

/** What the node embeds. Public, article-scoped, reader-independent. */
export interface EmbeddedReactions {
  /** `30023:<pubkey>:<slug>` */
  address: string;
  events: ReactionEvent[];
  /** When the node last refreshed this from relays. */
  fetched_at: number;
}

export const KIND_REACTION = 7;
export const KIND_COMMENT = 1111;
export const KIND_BOOKMARKS = 10003;
export const KIND_REPOST = 6;

export interface SocialProof {
  reacted: string[];
  commented: string[];
  bookmarked: string[];
  reposted: string[];
  /** People you follow who did any of the above. */
  total: number;
}

/**
 * Intersect the embedded set with the reader's follow list.
 *
 * Pure and synchronous on purpose: no network call happens here, and a function
 * that cannot reach the network cannot leak to it. That property is worth more
 * than any promise in a privacy policy, because it is checkable by reading forty
 * lines of code.
 */
export function socialProof(
  embedded: EmbeddedReactions,
  follows: ReadonlySet<string>,
): SocialProof {
  const bucket = { reacted: new Set<string>(), commented: new Set<string>(),
                   bookmarked: new Set<string>(), reposted: new Set<string>() };

  for (const ev of embedded.events) {
    if (!follows.has(ev.pubkey)) continue;
    switch (ev.kind) {
      case KIND_REACTION:  bucket.reacted.add(ev.pubkey); break;
      case KIND_COMMENT:   bucket.commented.add(ev.pubkey); break;
      case KIND_BOOKMARKS: bucket.bookmarked.add(ev.pubkey); break;
      case KIND_REPOST:    bucket.reposted.add(ev.pubkey); break;
      default: break;   // unknown kinds are ignored, not counted
    }
  }

  const everyone = new Set<string>([
    ...bucket.reacted, ...bucket.commented, ...bucket.bookmarked, ...bucket.reposted,
  ]);

  return {
    reacted: [...bucket.reacted],
    commented: [...bucket.commented],
    bookmarked: [...bucket.bookmarked],
    reposted: [...bucket.reposted],
    total: everyone.size,
  };
}

/**
 * The rendered line.
 *
 * Returns null rather than "0 people you follow" — an empty widget is noise, and
 * during the cold-start period it would appear on nearly every article and read
 * as broken rather than as early.
 */
export function describeSocialProof(p: SocialProof, names?: ReadonlyMap<string, string>): string | null {
  if (p.total === 0) return null;

  const parts: string[] = [];
  if (p.reacted.length) parts.push(`${p.reacted.length} reacted`);
  if (p.commented.length) parts.push(`${p.commented.length} commented`);
  if (p.bookmarked.length) parts.push(`${p.bookmarked.length} bookmarked`);
  if (p.reposted.length) parts.push(`${p.reposted.length} reposted`);

  // Naming one person is far more persuasive than a count, and costs nothing
  // extra: the reader already knows who they follow.
  const first = names?.get(p.reacted[0] ?? p.commented[0] ?? p.bookmarked[0] ?? p.reposted[0] ?? '');
  const who = first
    ? p.total === 1 ? `@${first}` : `@${first} and ${p.total - 1} other${p.total > 2 ? 's' : ''}`
    : `${p.total} ${p.total === 1 ? 'person' : 'people'} you follow`;

  return `${who} · ${parts.join(' · ')}`;
}
