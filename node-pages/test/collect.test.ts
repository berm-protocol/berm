/**
 * What a node must refuse.
 *
 * A node renders somebody's signed events as web pages. The failure that matters
 * is not "the build crashed" — it is a build that quietly publishes something it
 * did not verify, or quietly publishes *less* than it had. Both look like a
 * working site to every visitor.
 */

import { describe, it, expect } from 'vitest';
import {
  merge, shouldPublish, fetchFrom,
  type CollectedEvent, type WebSocketLike,
} from '../src/collect.js';

const PK = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

const ev = (over: Partial<CollectedEvent> = {}): CollectedEvent => ({
  id: 'c'.repeat(64), pubkey: PK, kind: 1, created_at: 1_780_000_000,
  tags: [], content: 'hello', sig: 'd'.repeat(128), seenOn: [], ...over,
});

const res = (url: string, events: unknown[], reachable = true) => ({ url, events, reachable });
const always = () => true;
const never = () => false;

describe('nothing reaches the site unverified', () => {
  it('drops events whose signature does not verify, and counts them per relay', () => {
    const r = merge([res('wss://evil', [ev()])], PK, never);
    expect(r.events).toHaveLength(0);
    expect(r.rejected['wss://evil']).toBe(1);
  });

  it('cannot be talked into publishing a forgery by repetition', () => {
    const many = Array.from({ length: 30 }, (_, i) => ev({ id: String(i).padStart(64, '0') }));
    expect(merge([res('wss://evil', many)], PK, never).events).toHaveLength(0);
  });

  it('drops events by another author — that is a different question, not an answer', () => {
    const r = merge([res('wss://a', [ev({ pubkey: OTHER })])], PK, always);
    expect(r.events).toHaveLength(0);
    expect(r.rejected['wss://a']).toBe(1);
  });

  it('rejects malformed objects before they reach signature verification', () => {
    const junk = [null, 42, 'x', {}, { id: 'short' }, { ...ev(), sig: 'nope' }, { ...ev(), tags: 'no' }];
    const r = merge([res('wss://a', junk)], PK, () => {
      throw new Error('verify must not be called on a malformed object');
    });
    expect(r.events).toHaveLength(0);
    expect(r.rejected['wss://a']).toBe(junk.length);
  });

  it('keeps a valid event and records every relay that served it', () => {
    const r = merge([res('wss://a', [ev()]), res('wss://b', [ev()])], PK, always);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]!.seenOn).toEqual(['wss://a', 'wss://b']);
  });

  it('deduplicates by id rather than trusting a relay to send each once', () => {
    const r = merge([res('wss://a', [ev(), ev(), ev()])], PK, always);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]!.seenOn).toEqual(['wss://a']);
  });

  it('separates unreachable from silent — they mean different things', () => {
    const r = merge([res('wss://down', [], false), res('wss://empty', [])], PK, always);
    expect(r.unreachable).toEqual(['wss://down']);
    expect(r.silent).toEqual(['wss://empty']);
  });
});

describe('deterministic output', () => {
  it('orders newest first, breaking ties on id so a rebuild is byte-identical', () => {
    const a = ev({ id: '1'.repeat(64), created_at: 100 });
    const b = ev({ id: '2'.repeat(64), created_at: 300 });
    const c = ev({ id: '0'.repeat(64), created_at: 100 });
    const order = merge([res('wss://a', [a, b, c])], PK, always).events.map((e) => e.id[0]);
    expect(order).toEqual(['2', '0', '1']);
  });

  it('produces the same result regardless of relay response order', () => {
    const a = ev({ id: '1'.repeat(64), created_at: 100 });
    const b = ev({ id: '2'.repeat(64), created_at: 200 });
    const one = merge([res('wss://a', [a]), res('wss://b', [b])], PK, always);
    const two = merge([res('wss://b', [b]), res('wss://a', [a])], PK, always);
    expect(one.events.map((e) => e.id)).toEqual(two.events.map((e) => e.id));
  });
});

describe('a build that would truncate the archive is refused', () => {
  const withN = (n: number) =>
    merge([res('wss://a', Array.from({ length: n }, (_, i) => ev({ id: String(i).padStart(64, '0') })))], PK, always);

  it('refuses to publish an empty site', () => {
    const v = shouldPublish(merge([res('wss://a', [], false)], PK, always), 0);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/refusing to publish an empty site/);
  });

  it('refuses when fewer events were fetched than the last build had', () => {
    // The scenario: two relays are down, the build succeeds, and a complete
    // archive is silently replaced by a partial one. A visitor cannot tell a
    // short site from a censored one.
    const v = shouldPublish(withN(3), 10);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/Relays may be down/);
    expect(v.reason).toMatch(/allow-shrink/);
  });

  it('publishes when the operator says the loss is intentional', () => {
    expect(shouldPublish(withN(3), 10, { allowShrink: true }).ok).toBe(true);
  });

  it('publishes when the count grew or held', () => {
    expect(shouldPublish(withN(10), 10).ok).toBe(true);
    expect(shouldPublish(withN(11), 10).ok).toBe(true);
  });

  it('publishes a first build with no previous state', () => {
    expect(shouldPublish(withN(1), 0).ok).toBe(true);
  });
});

describe('fetching, against a fake relay', () => {
  /** A relay that answers exactly once, then EOSEs. */
  const fake = (events: unknown[], behaviour: 'ok' | 'error' | 'silent' = 'ok') => (): WebSocketLike => {
    const ws: WebSocketLike = { send() {}, close() {}, onopen: null, onmessage: null, onerror: null, onclose: null };
    queueMicrotask(() => {
      ws.onopen?.();
      if (behaviour === 'error') return ws.onerror?.();
      if (behaviour === 'silent') return;
      for (const e of events) ws.onmessage?.({ data: JSON.stringify(['EVENT', 'collect', e]) });
      ws.onmessage?.({ data: JSON.stringify(['EOSE', 'collect']) });
    });
    return ws;
  };

  const opts = { pubkeyHex: PK, relays: ['wss://a'] };

  it('collects events and reports the relay reachable', async () => {
    const r = await fetchFrom('wss://a', { ...opts, open: fake([ev()]) });
    expect(r.events).toHaveLength(1);
    expect(r.reachable).toBe(true);
  });

  it('reports a relay that errors before opening as unreachable', async () => {
    const r = await fetchFrom('wss://a', {
      ...opts,
      open: () => { throw new Error('refused'); },
    });
    expect(r.reachable).toBe(false);
  });

  it('times out rather than hanging a build forever', async () => {
    const r = await fetchFrom('wss://a', { ...opts, open: fake([], 'silent'), timeoutMs: 30 });
    expect(r.events).toHaveLength(0);
    // It opened, so it is reachable-but-silent — a real distinction: silence
    // from a live relay is not the same as a relay that is gone.
    expect(r.reachable).toBe(true);
  });

  it('ignores malformed frames instead of throwing', async () => {
    const ws: WebSocketLike = { send() {}, close() {}, onopen: null, onmessage: null, onerror: null, onclose: null };
    const p = fetchFrom('wss://a', { ...opts, open: () => ws, timeoutMs: 200 });
    queueMicrotask(() => {
      ws.onopen?.();
      ws.onmessage?.({ data: 'not json' });
      ws.onmessage?.({ data: '{"not":"an array"}' });
      ws.onmessage?.({ data: JSON.stringify(['EOSE', 'collect']) });
    });
    await expect(p).resolves.toMatchObject({ events: [], reachable: true });
  });
});
