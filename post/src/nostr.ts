/**
 * The signed half.
 *
 * ORDER IS THE WHOLE DESIGN. The Nostr event is built and published FIRST, and it
 * does not depend on X in any way. Only afterwards is the user offered a
 * pre-filled X composer. If they never click it, or X is down, or X bans the
 * account an hour later, the post still exists, signed, on relays.
 *
 * That inversion is the entire product claim, so it is enforced here rather than
 * left to the UI: this module has no knowledge of whether an intent was opened,
 * and there is no parameter through which the UI could tell it.
 *
 * WHAT THIS FILE MUST NEVER DO. Record that a post reached X. Opening the intent
 * URL returns nothing — no callback, no post id, no confirmation (see
 * `INTENT_CAPABILITIES`). Writing an `x_posted` tag would be asserting something
 * unknown, which is the same error as rendering `claimed` as `verified`. A node
 * that later FINDS the post on X may upgrade the record; the composer may not.
 * `test/nostr.test.ts` asserts this by scanning every tag this module can emit.
 */

import type { Post } from './model.js';
import { attachmentText, cardAlt } from './model.js';

/** Minimal unsigned event. The signer fills `id`, `pubkey`, `sig`. */
export interface UnsignedEvent {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

export interface PostEventOptions {
  /** Canonical permalink on the author's node. Becomes an `r` tag. */
  permalink?: string;
  /** Absolute URL of the rendered card, for clients that show images. */
  cardUrl?: string;
  /**
   * Every host that may hold the card. Blossom addresses blobs by hash, so the
   * same card has the same path on every server and a client can fall back.
   */
  cardUrls?: string[];
  /**
   * SHA-256 of the card bytes.
   *
   * WITHOUT THIS THE IMAGE HOST IS TRUSTED. The card is the entire visual payload
   * of the post on X, and it is served by a host that may not be the author — so
   * whoever holds that host can substitute the picture and the signed event will
   * not contradict them. Committing to the hash turns the host into a cache:
   * anyone can check the bytes they were served against what the author signed.
   *
   * Hashed locally BEFORE publishing, so the commitment does not depend on any
   * upload succeeding.
   */
  cardSha256?: string;
  /** Actual pixel dimensions of the card file, not the layout box. */
  cardDim?: string;
  /** Unix seconds. Injected so tests are deterministic. */
  createdAt: number;
  /** Subject line for clients that show one (NIP-14). */
  subject?: string;
}

/**
 * Tag names this module is permitted to emit.
 *
 * An allow-list rather than a convention, because the failure being prevented is
 * a future edit adding `x_posted` or `posted_to` in good faith. The test walks
 * generated events against this list, so adding a tag means changing this line
 * and thinking about why.
 */
export const ALLOWED_TAGS = ['r', 'imeta', 'alt', 'subject', 't'] as const;

/**
 * Build the kind-1 note.
 *
 * Kind 1 and not 30023: this is a short post, it is not addressable, and it
 * should appear in ordinary Nostr timelines next to everything else. An article
 * is a different artifact and the editor already handles it.
 */
export function buildPostEvent(p: Post, o: PostEventOptions): UnsignedEvent {
  const tags: string[][] = [];

  // The prose, then the copyable form of the artifact, then the permalink.
  // The artifact goes in `content` in full — a Nostr client should never have to
  // fetch our page to read a table we published.
  const parts: string[] = [];
  if (p.text.trim()) parts.push(p.text.trim());
  if (p.attachment) {
    const body = attachmentText(p.attachment).replace(/\s+$/, '');
    if (body) {
      parts.push(p.attachment.kind === 'code' || p.attachment.kind === 'art'
        ? '```' + (p.attachment.kind === 'code' ? (p.attachment.language ?? '') : '') + '\n' + body + '\n```'
        : body);
    }
  }
  if (o.permalink) parts.push(o.permalink);

  if (o.subject?.trim()) tags.push(['subject', o.subject.trim()]);
  if (o.permalink) tags.push(['r', o.permalink]);

  // NIP-92 image metadata: every host, the hash, the dimensions, and alt text.
  // `x` is the load-bearing field — see PostEventOptions.cardSha256.
  const cardUrls = o.cardUrls ?? (o.cardUrl ? [o.cardUrl] : []);
  if (cardUrls.length) {
    const imeta = ['imeta', ...cardUrls.map((u) => `url ${u}`)];
    if (o.cardSha256) imeta.push(`x ${o.cardSha256.toLowerCase()}`);
    imeta.push('m image/png');
    imeta.push(`dim ${o.cardDim ?? '2400x1260'}`);
    imeta.push(`alt ${cardAlt(p)}`);
    tags.push(imeta);
    tags.push(['alt', cardAlt(p)]);
  }

  return {
    kind: 1,
    created_at: o.createdAt,
    tags,
    content: parts.join('\n\n'),
  };
}

/**
 * The approval sentence.
 *
 * A signer that asks "sign this?" without naming the consequence has trained the
 * user to click yes. This one states what is published, where, and — critically —
 * what is NOT happening: nothing is sent to X by signing.
 */
export function describePostForApproval(p: Post, o: PostEventOptions): string {
  const what = p.attachment
    ? {
        table: 'a post with a table',
        code: 'a post with a code block',
        art: 'a post with a character diagram',
        quote: 'a post with a pull quote',
      }[p.attachment.kind]
    : 'a short post';

  const where = o.permalink ? ' and links to your own page' : '';
  return (
    `Publish ${what} to your relays${where}. ` +
    'Signing publishes to Nostr only — nothing is sent to X until you post it yourself.'
  );
}

/**
 * States a post can be in. There is no `posted` state, and that is the point.
 *
 *   draft    nothing signed, nothing published
 *   signed   published to relays, permanent, independent of X
 *   offered  X's composer was opened, pre-filled. Whether the user pressed Post
 *            is unknown to this application and always will be.
 */
export type PostState = 'draft' | 'signed' | 'offered';

/** Wording for each state. `offered` deliberately never says "posted to X". */
export const STATE_LABEL: Record<PostState, string> = {
  draft: 'Not published',
  signed: 'Signed and published to Nostr',
  offered: 'X composer opened — we cannot confirm whether you posted',
};
