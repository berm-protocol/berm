/**
 * Profile and binding resolution, shared by every backend.
 *
 * THE RULE THIS FILE ENFORCES: a NIP-39 `i` tag in a profile is a *claim*. The
 * user wrote it themselves; anyone can write anything. It becomes `verified`
 * only after something fetched the proof post and matched it — which a browser
 * cannot do against X, because there is no CORS-open endpoint for it.
 *
 * So this returns `claimed`, always, and the upgrade to `verified` is the job
 * of a node that can make the server-side check (Berm v2 §3.5). Rendering
 * `claimed` as `verified` is an impersonation vector, not a cosmetic bug, and
 * the cheapest way to never ship that bug is to make the optimistic value
 * impossible to produce here.
 */

import { nip19 } from 'nostr-tools';
import { queryRelays } from './relay.js';
import type { BindingInfo, SignedEvent } from './types.js';

export interface ProfileInfo {
  displayName: string;
  picture?: string;
  binding: BindingInfo;
}

/** Parse a NIP-39 `i` tag value: `twitter:handle` / `x:handle`. */
export function parseXClaim(tags: string[][]): string | undefined {
  for (const t of tags) {
    if (t[0] !== 'i' || !t[1]) continue;
    const m = /^(?:twitter|x):(.+)$/i.exec(t[1]);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

export function profileFromEvent(ev: SignedEvent | undefined, fallbackNpub: string): ProfileInfo {
  const short = `${fallbackNpub.slice(0, 10)}…${fallbackNpub.slice(-4)}`;
  if (!ev) return { displayName: short, binding: { state: 'unlinked' } };

  let meta: Record<string, unknown> = {};
  try { meta = JSON.parse(ev.content) as Record<string, unknown>; } catch { /* kind 0 with junk content */ }

  const handle = parseXClaim(ev.tags);
  const name = typeof meta.display_name === 'string' && meta.display_name.trim()
    ? meta.display_name
    : typeof meta.name === 'string' && meta.name.trim() ? meta.name : short;

  return {
    displayName: name,
    picture: typeof meta.picture === 'string' ? meta.picture : undefined,
    binding: handle ? { state: 'claimed', handle } : { state: 'unlinked' },
  };
}

/** Best-effort. A missing profile is normal for a new identity, never an error. */
export async function fetchProfile(pubkeyHex: string, relays: string[]): Promise<ProfileInfo> {
  const npub = nip19.npubEncode(pubkeyHex);
  try {
    const events = await queryRelays([{ kinds: [0], authors: [pubkeyHex], limit: 1 }], relays);
    // Relays may return several; the newest wins.
    const newest = events.sort((a, b) => b.created_at - a.created_at)[0];
    return profileFromEvent(newest, npub);
  } catch {
    return profileFromEvent(undefined, npub);
  }
}
