/**
 * Identity resolution — who legitimately claims an X account.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE:
 *
 *   `created_at` is author-asserted and proves NOTHING. Any key can sign an
 *   event dated 2009. Most Nostr tooling renders created_at as though it were a
 *   fact, which is exactly how a squatter wins an argument they should lose.
 *
 * So priority comes from an EXTERNAL anchor — an OpenTimestamps proof, which
 * puts the claim at a Bitcoin block height nobody can backdate. Claims without
 * an anchor are shown, but they can never outrank an anchored one, and they are
 * labelled for what they are.
 *
 * Layering: the interoperable claim lives in kind 0 as a standard NIP-39 `i`
 * tag, so Damus and Amethyst render it without knowing XOnly exists. The
 * XOnly-specific evidence — numeric account id, anchor, archived proof — lives
 * in a separate kind 30078 attestation. Standards where standards exist,
 * extensions where they don't, and no pollution of the former by the latter.
 */

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface Nip39Claim {
  platform: string;
  identity: string;
  /** For twitter, the id of the proof post. */
  proof: string;
}

export type AnchorState = 'anchored' | 'anchor-unverified' | 'none';

export interface Attestation {
  /** Permanent X user id. Handles recycle; numeric ids never do. */
  accountId?: string;
  anchorType?: string;
  anchorProof?: string;
  /** Claimed anchor time, in seconds. */
  anchorTime?: number;
  /** Wayback snapshot of the proof post — the only evidence that survives
   *  the account being deleted. */
  snapshotUrl?: string;
  witnessPubkey?: string;
  observedAt?: number;
}

export interface Claimant {
  pubkey: string;
  npub: string;
  displayName?: string;
  picture?: string;
  claim: Nip39Claim;
  /** The kind 0 carrying the NIP-39 tag. */
  profileEvent: NostrEvent;
  attestation?: Attestation;
  attestationEvent?: NostrEvent;
  anchorState: AnchorState;
  /** Time used for ordering. Only trustworthy when anchorState === 'anchored'. */
  priorityTime: number;
  /** Everything a reader should be told before believing this row. */
  caveats: string[];
}

export interface Resolution {
  handle: string;
  claimants: Claimant[];
  /** Highest-priority claim, or null when nothing is anchored and it would be
   *  irresponsible to name a winner. */
  primary: Claimant | null;
  conflict: boolean;
  /** True when NO claimant has an anchor — the explorer must not pick. */
  undecidable: boolean;
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

export function parseNip39(ev: NostrEvent): Nip39Claim[] {
  const out: Nip39Claim[] = [];
  for (const t of ev.tags) {
    if (t[0] !== 'i' || typeof t[1] !== 'string' || typeof t[2] !== 'string') continue;
    const idx = t[1].indexOf(':');
    if (idx <= 0 || idx === t[1].length - 1) continue;
    out.push({ platform: t[1].slice(0, idx), identity: t[1].slice(idx + 1), proof: t[2] });
  }
  return out;
}

export function parseAttestation(ev: NostrEvent): Attestation {
  const tag = (n: string) => ev.tags.find((t) => t[0] === n)?.[1];
  const num = (n: string) => {
    const v = tag(n);
    const p = v ? Number(v) : NaN;
    return Number.isFinite(p) ? p : undefined;
  };
  return {
    accountId: tag('x-account-id'),
    anchorType: tag('anchor-type'),
    anchorProof: tag('anchor-proof'),
    anchorTime: num('anchor-time'),
    snapshotUrl: tag('proof-snapshot'),
    witnessPubkey: tag('witness'),
    observedAt: num('observed-at'),
  };
}

/* ------------------------------------------------------------------ */
/* Anchor assessment                                                   */
/* ------------------------------------------------------------------ */

/**
 * How much an anchor is worth.
 *
 * Full OpenTimestamps verification means checking a Bitcoin block header, which
 * needs a chain source — and pulling one from a public API would quietly
 * reintroduce a trusted third party into the one place that must not have one.
 * So the browser checks the proof is well-formed and present, marks it
 * `anchor-unverified`, and links out so anyone can complete the check
 * themselves. Saying "unverified" is not a weakness; claiming otherwise
 * would be.
 */
export function assessAnchor(a?: Attestation): AnchorState {
  if (!a?.anchorProof || !a.anchorType) return 'none';
  if (a.anchorType !== 'opentimestamps') return 'anchor-unverified';
  if (!/^[A-Za-z0-9+/=]{40,}$/.test(a.anchorProof)) return 'none';
  if (!a.anchorTime) return 'anchor-unverified';
  return 'anchor-unverified';
}

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

const RANK: Record<AnchorState, number> = {
  anchored: 0,
  'anchor-unverified': 1,
  none: 2,
};

export function buildClaimant(
  profileEvent: NostrEvent,
  claim: Nip39Claim,
  npub: string,
  attestationEvent?: NostrEvent,
): Claimant {
  const attestation = attestationEvent ? parseAttestation(attestationEvent) : undefined;
  const anchorState = assessAnchor(attestation);
  const caveats: string[] = [];

  let meta: Record<string, unknown> = {};
  try { meta = JSON.parse(profileEvent.content || '{}'); } catch { /* profile is untrusted input */ }

  if (anchorState === 'none') {
    caveats.push(
      'No timestamp anchor. The date below is self-declared by the signer and proves nothing — ' +
      'any key can sign an event dated to any year.',
    );
  }
  if (!attestation?.accountId) {
    caveats.push(
      'No X account id recorded. The claim is bound to the handle, and handles are recycled ' +
      'after an account is deleted — so this cannot distinguish the original owner from a later one.',
    );
  }
  if (!attestation?.snapshotUrl) {
    caveats.push(
      'No archived copy of the proof post. If the X account is deleted, the proof disappears with it.',
    );
  }
  if (attestationEvent && attestationEvent.pubkey !== profileEvent.pubkey) {
    caveats.push('Attestation was signed by a different key than the profile. Treat with suspicion.');
  }

  return {
    pubkey: profileEvent.pubkey,
    npub,
    displayName: typeof meta.display_name === 'string' ? meta.display_name
               : typeof meta.name === 'string' ? meta.name : undefined,
    picture: typeof meta.picture === 'string' ? meta.picture : undefined,
    claim,
    profileEvent,
    attestation,
    attestationEvent,
    anchorState,
    // An unanchored claim falls back to created_at purely so the list has an
    // order. It is never allowed to outrank an anchored one — see RANK.
    priorityTime: attestation?.anchorTime ?? profileEvent.created_at,
    caveats,
  };
}

export function resolve(handle: string, claimants: Claimant[]): Resolution {
  const sorted = [...claimants].sort((a, b) => {
    const r = RANK[a.anchorState] - RANK[b.anchorState];
    if (r !== 0) return r;
    return a.priorityTime - b.priorityTime;
  });

  const anchored = sorted.filter((c) => c.anchorState !== 'none');
  const undecidable = anchored.length === 0 && sorted.length > 1;

  return {
    handle,
    claimants: sorted,
    // With several unanchored claims there is no honest basis for naming one.
    // Refusing to choose is the correct output, not a failure.
    primary: undecidable ? null : sorted[0] ?? null,
    conflict: sorted.length > 1,
    undecidable,
  };
}

export function proofUrl(claim: Nip39Claim): string {
  if (claim.platform === 'twitter') {
    return `https://x.com/${encodeURIComponent(claim.identity)}/status/${encodeURIComponent(claim.proof)}`;
  }
  if (claim.platform === 'github') {
    return `https://gist.github.com/${encodeURIComponent(claim.identity)}/${encodeURIComponent(claim.proof)}`;
  }
  return '';
}

/** The exact text NIP-39 requires in the proof post. */
export function expectedProofText(npub: string): string {
  return `Verifying my account on nostr My Public Key: "${npub}"`;
}
