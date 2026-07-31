/**
 * The `window.berm` surface (Berm v2 §5.4).
 *
 * DESIGN CONSTRAINT, and the reason this file exists before the signer does:
 * the production signer speaks NIP-46, which means every call round-trips
 * through relays. So every method here is
 *
 *   - async               (it may take a second)
 *   - approvable          (the user may be shown a prompt and may decline)
 *   - failable            (the signer may be offline, or the user may walk away)
 *
 * An app written against a fast local key would need rewriting the day the
 * remote signer arrives. Written against this shape, it does not. Nothing above
 * this line may assume signing is instant or guaranteed.
 *
 * No method accepts or returns a private key. That is not an oversight.
 */

export interface EventTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

export interface SignedEvent extends EventTemplate {
  id: string;
  pubkey: string;
  sig: string;
}

/**
 * Where the key lives.
 *
 *   0  NIP-07 browser extension    — the user already had one; we touch nothing
 *   1  Berm signer                 — passkey PRF at the signer origin
 *   2  NIP-46 bunker               — a remote signer the user already runs
 *
 * The number is not a quality ranking. It is a custody statement, and apps
 * should show it to the user rather than hide it.
 */
export type Tier = 0 | 1 | 2;

export interface Session {
  tier: Tier;
  pubkeyHex: string;
  npub: string;
  displayName: string;
  picture?: string;
  binding: BindingInfo;
  /** Human-readable custody line, for apps that want to show one. */
  custody: string;
}

export interface BindingInfo {
  /**
   * Never conflate these three — rendering `claimed` as `verified` is an
   * impersonation vector, not a cosmetic bug.
   *
   *   verified   a live check confirmed the proof post exists and matches
   *   claimed    the user asserted the handle; nothing has been checked
   *   unlinked   no claim at all
   */
  state: 'verified' | 'claimed' | 'unlinked';
  handle?: string;
}

export interface PublishReceipt {
  eventId: string;
  /** Relays that returned OK=true. */
  accepted: string[];
  /** Relays that rejected or were unreachable, with the reason. */
  failed: { relay: string; reason: string }[];
  /**
   * True only at ≥2 acceptances (Berm v2 §4.4).
   *
   * One relay is not published. It is a single point of failure wearing the
   * costume of a success message, and an app that treats it as success will
   * lose user data on the day that operator turns their machine off.
   */
  success: boolean;
}

export interface ConnectOptions {
  /** Try this tier first. Falls back through the others if unavailable. */
  preferred?: Tier;
  /** Restrict detection to these tiers. */
  allow?: Tier[];
  /** Shown by signers that display a requesting-app name. */
  appName?: string;
}

export interface XnsbSdk {
  readonly version: string;
  /** Which backend answered. Useful in bug reports. */
  readonly backend: string;

  connect(opts?: ConnectOptions): Promise<Session>;
  session(): Session | null;
  disconnect(): Promise<void>;

  getPublicKey(): Promise<string>;
  getNpub(): Promise<string>;

  /** May prompt the user. May reject with UserDeclinedError. */
  signEvent(template: EventTemplate): Promise<SignedEvent>;

  /** NIP-44 v2 only. NIP-04 is deprecated and is not exposed. */
  encrypt(peerPubkey: string, plaintext: string): Promise<string>;
  decrypt(peerPubkey: string, ciphertext: string): Promise<string>;

  publish(event: SignedEvent, relays?: string[]): Promise<PublishReceipt>;
  query(filters: unknown[], relays?: string[]): Promise<SignedEvent[]>;

  /** Relays currently in use, in the order they will be tried. */
  relays(): string[];
}

declare global {
  interface Window { berm?: XnsbSdk }
}

export * from './errors.js';
