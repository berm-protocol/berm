/**
 * The root README is a claim sheet. Check it like one.
 *
 *   node scripts/check-readme.mjs
 *
 * WHY. Two drifts already happened and neither was caught by any suite: the
 * table linked directories that had been renamed, and `post/README.md` advertised
 * 63 assertions after the file had grown to 68. Both are the same failure — a
 * number in prose that nothing recomputes — and this project's entire posture is
 * that a claim with no command behind it is decoration.
 *
 * This does NOT run the suites. It checks the two things that go stale silently:
 *
 *   1. every directory the root README links to exists
 *   2. every count the root README states for a package appears in that
 *      package's own README, which is where the number is maintained
 *
 * The counts themselves are proved by `verify-all.mjs` actually running them.
 * What this catches is the root file quietly disagreeing with the tree.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');

let bad = 0;
const fail = (m) => { console.error(`FAIL  ${m}`); bad++; };

/* 1 — linked directories exist ------------------------------------------- */

// `[`crypto/`](crypto)` — the link target, not the label. A label can say
// anything; the target is what 404s on GitHub.
const linked = [...readme.matchAll(/\]\(([a-z][a-z0-9-]*)\)/g)].map((m) => m[1]);
const dirs = [...new Set(linked)];

for (const d of dirs) {
  if (!existsSync(join(ROOT, d))) fail(`README links to \`${d}\` — no such directory`);
}
if (!dirs.length) fail('README links to no directories at all — the table lost its links');

/* 2 — stated counts agree with the package that owns them ----------------- */

// Rows look like:  | [`post/`](post) | … | 68 tests + 44 browser checks |
const ROW = /\|\s*\[`([a-z][a-z0-9-]*)\/?`\]\([a-z0-9-]+\)\s*\|[^|]*\|([^|]*)\|/g;

let rows = 0;
for (const m of readme.matchAll(ROW)) {
  const [, dir, claim] = m;
  rows++;

  const pkgReadme = join(ROOT, dir, 'README.md');
  const numbers = [...claim.matchAll(/\b(\d+)\b/g)].map((n) => n[1]);
  if (!numbers.length) continue;                       // "browser E2E", "—"

  if (!existsSync(pkgReadme)) {
    fail(`README states ${numbers.join('/')} for \`${dir}\` but ${dir}/README.md does not exist to back it`);
    continue;
  }

  const body = readFileSync(pkgReadme, 'utf8');
  for (const n of numbers) {
    // Word-bounded. An earlier version of a check in this repo matched "bot"
    // inside "border-bottom"; a bare `includes('44')` would match a port number.
    if (!new RegExp(`\\b${n}\\b`).test(body)) {
      fail(`README claims "${claim.trim()}" for \`${dir}\`, but ${dir}/README.md never mentions ${n}`);
    }
  }
}

if (rows < 8) fail(`only ${rows} package rows parsed — the table changed shape, fix this script`);

/* ------------------------------------------------------------------------ */

console.log(
  bad
    ? `\n${bad} README problem(s)\n`
    : `README: ${dirs.length} linked directories exist, ${rows} package rows agree with their packages\n`,
);
process.exit(bad ? 1 : 0);
