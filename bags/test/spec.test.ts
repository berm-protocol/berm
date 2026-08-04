/**
 * What we believe about Bags' surface, pinned to what their spec actually says.
 *
 * These assertions are transcriptions from
 * `docs.bags.fm/api-reference/openapi.json`, read on 2026-08-03. They cannot
 * detect Bags changing the API — nothing offline can — but they stop US from
 * drifting away from what we read, which is the failure that actually happened:
 * the client and the probe each carried their own copy of the path and both
 * were wrong.
 *
 * The lesson worth keeping is not "we had the wrong path". It is that the check
 * we had could not have caught it. `probe.mjs` called a nonexistent path, got a
 * clean 401, and we recorded that as confirmation — because authentication is
 * evaluated before routing, so 401 is what you get for ANY path with a bad key.
 * A test whose pass condition is satisfied by the failure case is not a test.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  API_BASE, AUTH_HEADER, FEE_SHARE_WALLET_PATH, PROVIDERS, CHAINS,
  TOTAL_BPS, MAX_CLAIMERS, feeShareWalletUrl, assertValidSplit,
  type FeeClaimer,
} from '../src/bags.js';

describe('transcribed from the OpenAPI spec', () => {
  it('base URL and auth header', () => {
    expect(API_BASE).toBe('https://public-api-v2.bags.fm/api/v1');
    expect(AUTH_HEADER).toBe('x-api-key');
  });

  it('the fee-share wallet path — WITHDRAWN, see below', () => {
    // This test used to assert '/agent/v2/fee-share-wallet' from the spec, AND
    // kept the real path as a negative "so a revert is loud". It was pinning the
    // bug in place: a correct fix had to delete an assertion to land. A test
    // written from the same source as the code checks transcription, not truth.
    expect(FEE_SHARE_WALLET_PATH).toBe('/token-launch/fee-share/wallet/v2');
  });

  it('all eleven providers, not the three we guessed', () => {
    expect([...PROVIDERS]).toEqual([
      'apple', 'google', 'email', 'solana', 'twitter', 'tiktok',
      'kick', 'instagram', 'onlyfans', 'github', 'moltbook',
    ]);
  });

  it('both chains, SOL first because it is the documented default', () => {
    expect([...CHAINS]).toEqual(['SOL', 'EVM']);
  });

  it('the split constraints the spec states', () => {
    expect(TOTAL_BPS).toBe(10_000);
    expect(MAX_CLAIMERS).toBe(100);
  });

  it('builds the documented query: provider, username, chain', () => {
    const u = new URL(feeShareWalletUrl('twitter', 'alice'));
    expect(u.origin + u.pathname).toBe('https://public-api-v2.bags.fm/api/v1/token-launch/fee-share/wallet/v2');
    expect(u.searchParams.get('provider')).toBe('twitter');
    expect(u.searchParams.get('username')).toBe('alice');
    expect(u.searchParams.get('chain')).toBe('SOL');
  });

  it('encodes a username rather than pasting it into the query', () => {
    const u = new URL(feeShareWalletUrl('twitter', 'a b&c=d'));
    expect(u.searchParams.get('username')).toBe('a b&c=d');
  });

  it('enforces the 100-claimer ceiling', () => {
    const many: FeeClaimer[] = Array.from({ length: 101 }, (_, i) => ({
      provider: 'twitter', username: `u${i}`, bps: 1,
    }));
    expect(() => assertValidSplit(9899, many)).toThrow(/at most 100/);
  });
});

describe('the probe and the client cannot disagree again', () => {
  const probe = readFileSync(new URL('../probe.mjs', import.meta.url), 'utf8');

  it('the probe imports the path instead of carrying its own copy', () => {
    expect(probe).toMatch(/from '\.\/src\/bags\.js'/);
    expect(probe).toMatch(/FEE_SHARE_WALLET_PATH/);
  });

  it('no hardcoded API path survives in the probe', () => {
    // Any '/…/…' string literal that looks like an endpoint is a second source.
    const literals = [...probe.matchAll(/'(\/[a-z0-9][a-z0-9/-]{6,})'/gi)].map((m) => m[1]);
    expect(literals).toEqual([]);
  });

  it('the probe is still GET-only — this must never quietly change', () => {
    expect(probe).toMatch(/method: 'GET'/);
    for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(probe).not.toContain(`method: '${verb}'`);
    }
    // Nothing that could build or send a transaction.
    expect(probe).not.toMatch(/Transaction|signTransaction|sendTransaction|Keypair/);
  });
});

describe('the README does not restate the refuted claim', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

  it('does not present a 401 as proof the path is right', () => {
    // It did. Authentication runs before routing, so a 401 on a wrong path is
    // exactly what you get, and we recorded it as a confirmation.
    const claimsPathFrom401 =
      /401[^.]*\bmeans?\b[^.]*path|a 404 or 400 would have meant the path/i.test(readme);
    expect(claimsPathFrom401).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Live-API findings, 2026-08-04. Probed with a real key, GETs only.
 * Each of these contradicts something this file previously asserted from
 * the published OpenAPI specification.
 * ------------------------------------------------------------------ */

describe('what the live API actually does', () => {
  it('uses the path the spec says is gone', () => {
    // The spec's /agent/v2/fee-share-wallet returns a routed 404. This one
    // returns 200 and a wallet. We "corrected" ourselves onto the broken one.
    expect(FEE_SHARE_WALLET_PATH).toBe('/token-launch/fee-share/wallet/v2');
  });

  it('refuses a mixed-case address on the solana provider', () => {
    // Live: this returns 200 with wallet = the LOWERCASED string, which is a
    // different key that still decodes to 32 valid bytes. Silent loss of funds.
    expect(() =>
      feeShareWalletUrl('solana', '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'),
    ).toThrow(/case-sensitive/);
  });

  it('allows an address that is already lowercase, since folding is then a no-op', () => {
    expect(() => feeShareWalletUrl('solana', 'so11111111111111111111111111111111111111112')).not.toThrow();
  });

  it('leaves social providers alone — case folding is correct for a handle', () => {
    // Live: @JACK and @jack both resolve to the same wallet.
    expect(() => feeShareWalletUrl('twitter', 'JACK')).not.toThrow();
  });
});
