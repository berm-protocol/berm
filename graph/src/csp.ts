/**
 * Content-Security-Policy for the import origin.
 *
 * The claim is "your X archive never leaves your device". Asserting that in a
 * privacy policy is worth nothing. Asserting it in a CSP moves enforcement to
 * the BROWSER: the request is refused before it is made, by code neither we nor
 * an attacker who compromises our server controls.
 *
 * Same class of guarantee as the WebAuthn RP-ID binding — not something we
 * promise, something the platform enforces — and anyone can read the header.
 *
 * `connect-src 'none'` is the load-bearing line. With it, the page CANNOT open a
 * fetch, XHR, WebSocket or beacon to anywhere, including back to us.
 */

export interface CspOptions {
  /** Relay origins the page is allowed to reach, if any. Empty = none. */
  relays?: string[];
  /**
   * Base64 SHA-256 digests of inline scripts, e.g. `sha256-nT2on…`.
   *
   * The page is a single self-contained file, so its script IS inline — and
   * `script-src 'self'` blocks inline scripts outright, which is how this was
   * caught. Hashing is the stricter answer, not the looser one: `'self'` allows
   * ANY script served from the origin, while a hash allows exactly one byte
   * sequence. A compromised server cannot swap the script without changing the
   * header too, and the header is published.
   */
  scriptHashes?: string[];
}

/**
 * The import page's policy. The default is genuinely `connect-src 'none'`.
 *
 * Importing needs no network at all: the archive comes from a file input and the
 * claimant index is bundled at build time. Any relay traffic (publishing the
 * resulting list) happens on a DIFFERENT page, so this one can be fully sealed.
 */
export function importCsp(opts: CspOptions = {}): string {
  const connect = opts.relays?.length ? opts.relays.join(' ') : "'none'";
  const script = opts.scriptHashes?.length
    ? opts.scriptHashes.map((h) => `'${h}'`).join(' ')
    : "'self'";
  return [
    "default-src 'none'",
    `script-src ${script}`,
    // 'unsafe-inline' is retained for STYLE only, and deliberately: the template
    // uses style attributes, and style injection is not the threat here —
    // exfiltration is, and connect-src closes that door regardless.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "form-action 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join('; ');
}

export interface CspAudit {
  ok: boolean;
  problems: string[];
  directives: Map<string, string[]>;
}

/**
 * Audit a policy string.
 *
 * Exported and tested because a CSP is exactly the kind of header that gets
 * widened during a debugging session at 2am and never narrowed again. A wildcard
 * anywhere in `connect-src` silently returns us to "trust us".
 */
export function auditCsp(policy: string): CspAudit {
  const directives = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) directives.set(name.toLowerCase(), values);
  }

  const problems: string[] = [];
  const connect = directives.get('connect-src');

  if (!connect) {
    problems.push('no connect-src — the page may reach any origin');
  } else {
    if (connect.includes('*')) problems.push("connect-src contains a bare wildcard '*'");
    for (const v of connect) {
      if (v.includes('*')) problems.push(`connect-src contains a wildcard: ${v}`);
      // http: and https: as bare schemes are wildcards wearing a disguise.
      if (v === 'http:' || v === 'https:' || v === 'ws:' || v === 'wss:') {
        problems.push(`connect-src contains the bare scheme "${v}", which allows every host`);
      }
    }
  }

  for (const required of ['default-src', 'object-src', 'base-uri', 'form-action']) {
    if (!directives.has(required)) problems.push(`missing ${required}`);
  }

  const script = directives.get('script-src') ?? [];
  if (script.includes("'unsafe-eval'")) {
    // The archive parser refuses to eval by design; allowing it here would
    // reopen the hole from the other end.
    problems.push("script-src allows 'unsafe-eval'");
  }
  if (script.includes("'unsafe-inline'")) {
    problems.push("script-src allows 'unsafe-inline' — hash the inline script instead");
  }

  return { ok: problems.length === 0, problems, directives };
}
