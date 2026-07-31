/**
 * The claimant index, and the matching rule.
 *
 * THE BRIDGE PROBLEM: `following.js` holds numeric account IDs; a NIP-39 claim
 * holds a handle (`twitter:dorian`). There is no free mapping between them.
 *
 * The bridge is an `x_uid` tag added to the identity attestation, verified in
 * the SAME server-side fetch that upgrades `claimed` → `verified`: the proof
 * post page carries the author's numeric id, so one fetch confirms both. No API
 * call, no OAuth, no developer app.
 *
 * THE MATCHING RULE, and why it is strict: only `verified` entries may match. A
 * self-asserted `x_uid` would let someone claim the id of a popular account and
 * be auto-followed by everyone who imports an archive. It is cheap to exploit,
 * trivially scalable, and would be the first thing written up about us.
 *
 * WHY THE WHOLE INDEX IS DOWNLOADED: asking a server "is account 12345 a
 * claimant?" hands over your follow list one question at a time. Downloading the
 * entire index reveals nothing — every entry in it is already public — and the
 * matching happens on your machine. At launch scale the index is a few hundred
 * kilobytes. When that stops being true the answer is a Bloom filter, not
 * per-account queries.
 */

export interface Claimant {
  /** X numeric account id. */
  uid: string;
  npub: string;
  pubkey: string;
  handle: string;
  /** Only `true` entries are eligible to match. */
  verified: boolean;
}

export interface ClaimantIndex {
  v: 1;
  generated_at: number;
  claimants: Claimant[];
}

export interface Match {
  uid: string;
  pubkey: string;
  npub: string;
  handle: string;
}

export interface MatchResult {
  matched: Match[];
  /** Present in the index but not verified — deliberately excluded. */
  rejectedUnverified: number;
  /** Followed accounts with no claimant entry at all. The usual case. */
  unmatched: number;
  /** Already in the user's existing list, so the import adds nothing. */
  alreadyFollowed: Match[];
}

/**
 * Intersect a followed-uid list with the claimant index. Pure, local, and
 * takes the existing follow set so the caller can show a real diff instead of
 * a count that silently includes people already followed.
 */
export function matchFollowing(
  uids: readonly string[],
  index: ClaimantIndex,
  alreadyFollowing: ReadonlySet<string> = new Set(),
): MatchResult {
  const byUid = new Map<string, Claimant>();
  for (const c of index.claimants) {
    // Last write wins is wrong here: two entries for one uid means someone is
    // contesting an identity, and picking either silently is the bug. Keep the
    // verified one; if both are verified, keep neither.
    const prev = byUid.get(c.uid);
    if (!prev) { byUid.set(c.uid, c); continue; }
    if (prev.verified && c.verified) byUid.set(c.uid, { ...c, verified: false });
    else if (c.verified) byUid.set(c.uid, c);
  }

  const matched: Match[] = [];
  const alreadyFollowed: Match[] = [];
  let rejectedUnverified = 0;
  let unmatched = 0;

  for (const uid of uids) {
    const c = byUid.get(uid);
    if (!c) { unmatched++; continue; }
    if (!c.verified) { rejectedUnverified++; continue; }

    const m: Match = { uid: c.uid, pubkey: c.pubkey, npub: c.npub, handle: c.handle };
    if (alreadyFollowing.has(c.pubkey)) alreadyFollowed.push(m);
    else matched.push(m);
  }

  return { matched, rejectedUnverified, unmatched, alreadyFollowed };
}

/**
 * Expected match count if claimants were spread uniformly across X.
 *
 * Exposed so the UI can show a user why their result is empty rather than
 * leaving them to conclude the feature is broken. The number is brutal at
 * launch, and the honest framing is that this works through DENSITY — adoption
 * concentrated in one community — not through scale.
 */
export function expectedUniformMatches(
  followedCount: number,
  claimantCount: number,
  activeXAccounts = 500_000_000,
): number {
  return (followedCount * claimantCount) / activeXAccounts;
}
