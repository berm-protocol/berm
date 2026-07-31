/**
 * Berm v2 §3.4 — X ↔ npub binding via NIP-39 external identity claims.
 *
 * Channel A (here): a public, permanent, third-party-verifiable claim carried
 * in the user's kind 0 `i` tags. The proof is the ID of a post the user made
 * themselves — no API automation, no scraping, nothing that touches X's
 * write endpoints.
 *
 * Channel B (node-side, not in this module): a live /2/users/me check at OAuth
 * time, which catches handle transfers that Channel A alone cannot.
 *
 * v1 invented `["x-identity", "<numeric id>"]` with an undefined
 * "proof_verification_token". Both are removed: a claim nobody can verify is
 * not a binding, it is a decoration.
 */

import { nip39ProofText } from './constants.js';
import { BindingVerificationError } from './errors.js';

export type Platform = 'twitter' | 'github' | 'mastodon' | 'telegram';

export interface IdentityClaim {
  readonly platform: Platform;
  readonly identity: string;
  readonly proof: string;
}

/** Binding strength shown in the UI. These three MUST NOT be conflated —
 *  a "claimed" badge rendered as "verified" is an impersonation vector. */
export type BindingState = 'verified' | 'claimed' | 'unlinked';

/** Build a NIP-39 `i` tag. */
export function buildClaimTag(claim: IdentityClaim): string[] {
  if (!claim.identity || claim.identity.includes(':')) {
    throw new BindingVerificationError(`invalid identity "${claim.identity}"`);
  }
  if (!claim.proof) {
    throw new BindingVerificationError('proof is required — an unprovable claim is not a binding');
  }
  return ['i', `${claim.platform}:${claim.identity}`, claim.proof];
}

/** Parse `i` tags out of a kind 0 event's tag array. Malformed tags are
 *  dropped rather than throwing, since third-party events are untrusted. */
export function parseClaimTags(tags: string[][]): IdentityClaim[] {
  const out: IdentityClaim[] = [];
  for (const t of tags) {
    if (t[0] !== 'i' || typeof t[1] !== 'string' || typeof t[2] !== 'string') continue;
    const idx = t[1].indexOf(':');
    if (idx <= 0 || idx === t[1].length - 1) continue;
    const platform = t[1].slice(0, idx) as Platform;
    const identity = t[1].slice(idx + 1);
    if (!identity || !t[2]) continue;
    out.push({ platform, identity, proof: t[2] });
  }
  return out;
}

/** The text the user must post on X. Defined by NIP-39; not ours to change. */
export const proofText = nip39ProofText;

/** URL a verifier fetches to check a twitter claim. */
export function proofUrl(claim: IdentityClaim): string {
  switch (claim.platform) {
    case 'twitter':
      return `https://twitter.com/${claim.identity}/status/${claim.proof}`;
    case 'github':
      return `https://gist.github.com/${claim.identity}/${claim.proof}`;
    case 'mastodon':
      return `https://${claim.identity}/${claim.proof}`;
    case 'telegram':
      return `https://t.me/${claim.proof}`;
  }
}

/**
 * Does `postText` prove ownership of `npub`?
 *
 * Exact-substring match on the NIP-39 text. Deliberately strict: a fuzzy
 * matcher here would accept a post that merely mentions someone else's npub.
 */
export function proofTextMatches(postText: string, npub: string): boolean {
  return postText.includes(proofText(npub));
}

/**
 * Combine Channel A and Channel B into the badge state.
 *
 * @param claim         the NIP-39 claim found in kind 0, if any
 * @param liveHandle    handle returned by /2/users/me this session, if any
 */
export function resolveBindingState(
  claim: IdentityClaim | undefined,
  liveHandle: string | undefined,
): BindingState {
  if (!claim) return 'unlinked';
  if (!liveHandle) return 'claimed';
  const match = claim.identity.toLowerCase() === liveHandle.toLowerCase();
  return match ? 'verified' : 'claimed';
}

/** Share-intent URL. The user posts this themselves — one click, no API,
 *  no automation, nothing that can be read as programmatic publishing. */
export function shareIntentUrl(npub: string): string {
  return `https://x.com/intent/tweet?text=${encodeURIComponent(proofText(npub))}`;
}
