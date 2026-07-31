/**
 * NIP-01 canonical serialization and event IDs.
 *
 * id = sha256(utf8(JSON.stringify([0, pubkey, created_at, kind, tags, content])))
 *
 * The serialization has no whitespace and no unnecessary escaping. Getting
 * this wrong produces events that relays silently reject, so it is pinned by
 * test vector V3.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { D_TAG_PATTERN } from './constants.js';

const enc = new TextEncoder();

export interface EventTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

export interface UnsignedEvent extends EventTemplate {
  pubkey: string;
}

export interface SignedEvent extends UnsignedEvent {
  id: string;
  sig: string;
}

/** NIP-01 canonical form. Array order is fixed and MUST NOT change. */
export function serializeEvent(e: UnsignedEvent): string {
  return JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]);
}

export function eventId(e: UnsignedEvent): string {
  return bytesToHex(sha256(enc.encode(serializeEvent(e))));
}

/* ------------------------------------------------------------------ */
/* Berm conformance helpers (§4)                                       */
/* ------------------------------------------------------------------ */

/** Addressable events MUST namespace their `d` tag as berm:<ns>:<version>,
 *  so independently built mini-apps cannot collide in a user's kind 30078. */
export function assertConformantDTag(tags: string[][]): void {
  const d = tags.find((t) => t[0] === 'd')?.[1];
  if (!d) throw new Error('addressable event is missing a `d` tag');
  if (!D_TAG_PATTERN.test(d)) {
    throw new Error(
      `\`d\` tag "${d}" is not of the form berm:<namespace>:<version> (Berm v2 §4.3)`,
    );
  }
}

/** Kind register from §4.1. Anything outside this set needs a spec change. */
export const KIND = {
  METADATA: 0,
  DELETION: 5,
  GIFT_WRAP: 1059,
  COMMENT: 1111,        // NIP-22 — NOT kind 1
  RELAY_LIST: 10002,    // NIP-65
  FOLLOW_SET: 30000,    // NIP-51 (30001 is deprecated)
  APP_DATA: 30078,      // NIP-78
  LONG_FORM: 30023,     // NIP-23
} as const;

/** Guard against the v1 mistake of publishing threaded replies as kind 1,
 *  which pollutes every global feed on the network. */
export function assertCommentKind(kind: number): void {
  if (kind === 1) {
    throw new Error(
      'Comments MUST use kind 1111 (NIP-22). Kind 1 is a top-level note and ' +
        'publishing replies as kind 1 spams global feeds (Berm v2 §4.1).',
    );
  }
  if (kind !== KIND.COMMENT) {
    throw new Error(`Expected comment kind ${KIND.COMMENT}, got ${kind}`);
  }
}
