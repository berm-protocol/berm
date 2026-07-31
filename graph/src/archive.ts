/**
 * X archive parsing. Runs entirely in the browser; nothing is uploaded.
 *
 * WHY THE ARCHIVE AND NOT THE API: reading a following list from X needs a paid
 * developer app plus the user's OAuth token — a revocable permission, and one
 * that stops working at precisely the moment it matters most (after a ban). The
 * archive needs none of that. It is the user's own data, handed to them by X, and
 * nobody can take it back.
 *
 * WHAT IS ACTUALLY IN following.js — and this is the part that surprises people:
 *
 *   window.YTD.following.part0 = [
 *     { "following": { "accountId": "1234567890",
 *                      "userLink": "https://twitter.com/intent/user?user_id=1234567890" } },
 *   ]
 *
 * Numeric account IDs and nothing else. No handles, no display names. So a
 * follow list cannot be matched against handle-based NIP-39 claims directly —
 * see claimants.ts for the bridge.
 */

/** Files this module will parse. Anything else is refused by name. */
export const ACCEPTED = ['following.js', 'account.js', 'tweets.js'] as const;

/**
 * Files that must never be read, matched loosely on purpose.
 *
 * A user dragging in their archive folder is not thinking about what is in it.
 * Direct messages are the private correspondence of people who never agreed to
 * anything here, and the only safe way to handle that file is to never open it.
 * Refusing by name, loudly, is better than parsing it and discarding the result:
 * a discard is a decision someone can later remove.
 */
const FORBIDDEN = /direct[-_]?message|\bdms?\b|inbox|conversation/i;

export class ForbiddenFileError extends Error {
  constructor(name: string) {
    super(
      `Refusing to read ${name}. This project never parses direct messages — ` +
      'they belong to people who are not party to this. Remove it and try again.',
    );
    this.name = 'ForbiddenFileError';
  }
}

/**
 * Gate every file on the way in, before anything looks at its contents.
 *
 * This exists because the check used to live inside the parsers — so a file we
 * did not recognise was routed to a "not used" branch and never checked at all.
 * A guard that only runs on the paths you thought of is not a guard.
 */
export function assertReadable(filename: string): void {
  if (FORBIDDEN.test(filename)) throw new ForbiddenFileError(filename);
}

export class ArchiveParseError extends Error {
  constructor(msg: string) { super(msg); this.name = 'ArchiveParseError'; }
}

/**
 * Extract the JSON payload from an X archive `.js` file.
 *
 * The files are a JS assignment, not JSON. We strip the assignment and
 * `JSON.parse` the remainder — never `eval`, never `new Function`. Executing a
 * file the user dragged in from a zip would hand arbitrary code the same origin
 * as the signer, which is the whole ballgame.
 */
export function extractPayload(text: string, filename: string): unknown {
  assertReadable(filename);   // belt and braces: also enforced at intake

  const eq = text.indexOf('=');
  const head = text.slice(0, eq === -1 ? 80 : eq);
  if (!/^\s*window\.YTD\./.test(head)) {
    throw new ArchiveParseError(
      `${filename} does not look like an X archive file (expected "window.YTD.…")`,
    );
  }
  const body = text.slice(eq + 1).trim();
  try {
    return JSON.parse(body);
  } catch {
    throw new ArchiveParseError(`${filename}: payload is not valid JSON`);
  }
}

/** X snowflake IDs are decimal digits. Anything else is not an account id. */
const UID = /^\d{1,20}$/;

export interface FollowingImport {
  uids: string[];
  /** Entries that were present but unusable, so the count shown adds up. */
  skipped: number;
}

export function parseFollowing(text: string, filename = 'following.js'): FollowingImport {
  const payload = extractPayload(text, filename);
  if (!Array.isArray(payload)) throw new ArchiveParseError(`${filename}: expected an array`);

  const uids = new Set<string>();
  let skipped = 0;
  for (const row of payload) {
    const id = (row as { following?: { accountId?: unknown } })?.following?.accountId;
    if (typeof id === 'string' && UID.test(id)) uids.add(id);
    else skipped++;
  }
  return { uids: [...uids], skipped };
}

export interface AccountInfo {
  uid: string;
  username: string;
}

/** `account.js` — the importer's own account. Used to confirm they are importing
 *  their own archive rather than someone else's. */
export function parseAccount(text: string, filename = 'account.js'): AccountInfo | null {
  const payload = extractPayload(text, filename);
  if (!Array.isArray(payload)) return null;
  const a = (payload[0] as { account?: { accountId?: unknown; username?: unknown } })?.account;
  if (typeof a?.accountId !== 'string' || !UID.test(a.accountId)) return null;
  return { uid: a.accountId, username: String(a.username ?? '') };
}

/**
 * Mentions inside the user's own tweets carry BOTH a screen name and a numeric
 * id — the only place in the archive where the two appear together.
 *
 * A useful supplement, never a primary source: it only covers accounts the user
 * has actually mentioned, and a renamed handle leaves a stale pair behind.
 */
export function parseMentionMap(text: string, filename = 'tweets.js'): Map<string, string> {
  const out = new Map<string, string>();
  let payload: unknown;
  try { payload = extractPayload(text, filename); } catch { return out; }
  if (!Array.isArray(payload)) return out;

  for (const row of payload) {
    const mentions = (row as { tweet?: { entities?: { user_mentions?: unknown[] } } })
      ?.tweet?.entities?.user_mentions;
    if (!Array.isArray(mentions)) continue;
    for (const m of mentions) {
      const { id_str: id, screen_name: name } = (m ?? {}) as Record<string, unknown>;
      if (typeof id === 'string' && UID.test(id) && typeof name === 'string' && name) {
        out.set(id, name);
      }
    }
  }
  return out;
}
