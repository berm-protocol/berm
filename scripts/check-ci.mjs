/**
 * CI must run every group, and must not go back to hand-listing them.
 *
 *   node scripts/check-ci.mjs
 *
 * WHY. The workflow used to carry its own matrix. Four packages — post, landing,
 * chain, node-pages — shipped with full suites that CI never executed, in a file
 * whose header says a pipeline with its own command list goes green while the
 * repo is broken. It was right, about itself.
 *
 * The matrix is now derived from `verify-all.mjs --groups`. This asserts that it
 * still is, and that any group marked `bespoke` (needing a specially configured
 * runner, so it cannot be in the generic matrix) has a job that names it.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CI = join(ROOT, '.github/workflows/ci.yml');
const ci = readFileSync(CI, 'utf8');

let bad = 0;
const fail = (m) => { console.error(`FAIL  ${m}`); bad++; };

const groups = (kind) =>
  JSON.parse(execFileSync('node', ['scripts/verify-all.mjs', '--groups', kind], { cwd: ROOT, encoding: 'utf8' }));

const all = groups('all');
const matrixed = new Set([...groups('unit'), ...groups('browser')]);

/* 1 — the matrix is derived, not typed ------------------------------------ */

if (!/--groups unit/.test(ci) || !/--groups browser/.test(ci)) {
  fail('ci.yml no longer builds its matrix from `verify-all.mjs --groups` — it will drift again');
}
if (!/fromJSON\(needs\.discover\.outputs\.unit\)/.test(ci)) {
  fail('the unit matrix is not fromJSON(discover.outputs.unit)');
}
if (!/fromJSON\(needs\.discover\.outputs\.browser\)/.test(ci)) {
  fail('the browser matrix is not fromJSON(discover.outputs.browser)');
}

/* 2 — every group is either matrixed or has its own job ------------------- */

// A first draft of this looked for the group *name* anywhere in the file. It
// passed after the PHP job's run step was deleted, because the job id still
// carried the name. A check that green-lights a deleted step is worse than no
// check, so this requires the actual invocation.
const runs = [...ci.matchAll(/^\s*(?:- )?run:\s*(.+)$/gm)].map((m) => m[1]);

for (const g of all) {
  if (matrixed.has(g)) continue;
  const invoked = runs.some((r) => new RegExp(`verify-all\\.mjs\\s+${g}(\\s|$)`).test(r));
  if (!invoked) {
    fail(`group \`${g}\` is in neither matrix and no step runs \`verify-all.mjs ${g}\` — CI does not run it`);
  }
}

/* 3 — no workflow hardcodes a browser version ----------------------------- */

// pages.yml pinned playwright@1.49.0 while the packages had moved to 1.62.x.
// Playwright keys browser downloads to its own version, so the job installed a
// Chromium nothing looked for and all eight browser groups failed at once, in a
// job that had been green for weeks. The version must come from the lockfiles.
for (const file of ['.github/workflows/ci.yml', '.github/workflows/pages.yml', '.github/workflows/release.yml']) {
  const body = readFileSync(join(ROOT, file), 'utf8');

  const pinned = body.match(/playwright@[\d.]+/);
  if (pinned) {
    fail(`${file} hardcodes ${pinned[0]} — use scripts/install-chromium.mjs, which reads the version the packages resolve`);
  }
  if (/npx\s+(?:--yes\s+)?playwright\s+install/.test(body)) {
    fail(`${file} runs \`npx playwright install\` directly — that installs LATEST, which matches the packages only by luck`);
  }
}

/* ------------------------------------------------------------------------ */

console.log(
  bad
    ? `\n${bad} CI coverage problem(s)\n`
    : `CI covers all ${all.length} groups (${matrixed.size} via derived matrices), no hardcoded browser version\n`,
);
process.exit(bad ? 1 : 0);
