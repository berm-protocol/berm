/**
 * No committed file may hardcode a path that exists on one machine.
 *
 *   node scripts/check-no-machine-paths.mjs
 *
 * WHY. Ten verify scripts carried `executablePath: '/opt/pw-browsers/chromium'`.
 * That directory exists in the sandbox this repo was written in and nowhere
 * else. Every browser suite passed locally; every one failed on the first CI run
 * with `executable doesn't exist`, and a forker would have hit the identical
 * wall with no clue where the path came from.
 *
 * The general defect is a machine-specific absolute path in committed code. The
 * general fix is `scripts/chromium.mjs`, which probes rather than assumes. This
 * is the guard that stops the next one — including `/home/<someone>`, which the
 * pre-publication sweep did grep for and which this now checks on every run
 * rather than once, by hand, the day before shipping.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SKIP = new Set(['node_modules', 'dist', 'out', '.git', 'coverage', 'vendor', 'fixtures']);
const TEXT = /\.(ts|tsx|mjs|cjs|js|json|php|md|yml|yaml|html|css)$/;

/**
 * The two files allowed to contain these strings, because naming them is the
 * whole job: the launcher that probes for the path, and this file, which has to
 * write the patterns down in order to search for them.
 */
const OWNERS = new Set(['scripts/chromium.mjs', 'scripts/check-no-machine-paths.mjs']);

/**
 * Provisioning files are the one legitimate exception, and the exemption is
 * deliberately narrow.
 *
 * `infra/cloud-init.*.yaml` describes a machine that does not exist yet. Paths
 * in it are not leaked developer paths — they are the file's entire content, and
 * a cloud-init that could not name `/home/berm` would be useless.
 *
 * Scoped to that one home directory rather than waived wholesale, because an
 * exemption is how a guard rots: `/home/claude`, `/Users/...` and every other
 * pattern still fail in these files, which is what would actually indicate a
 * leak.
 */
const PROVISIONING = /^infra\/cloud-init\.[a-z0-9-]+\.yaml$/;
const PROVISIONING_ALLOWED = '/home/berm/';

const PATTERNS = [
  { re: /\/opt\/pw-browsers/g,          what: 'a sandbox browser pool path' },
  { re: /\/home\/(?!runner\b)[a-z][a-z0-9_-]*\//g, what: "someone's home directory" },
  { re: /\/Users\/[A-Za-z][A-Za-z0-9_-]*\//g,      what: "someone's macOS home directory" },
  { re: /\b[A-Z]:\\\\?Users\\\\?[A-Za-z]/g,        what: "someone's Windows home directory" },
  { re: /\/tmp\/[a-z0-9_-]+\/(?:src|dist|node_modules)\b/g, what: 'a scratch checkout path' },
];

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith('.git')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (TEXT.test(e.name) && statSync(p).size < 2_000_000) yield p;
  }
}

let bad = 0;
let scanned = 0;

for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).split('\\').join('/');
  if (OWNERS.has(rel) || rel.endsWith('package-lock.json')) continue;
  scanned++;
  const body = readFileSync(file, 'utf8');
  for (const { re, what } of PATTERNS) {
    for (const m of body.matchAll(re)) {
      if (PROVISIONING.test(rel) && m[0] === PROVISIONING_ALLOWED) continue;
      const line = body.slice(0, m.index).split('\n').length;
      console.error(`FAIL  ${rel}:${line}  ${what}: ${m[0]}`);
      bad++;
    }
  }
}

console.log(
  bad
    ? `\n${bad} machine-specific path(s) in committed files — these pass here and fail everywhere else\n`
    : `no machine-specific paths in ${scanned} files\n`,
);
process.exit(bad ? 1 : 0);
