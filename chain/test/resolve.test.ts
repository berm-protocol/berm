/**
 * The anchor must never become a dependency.
 *
 * The tempting bug is to "fix" a DNS dependency by adding an RPC dependency and
 * calling it decentralised. These assertions exist so that a client with no chain
 * access still resolves an identity, and so that a chain record can never remove
 * a relay the signed event already named.
 */

import { describe, it, expect } from 'vitest';
import { resolve, mergeLocators, describe as label,
         type ChainRecord, type AnchorClaim, type Locator } from '../src/resolve.js';

const HINTS: Locator = {
  relays: ['wss://a.relay', 'wss://b.relay'],
  signerOrigin: 'https://signer.xonly.ai',
};

const POINTER = 'aa'.repeat(32);
const CONTROLLER = '0x1111111111111111111111111111111111111111';

const record = (over: Partial<ChainRecord> = {}): ChainRecord => ({
  controller: CONTROLLER, claimedAt: 1_780_000_000, updatedAt: 1_780_000_100,
  version: 3, revoked: false, pointer: POINTER, ...over,
});

const claim = (over: Partial<AnchorClaim> = {}): AnchorClaim => ({
  chainId: 8453, contract: '0xcafe', controller: CONTROLLER, pointer: POINTER, ...over,
});

const LOCATOR: Locator = {
  relays: ['wss://c.relay'],
  blossomServers: ['https://blossom.one'],
  nodes: ['https://mynode.example'],
};

describe('the chain is optional — this is the whole point', () => {
  it('resolves with NO chain access at all', () => {
    const r = resolve({ eventHints: HINTS, chainUnreachable: true });
    expect(r.state).toBe('unanchored');
    expect(r.locator.relays).toEqual(HINTS.relays);
    expect(r.usedFallback).toBe(true);
  });

  it('says an RPC outage is not an identity outage', () => {
    const r = resolve({ eventHints: HINTS, chainUnreachable: true });
    expect(r.message).toMatch(/how it worked before there was an anchor/);
  });

  it('treats having no anchor as normal, not as a warning', () => {
    const r = resolve({ eventHints: HINTS, record: null });
    expect(r.state).toBe('unanchored');
    expect(r.message).toMatch(/Nothing is wrong/);
    expect(label(r)).toBe('No anchor');
  });

  it('never sets anchored outside the anchored state', () => {
    const cases = [
      resolve({ eventHints: HINTS, chainUnreachable: true }),
      resolve({ eventHints: HINTS, record: null }),
      resolve({ eventHints: HINTS, record: record(), claim: null }),
      resolve({ eventHints: HINTS, record: record({ revoked: true }), claim: claim() }),
    ];
    for (const c of cases) expect(c.anchored).toBe(false);
  });

  it('always returns somewhere to look, in every state', () => {
    const cases = [
      resolve({ eventHints: HINTS, chainUnreachable: true }),
      resolve({ eventHints: HINTS, record: record({ revoked: true }), claim: claim() }),
      resolve({ eventHints: HINTS, record: record(), claim: claim({ controller: '0xdead' }) }),
    ];
    for (const c of cases) expect(c.locator.relays.length).toBeGreaterThan(0);
  });
});

describe('two-way binding — one side alone proves nothing', () => {
  it('anchors when the identity and the chain agree', () => {
    const r = resolve({
      eventHints: HINTS, record: record(), claim: claim(),
      locator: LOCATOR, locatorSha256: POINTER,
    });
    expect(r.state).toBe('anchored');
    expect(r.anchored).toBe(true);
  });

  it('a chain record with no matching claim is CONTESTED, not anchored', () => {
    // Anyone can write any pubkey into a public contract. Squatting must be
    // worth less than nothing, which is why this is not merely "unanchored".
    const r = resolve({ eventHints: HINTS, record: record(), claim: null });
    expect(r.state).toBe('contested');
    expect(r.message).toMatch(/proves nothing on its own/);
  });

  it('a claim with no chain record is contested too', () => {
    const r = resolve({ eventHints: HINTS, record: null, claim: claim() });
    expect(r.state).toBe('contested');
  });

  it('mismatched controllers are contested, and both are named', () => {
    const r = resolve({ eventHints: HINTS, record: record(), claim: claim({ controller: '0xbeef' }) });
    expect(r.state).toBe('contested');
    expect(r.message).toContain('0xbeef');
    expect(r.message).toContain(CONTROLLER);
  });

  it('mismatched pointers are contested but not accused of malice', () => {
    // Usually a pending update. A client cannot tell that from an attack, so it
    // must neither confirm nor cry wolf.
    const r = resolve({ eventHints: HINTS, record: record(), claim: claim({ pointer: 'bb'.repeat(32) }) });
    expect(r.state).toBe('contested');
    expect(r.message).toMatch(/often just a pending update/);
  });

  it('compares addresses case-insensitively — checksum case is not a mismatch', () => {
    const r = resolve({
      eventHints: HINTS,
      record: record({ controller: CONTROLLER.toUpperCase() }),
      claim: claim(),
    });
    expect(r.state).toBe('anchored');
  });
});

describe('revocation outranks everything', () => {
  it('is reported even when the binding checks out', () => {
    const r = resolve({ eventHints: HINTS, record: record({ revoked: true }), claim: claim() });
    expect(r.state).toBe('revoked');
    expect(r.message).toMatch(/Stop trusting/);
  });

  it('is reported even with NO claim — a technicality must not soften it', () => {
    const r = resolve({ eventHints: HINTS, record: record({ revoked: true }), claim: null });
    expect(r.state).toBe('revoked');
  });

  it('says it cannot be undone', () => {
    const r = resolve({ eventHints: HINTS, record: record({ revoked: true }), claim: claim() });
    expect(r.message).toMatch(/cannot be undone/);
  });
});

describe('a served locator is checked against its committed hash', () => {
  it('is contested when the served document does not match', () => {
    const r = resolve({
      eventHints: HINTS, record: record(), claim: claim(),
      locator: LOCATOR, locatorSha256: 'ff'.repeat(32),
    });
    expect(r.state).toBe('contested');
    expect(r.message).toMatch(/has altered it/);
    // And it still gives the reader somewhere to go.
    expect(r.locator.relays).toEqual(HINTS.relays);
  });

  it('stays anchored when the document is simply unavailable', () => {
    // Failing to fetch an extra is not evidence against a binding that checks out.
    const r = resolve({ eventHints: HINTS, record: record(), claim: claim(), locator: null });
    expect(r.state).toBe('anchored');
    expect(r.usedFallback).toBe(true);
    expect(r.message).toMatch(/could not be fetched/);
  });
});

describe('an anchor may ADD places to look, never remove them', () => {
  it('unions relays rather than replacing them', () => {
    const r = resolve({
      eventHints: HINTS, record: record(), claim: claim(),
      locator: LOCATOR, locatorSha256: POINTER,
    });
    expect(r.locator.relays).toEqual(['wss://a.relay', 'wss://b.relay', 'wss://c.relay']);
  });

  it('cannot drop a relay the signed event named', () => {
    // Otherwise whoever holds the controller key could steer readers away from
    // copies they dislike — censorship dressed as configuration.
    const hostile: Locator = { relays: [] };
    expect(mergeLocators(HINTS, hostile).relays).toEqual(HINTS.relays);
  });

  it('CANNOT change the signer origin — that is the T9 surface', () => {
    const hostile: Locator = { relays: [], signerOrigin: 'https://evil.example' };
    expect(mergeLocators(HINTS, hostile).signerOrigin).toBe('https://signer.xonly.ai');
  });

  it('carries blossom servers and nodes through', () => {
    const m = mergeLocators(HINTS, LOCATOR);
    expect(m.blossomServers).toEqual(['https://blossom.one']);
    expect(m.nodes).toEqual(['https://mynode.example']);
  });

  it('deduplicates', () => {
    const m = mergeLocators(HINTS, { relays: ['wss://a.relay'] });
    expect(m.relays).toEqual(HINTS.relays);
  });
});

describe('the label a user sees', () => {
  it('reads neutral for the ordinary case', () => {
    expect(label(resolve({ eventHints: HINTS, record: null }))).toBe('No anchor');
  });

  it('reads as a warning only when something is actually wrong', () => {
    expect(label(resolve({ eventHints: HINTS, record: record(), claim: null })))
      .toMatch(/do not rely on it/);
    expect(label(resolve({ eventHints: HINTS, record: record({ revoked: true }), claim: claim() })))
      .toMatch(/Revoked/);
  });
});
