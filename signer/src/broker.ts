/**
 * The broker — the postMessage side of `signer/1`.
 *
 * Two rules this file exists to hold:
 *   1. `postMessage` is always sent with an explicit `targetOrigin`. Never `*`.
 *   2. The requesting origin comes from `MessageEvent.origin`, which the browser
 *      sets and a page cannot forge. It is never read from the message body,
 *      because the message body is the attacker's to write.
 */

import { PROTOCOL, SUPPORTED, isRequest, ok, err, explains } from './protocol.js';
import type { Request, Response, EventTemplate, SignedEvent } from './protocol.js';
import * as vault from './vault.js';
import * as grants from './grants.js';
import { identify } from './clients.js';

export interface ApprovalRequest {
  origin: string;
  clientName: string;
  registered: boolean;
  method: string;
  human: string | null;
  /** Always shown, always raw, even when `human` is present and plausible. */
  raw: unknown;
  kind?: number;
}

export interface ApprovalDecision {
  approved: boolean;
  /** Milliseconds of session grant the user chose. 0 = this request only. */
  grantMs?: number;
}

export type Approver = (req: ApprovalRequest) => Promise<ApprovalDecision>;

let opener: { win: Window; origin: string } | null = null;

function reply(res: Response): void {
  if (!opener) return;
  // Explicit targetOrigin. The one line that makes the popup safe to talk to.
  opener.win.postMessage(res, opener.origin);
}

/**
 * Start listening. `approve` renders the UI and resolves with the user's answer.
 */
export function listen(approve: Approver): void {
  window.addEventListener('message', async (ev: MessageEvent) => {
    const origin = ev.origin;                      // browser-set; unforgeable
    if (!origin || origin === 'null') return;
    if (!isRequest(ev.data)) return;

    const req = ev.data as Request;
    const src = ev.source as Window | null;
    if (!src) return;
    opener = { win: src, origin };

    try {
      reply(await handle(req, origin, approve));
    } catch (e) {
      reply(err(req.id, 'malformed', e instanceof Error ? e.message : String(e)));
    }
  });
}

async function handle(req: Request, origin: string, approve: Approver): Promise<Response> {
  if (!SUPPORTED.has(req.method)) return err(req.id, 'unsupported_method', req.method);

  if (req.method === 'ping') return ok(req.id, 'pong');

  if (!vault.isUnlocked()) return err(req.id, 'no_session', 'the signer is locked');

  const kind =
    req.method === 'sign_event'
      ? (req.params?.event as EventTemplate | undefined)?.kind
      : undefined;

  // A live grant short-circuits the prompt. Nothing else does.
  if (!grants.covers(origin, req.method, kind)) {
    const client = identify(origin);
    const human = explains(req.human) ? (req.human as string) : null;
    const decision = await approve({
      origin,
      clientName: client.name,
      registered: client.registered,
      method: req.method,
      human,
      raw: req.params ?? {},
      kind,
    });
    if (!decision.approved) return err(req.id, 'declined');
    if (decision.grantMs && decision.grantMs > 0) {
      grants.grant(origin, [req.method], typeof kind === 'number' ? [kind] : [], decision.grantMs);
    }
  }
  grants.record(origin);

  switch (req.method) {
    case 'connect':
      return ok(req.id, { pubkey: vault.pubkey(), npub: vault.npub() });
    case 'get_public_key':
      return ok(req.id, vault.pubkey());
    case 'get_relays':
      // We do not invent relays on the user's behalf. Absence is an honest answer.
      return ok(req.id, {});
    case 'sign_event': {
      const tpl = req.params?.event as EventTemplate | undefined;
      if (!tpl || typeof tpl.kind !== 'number') return err(req.id, 'malformed', 'params.event required');
      const signed: SignedEvent = vault.signEvent(tpl);
      return ok(req.id, signed);
    }
    case 'nip44_encrypt':
    case 'nip44_decrypt':
      // Deliberately unimplemented rather than silently wrong. A stub that
      // returned plaintext would be worse than an honest refusal.
      return err(req.id, 'unsupported_method', `${req.method} is not implemented in this build`);
    default:
      return err(req.id, 'unsupported_method', req.method);
  }
}

export { PROTOCOL };
