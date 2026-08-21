/**
 * The vault — the only place in this repository that holds a secret key.
 *
 * THE GUARANTEE, and the reason this file is small enough to read in one sitting:
 * the key exists in a module-private closure and nowhere else. It is never
 * written to localStorage, sessionStorage, IndexedDB, a cookie, the DOM, or any
 * network request. `test/no-persistence.test.mjs` asserts that by scanning the
 * built bundle rather than by a reviewer promising it.
 *
 * `spec/signer-broker.md` says the honest question is not *whether* the key is in
 * memory — signing requires it — but *for how long*. Here: from unlock until
 * `lock()`, page unload, or the idle timeout, whichever comes first.
 */

import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { encrypt as nip49Encrypt, decrypt as nip49Decrypt } from 'nostr-tools/nip49';
import type { EventTemplate, SignedEvent } from './protocol.js';

/** NIP-49 parameters. log_n=16 is ~1s on a laptop — deliberate, and the cost is the point. */
export const SCRYPT_LOG_N = 16;
/**
 * Key-security byte 0x00: "the key has been known to have been handled insecurely
 * at some point". True by construction — it was generated in a browser tab. We
 * state it rather than claiming 0x02 we cannot substantiate.
 */
export const KEY_SECURITY_BYTE = 0x00;

/** Idle lock. A key held forever is a key held after the user walked away. */
export const IDLE_LOCK_MS = 15 * 60 * 1000;

let secret: Uint8Array | null = null;
let pubkeyHex: string | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let onLockCb: (() => void) | null = null;

function touch(): void {
  if (idleTimer) clearTimeout(idleTimer);
  if (secret) idleTimer = setTimeout(() => lock(), IDLE_LOCK_MS);
}

/** Overwrite before dropping the reference. GC timing is not a security control. */
function zero(buf: Uint8Array | null): void {
  if (buf) buf.fill(0);
}

export function isUnlocked(): boolean { return secret !== null; }

export function pubkey(): string {
  if (!pubkeyHex) throw new Error('no_session');
  return pubkeyHex;
}

export function npub(): string { return npubEncode(pubkey()); }

export function onLock(cb: () => void): void { onLockCb = cb; }

export function lock(): void {
  zero(secret);
  secret = null;
  pubkeyHex = null;
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  onLockCb?.();
}

/** Generate a fresh identity. Returns the encrypted file; the plaintext key stays here. */
export function createIdentity(passphrase: string): { ncryptsec: string; npub: string; pubkeyHex: string } {
  const sk = generateSecretKey();
  const file = nip49Encrypt(sk, passphrase, SCRYPT_LOG_N, KEY_SECURITY_BYTE);
  zero(secret);
  secret = sk;
  const pk = getPublicKey(sk);
  pubkeyHex = pk;
  touch();
  return { ncryptsec: file, npub: npubEncode(pk), pubkeyHex: pk };
}

/** Unlock an existing NIP-49 file. Throws `bad_passphrase` on failure — never a partial state. */
export function unlock(ncryptsec: string, passphrase: string): { npub: string; pubkeyHex: string } {
  let sk: Uint8Array;
  try {
    sk = nip49Decrypt(ncryptsec.trim(), passphrase);
  } catch {
    throw new Error('bad_passphrase');
  }
  zero(secret);
  secret = sk;
  const pk = getPublicKey(sk);
  pubkeyHex = pk;
  touch();
  return { npub: npubEncode(pk), pubkeyHex: pk };
}

/** Re-encrypt the live key under a new passphrase, without ever exposing it. */
export function reexport(passphrase: string): string {
  if (!secret) throw new Error('no_session');
  touch();
  return nip49Encrypt(secret, passphrase, SCRYPT_LOG_N, KEY_SECURITY_BYTE);
}

/**
 * Sign. The only function that uses the key, and it returns an event — never
 * anything from which the key could be recovered.
 */
export function signEvent(template: EventTemplate): SignedEvent {
  if (!secret) throw new Error('no_session');
  touch();
  return finalizeEvent(
    {
      kind: template.kind,
      created_at: template.created_at || Math.floor(Date.now() / 1000),
      tags: template.tags ?? [],
      content: template.content ?? '',
    },
    secret,
  ) as SignedEvent;
}
