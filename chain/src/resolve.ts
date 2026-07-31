/**
 * Reading the anchor — and staying useful when it is unreachable.
 *
 * THE FAILURE THIS FILE EXISTS TO PREVENT. It is very easy to "fix" a DNS
 * dependency by introducing an RPC dependency, ship it, and call the result
 * decentralised. A client that cannot resolve an identity when its RPC endpoint
 * is down has not removed a single point of failure — it has moved one, to a
 * place the user understands less well.
 *
 * So the rule is absolute: **the chain is an optional corroborator, never a
 * required lookup.** Every function here degrades to a usable answer with no
 * chain access at all, and `unreachable` is never allowed to become `contested`
 * or to suppress the hints the signed event already carries.
 *
 * FOUR STATES, and the two middle ones carry the weight:
 *
 *   anchored     a record exists, is not revoked, and the identity confirms it
 *   unanchored   no record, or no chain access. NORMAL. Not a warning.
 *   contested    a record exists but the two sides do not agree → trust neither
 *   revoked      the controller said stop. The loudest thing this can say.
 *
 * WHY TWO-WAY BINDING. Anyone can write any pubkey into a public contract, so a
 * chain record alone proves nothing — exactly like a NIP-39 `i` tag, which is why
 * this repository has never rendered `claimed` as `verified`. The identity must
 * ALSO publish an event naming the chain, the contract and the controller. One
 * side without the other is `contested`, which is worth less than no claim at all
 * and is the reason squatting a pubkey here gains nobody anything.
 */

export type AnchorState = 'anchored' | 'unanchored' | 'contested' | 'revoked';

/** The on-chain record, as read by any RPC. */
export interface ChainRecord {
  controller: string;
  claimedAt: number;
  updatedAt: number;
  version: number;
  revoked: boolean;
  /** SHA-256 of the locator document. */
  pointer: string;
}

/**
 * The author's side of the binding: a signed, replaceable event (kind 30078)
 * naming where their anchor lives.
 */
export interface AnchorClaim {
  chainId: number;
  contract: string;
  controller: string;
  /** SHA-256 of the locator document this identity currently stands behind. */
  pointer: string;
}

/** What the anchor ultimately points at. Never stored on chain — only its hash. */
export interface Locator {
  relays: string[];
  blossomServers?: string[];
  nodes?: string[];
  signerOrigin?: string;
}

export interface ResolveInput {
  /** Hints carried by the signed Nostr event itself. Always available. */
  eventHints: Locator;
  /** The author's signed anchor claim, if they published one. */
  claim?: AnchorClaim | null;
  /** What the chain returned. `undefined` means the chain was not consulted or could not be reached. */
  record?: ChainRecord | null;
  /** The locator document fetched by pointer, if it was retrievable. */
  locator?: Locator | null;
  /** SHA-256 of the locator document as actually fetched. */
  locatorSha256?: string | null;
  /** Set when an RPC was attempted and failed. Distinguishes "down" from "not tried". */
  chainUnreachable?: boolean;
}

export interface Resolution {
  state: AnchorState;
  /** True ONLY for `anchored`. Never derive it from `state !== 'contested'`. */
  anchored: boolean;
  message: string;
  /** Where to actually look. Always populated, whatever the state. */
  locator: Locator;
  /** Set when the anchor contributed nothing and the event's own hints were used. */
  usedFallback: boolean;
}

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];

/**
 * Merge, never replace.
 *
 * An anchor adds places to look. It must not be able to REMOVE a relay the
 * signed event already named, because that would let whoever controls the chain
 * record steer readers away from copies they do not like — censorship dressed as
 * configuration. Union only.
 */
export function mergeLocators(base: Locator, extra?: Locator | null): Locator {
  return {
    relays: uniq([...base.relays, ...(extra?.relays ?? [])]),
    blossomServers: uniq([...(base.blossomServers ?? []), ...(extra?.blossomServers ?? [])]),
    nodes: uniq([...(base.nodes ?? []), ...(extra?.nodes ?? [])]),
    // The signer origin is the one field an anchor may not introduce or change.
    // It is the T9 surface: letting a chain record redirect the signer would hand
    // a takeover route to whoever holds the controller key. The event's own value
    // wins, always.
    signerOrigin: base.signerOrigin,
  };
}

const eq = (a?: string, b?: string) =>
  typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

export function resolve(input: ResolveInput): Resolution {
  const hints = input.eventHints;

  const fallback = (message: string, state: AnchorState = 'unanchored'): Resolution => ({
    state,
    anchored: false,
    message,
    locator: mergeLocators(hints, null),
    usedFallback: true,
  });

  // No chain access is a normal condition, not an error. This is the branch that
  // keeps an RPC outage from becoming an identity outage.
  if (input.chainUnreachable) {
    return fallback(
      'The anchor could not be read, so this identity is unconfirmed. Using the ' +
      'relays named in the signed event, which is how it worked before there was an anchor.',
    );
  }

  if (!input.record) {
    return fallback(
      input.claim
        ? 'This identity says it has an anchor, but no record exists at the contract it named.'
        : 'No anchor. Nothing is wrong — an identity does not need one.',
      input.claim ? 'contested' : 'unanchored',
    );
  }

  // Revocation outranks everything, including a missing claim. The controller
  // saying "stop" must never be softened by a binding technicality.
  if (input.record.revoked) {
    return {
      state: 'revoked',
      anchored: false,
      message:
        'The controller of this identity has published a revocation. Stop trusting ' +
        'anything signed by this key from now on. This cannot be undone by anyone.',
      locator: mergeLocators(hints, null),
      usedFallback: true,
    };
  }

  if (!input.claim) {
    return fallback(
      'A record exists for this key, but the identity has not published anything ' +
      'confirming it. Anyone can write any key into a public contract, so this ' +
      'proves nothing on its own.',
      'contested',
    );
  }

  if (!eq(input.claim.controller, input.record.controller)) {
    return fallback(
      `This identity names ${input.claim.controller} as its controller; the chain ` +
      `says ${input.record.controller}. Trust neither until they agree.`,
      'contested',
    );
  }

  if (!eq(input.claim.pointer, input.record.pointer)) {
    // Usually staleness rather than an attack — but a client cannot tell those
    // apart, so it must not present the result as confirmed.
    return fallback(
      'The identity and the chain point at different locator documents. This is ' +
      'often just a pending update; it is not a confirmation.',
      'contested',
    );
  }

  // The locator itself is optional. Failing to fetch it must not downgrade a
  // binding that already checks out — the anchor is confirmed either way, there
  // is simply nothing extra to add.
  if (input.locator && input.locatorSha256 && !eq(input.locatorSha256, input.record.pointer)) {
    return fallback(
      'The locator document served does not match the hash committed on chain. ' +
      'Whoever served it has altered it; falling back to the event’s own relays.',
      'contested',
    );
  }

  const usable = input.locator && eq(input.locatorSha256 ?? '', input.record.pointer)
    ? input.locator
    : null;

  return {
    state: 'anchored',
    anchored: true,
    message: usable
      ? 'Anchored. The identity and the chain agree, and the locator matches its committed hash.'
      : 'Anchored. The identity and the chain agree; the locator document could not be ' +
        'fetched, so only the relays named in the event are in use.',
    locator: mergeLocators(hints, usable),
    usedFallback: !usable,
  };
}

/**
 * One line for a UI.
 *
 * `unanchored` deliberately reads as neutral. Most identities will never have an
 * anchor, and a client that nags about its absence teaches people that the
 * ordinary case is broken.
 */
export function describe(r: Resolution): string {
  switch (r.state) {
    case 'anchored': return 'Anchored on chain';
    case 'unanchored': return 'No anchor';
    case 'contested': return 'Anchor disputed — do not rely on it';
    case 'revoked': return 'Revoked by its controller';
  }
}
