/**
 * SDK conformance.
 *
 * The tests that matter most here are the negative ones. Any SDK demo works on
 * the happy path; what an app actually depends on is that the dev signer cannot
 * reach production, that a forged event from a hostile relay is dropped, and
 * that one relay accepting is not reported as published.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils.js';

import { useWebSocketImplementation, publishEvent, queryRelays } from '../src/relay.js';
import { createDevSigner, describeForApproval, isLocalOrigin } from '../src/backends/dev.js';
import { createNip07Signer, hasNip07 } from '../src/backends/nip07.js';
import { detect, setup } from '../src/connect.js';
import { profileFromEvent, parseXClaim } from '../src/profile.js';
import { DevSignerMisuseError, NoSignerError, UserDeclinedError } from '../src/errors.js';
import type { EventTemplate, SignedEvent } from '../src/types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
useWebSocketImplementation(WebSocket as any);

import { ready, startRelay } from './relay-harness.mjs';

const A = startRelay(7801);
const B = startRelay(7802);
const REFUSING = startRelay(7803, { reject: true });

/** A structurally valid event whose signature belongs to nobody. */
const FORGED: SignedEvent = {
  id: 'f'.repeat(64),
  pubkey: 'a'.repeat(64),
  created_at: 1700000000,
  kind: 1,
  tags: [],
  content: 'I am not who I say I am',
  sig: '0'.repeat(128),
};
const EVIL = startRelay(7804, { evil: FORGED });

beforeAll(async () => {
  await Promise.all([ready(A), ready(B), ready(REFUSING), ready(EVIL)]);
});
afterAll(async () => {
  await Promise.all([A.close(), B.close(), REFUSING.close(), EVIL.close()]);
});

function devSigner(approve?: (s: string) => Promise<boolean>) {
  return createDevSigner({
    relays: [A.url, B.url],
    latencyMs: 1,
    // profile lookup stays off; these tests assert signer behaviour, not relays
    approve,
  });
}

/* ------------------------------------------------------------------ */

describe('the dev signer origin guard', () => {
  it('permits Node, where there is no location', () => {
    expect(isLocalOrigin()).toBe(true);
  });

  it('permits localhost and file://', () => {
    for (const loc of [
      { protocol: 'http:', hostname: 'localhost', origin: 'http://localhost:8106' },
      { protocol: 'http:', hostname: '127.0.0.1', origin: 'http://127.0.0.1:8106' },
      { protocol: 'file:', hostname: '', origin: 'null' },
      { protocol: 'http:', hostname: 'app.localhost', origin: 'http://app.localhost' },
    ]) {
      (globalThis as Record<string, unknown>).location = loc;
      expect(isLocalOrigin(), loc.origin).toBe(true);
    }
    delete (globalThis as Record<string, unknown>).location;
  });

  it('REFUSES a public origin — thrown, not warned', () => {
    (globalThis as Record<string, unknown>).location = {
      protocol: 'https:', hostname: 'xonly.ai', origin: 'https://xonly.ai',
    };
    expect(() => createDevSigner()).toThrow(DevSignerMisuseError);
    // The message must name the origin, or the developer cannot tell which
    // deploy tripped it.
    expect(() => createDevSigner()).toThrow(/xonly\.ai/);
    delete (globalThis as Record<string, unknown>).location;
  });

  it('is not fooled by a lookalike hostname', () => {
    (globalThis as Record<string, unknown>).location = {
      protocol: 'https:', hostname: 'localhost.evil.com', origin: 'https://localhost.evil.com',
    };
    expect(isLocalOrigin()).toBe(false);
    delete (globalThis as Record<string, unknown>).location;
  });
});

describe('tier detection', () => {
  it('reports nothing available in a bare environment', () => {
    const d = detect();
    expect(d.every((x) => !x.available)).toBe(true);
    expect(d.find((x) => x.tier === 0)?.reason).toMatch(/no NIP-07/);
  });

  it('throws NoSignerError, listing what it tried', () => {
    try {
      setup();
      expect.unreachable('setup should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(NoSignerError);
      expect((e as NoSignerError).tried).toEqual(['nip07', 'berm-signer', 'nip46']);
    }
  });

  it('reports the passkey tier available once a signer origin is configured', () => {
    const d = detect({ signer: { signerOrigin: 'https://signer.xonly.ai' } });
    expect(d.find((x) => x.tier === 1)?.available).toBe(true);
  });

  it('prefers an existing NIP-07 extension over our own signer', async () => {
    const sk = generateSecretKey();
    (globalThis as Record<string, unknown>).nostr = {
      getPublicKey: async () => getPublicKey(sk),
      signEvent: async (t: EventTemplate) => finalizeEvent(t, sk),
    };
    expect(hasNip07()).toBe(true);

    const sdk = setup({ signer: { signerOrigin: 'https://signer.xonly.ai' }, relays: [A.url] });
    expect(sdk.backend).toBe('nip07');

    delete (globalThis as Record<string, unknown>).nostr;
  });
});

describe('NIP-07 backend', () => {
  const sk = generateSecretKey();

  beforeAll(() => {
    (globalThis as Record<string, unknown>).nostr = {
      getPublicKey: async () => getPublicKey(sk),
      signEvent: async (t: EventTemplate) => finalizeEvent(t, sk),
      getRelays: async () => ({ [A.url]: { read: true, write: true }, 'wss://readonly': { read: true, write: false } }),
    };
  });
  afterAll(() => { delete (globalThis as Record<string, unknown>).nostr; });

  it('adopts the user’s own write relays over our defaults', async () => {
    const sdk = createNip07Signer();
    const s = await sdk.connect();
    expect(sdk.relays()).toEqual([A.url]);
    expect(s.tier).toBe(0);
    expect(s.npub).toBe(nip19.npubEncode(getPublicKey(sk)));
  });

  it('refuses to encrypt rather than silently falling back to NIP-04', async () => {
    const sdk = createNip07Signer([A.url]);
    await sdk.connect();
    await expect(sdk.encrypt('a'.repeat(64), 'hi')).rejects.toThrow(/NIP-44/);
  });

  it('normalises an extension’s decline into UserDeclinedError', async () => {
    const n = (globalThis as Record<string, unknown>).nostr as Record<string, unknown>;
    const original = n.signEvent;
    n.signEvent = async () => { throw new Error('User rejected the request.'); };

    const sdk = createNip07Signer([A.url]);
    await sdk.connect();
    await expect(sdk.signEvent({ kind: 1, created_at: 1, tags: [], content: 'x' }))
      .rejects.toBeInstanceOf(UserDeclinedError);

    n.signEvent = original;
  });
});

describe('signing', () => {
  it('rejects with UserDeclinedError when the user says no', async () => {
    const sdk = devSigner(async () => false);
    await sdk.connect();
    await expect(sdk.signEvent({ kind: 1, created_at: 1, tags: [], content: 'no' }))
      .rejects.toBeInstanceOf(UserDeclinedError);
  });

  it('round-trips NIP-44 v2', async () => {
    const sdk = devSigner(async () => true);
    await sdk.connect();
    const peer = getPublicKey(generateSecretKey());
    const ct = await sdk.encrypt(peer, 'sovereign');
    expect(ct).not.toContain('sovereign');
    // Symmetric conversation key: the dev signer can read back its own message.
    expect(await sdk.decrypt(peer, ct)).toBe('sovereign');
  });

  it('throws before connect rather than signing anonymously', async () => {
    const sdk = devSigner(async () => true);
    await expect(sdk.signEvent({ kind: 1, created_at: 1, tags: [], content: 'x' }))
      .rejects.toThrow(/not connected/);
  });
});

describe('publish quorum (v2 §4.4)', () => {
  async function signed(): Promise<{ sdk: ReturnType<typeof devSigner>; ev: SignedEvent }> {
    const sdk = devSigner(async () => true);
    await sdk.connect();
    const ev = await sdk.signEvent({
      kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'quorum',
    });
    return { sdk, ev };
  }

  it('two acceptances is a publish', async () => {
    const { ev } = await signed();
    const r = await publishEvent(ev, [A.url, B.url]);
    expect(r.accepted.sort()).toEqual([A.url, B.url].sort());
    expect(r.success).toBe(true);
  });

  it('ONE acceptance is not a publish', async () => {
    const { ev } = await signed();
    const r = await publishEvent(ev, [A.url]);
    expect(r.accepted).toEqual([A.url]);
    expect(r.success).toBe(false);
  });

  it('records a refusing relay with its reason instead of throwing', async () => {
    const { ev } = await signed();
    const r = await publishEvent(ev, [A.url, REFUSING.url]);
    expect(r.success).toBe(false);
    expect(r.failed[0]?.relay).toBe(REFUSING.url);
    expect(r.failed[0]?.reason).toMatch(/refusing writes/);
  });

  it('an unreachable relay is a failure, not a hang', async () => {
    const { ev } = await signed();
    const r = await publishEvent(ev, [A.url, 'ws://127.0.0.1:7899']);
    expect(r.accepted).toEqual([A.url]);
    expect(r.failed[0]?.reason).toMatch(/unreachable|closed/);
  }, 20_000);
});

describe('query verifies what relays return', () => {
  it('drops a forged event served by a hostile relay', async () => {
    const sdk = devSigner(async () => true);
    await sdk.connect();
    const ev = await sdk.signEvent({
      kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'honest',
    });
    await publishEvent(ev, [EVIL.url]);

    // Prove the relay really does serve the forgery, so the assertion below is
    // not vacuously true. A test that passes because nothing happened is worse
    // than no test.
    const raw = await new Promise<string[]>((resolve) => {
      const seen: string[] = [];
      const ws = new WebSocket(EVIL.url);
      ws.on('open', () => ws.send(JSON.stringify(['REQ', 'raw', { kinds: [1] }])));
      ws.on('message', (b) => {
        const d = JSON.parse(b.toString());
        if (d[0] === 'EVENT') seen.push(d[2].id);
        if (d[0] === 'EOSE') { ws.close(); resolve(seen); }
      });
    });
    expect(raw).toContain(FORGED.id);

    const got = await queryRelays([{ kinds: [1] }], [EVIL.url]);
    const ids = got.map((e) => e.id);
    expect(ids).toContain(ev.id);
    // The relay definitely sent it; the SDK definitely dropped it.
    expect(ids).not.toContain(FORGED.id);
  });

  it('deduplicates the same event across relays', async () => {
    const sdk = devSigner(async () => true);
    await sdk.connect();
    const ev = await sdk.signEvent({
      kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [['t', 'dedup']], content: 'once',
    });
    await publishEvent(ev, [A.url, B.url]);
    const got = await queryRelays([{ kinds: [1], '#t': ['dedup'] }], [A.url, B.url]);
    expect(got.filter((e) => e.id === ev.id)).toHaveLength(1);
  });
});

describe('binding is never optimistic', () => {
  it('parses an X claim from an i tag', () => {
    expect(parseXClaim([['i', 'twitter:dorin', 'proof']])).toBe('dorin');
    expect(parseXClaim([['i', 'x:dorin']])).toBe('dorin');
    expect(parseXClaim([['i', 'github:someone']])).toBeUndefined();
  });

  it('renders a self-asserted claim as claimed, never verified', () => {
    const sk = generateSecretKey();
    const ev = finalizeEvent({
      kind: 0,
      created_at: 1,
      tags: [['i', 'twitter:elonmusk', 'https://x.com/elonmusk/status/1']],
      content: JSON.stringify({ name: 'Definitely Elon' }),
    }, sk) as SignedEvent;

    const p = profileFromEvent(ev, nip19.npubEncode(getPublicKey(sk)));
    expect(p.binding.handle).toBe('elonmusk');
    // The whole point. A signed, valid, well-formed event still only claims.
    expect(p.binding.state).toBe('claimed');
  });

  it('survives a kind 0 with junk content', () => {
    const sk = generateSecretKey();
    const ev = finalizeEvent({ kind: 0, created_at: 1, tags: [], content: 'not json' }, sk) as SignedEvent;
    const p = profileFromEvent(ev, nip19.npubEncode(getPublicKey(sk)));
    expect(p.binding.state).toBe('unlinked');
    expect(p.displayName).toMatch(/^npub1/);
  });
});

describe('approval prompts name the consequence', () => {
  const cases: [EventTemplate, RegExp][] = [
    [{ kind: 30023, created_at: 0, tags: [['title', 'On Sovereignty']], content: '' }, /long-form article.*On Sovereignty/],
    [{ kind: 0, created_at: 0, tags: [['i', 'twitter:dorin']], content: '' }, /profile and claim @dorin/],
    [{ kind: 30078, created_at: 0, tags: [['d', 'berm:archive:v1']], content: '' }, /archive attestation/],
    [{
      kind: 30078, created_at: 0,
      tags: [['d', 'berm:recovery:v1'], ['guardian', 'npub1a'], ['guardian', 'npub1b'], ['guardian', 'npub1c'], ['threshold', '2']],
      content: '',
    }, /3 named publicly, 2 needed to vouch/],
    [{ kind: 10002, created_at: 0, tags: [], content: '' }, /relay list/],
  ];

  it.each(cases)('describes kind %#', (tpl, want) => {
    expect(describeForApproval(tpl)).toMatch(want);
  });

  it('never says only "sign this"', () => {
    for (const [tpl] of cases) {
      const s = describeForApproval(tpl);
      expect(s.length).toBeGreaterThan(12);
      expect(s).not.toMatch(/^sign this/i);
    }
  });

  it('falls back to naming the d tag for an unknown app kind', () => {
    expect(describeForApproval({ kind: 30078, created_at: 0, tags: [['d', 'someapp:v1']], content: '' }))
      .toBe('Save application data (someapp:v1)');
  });
});

describe('install()', () => {
  it('refuses to clobber an existing window.berm', async () => {
    const { install } = await import('../src/index.js');
    const existing = { backend: 'someone-elses' } as never;
    (globalThis as Record<string, unknown>).berm = existing;
    expect(install({ dev: true })).toBe(existing);
    delete (globalThis as Record<string, unknown>).berm;
  });

  it('installs the dev signer when asked', async () => {
    const { install } = await import('../src/index.js');
    const sdk = install({ dev: true, relays: [A.url, B.url] });
    expect(sdk.backend).toBe('dev');
    expect((globalThis as Record<string, unknown>).berm).toBe(sdk);
    delete (globalThis as Record<string, unknown>).berm;
  });
});

describe('no key material crosses the API', () => {
  it('exposes no method returning a secret', async () => {
    const sdk = devSigner(async () => true);
    await sdk.connect();
    const surface = Object.keys(sdk).join(' ');
    expect(surface).not.toMatch(/secret|private|nsec|seed|export/i);
  });

  it('never puts an nsec in a session object', async () => {
    const sdk = devSigner(async () => true);
    const s = await sdk.connect();
    expect(JSON.stringify(s)).not.toMatch(/nsec1/);
    expect(bytesToHex(new Uint8Array([0]))).toBe('00'); // hash util sanity
  });
});
