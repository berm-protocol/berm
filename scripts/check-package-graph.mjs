/**
 * Every cross-package source dependency is declared in verify-all's GROUPS.
 *
 *   node scripts/check-package-graph.mjs
 *
 * WHY. `post/src/sdk/types.ts` does `export * from '../../../sdk/src/types.js'`.
 * The compiler then resolves `sdk`'s own bare imports from `sdk/node_modules`,
 * so `post` cannot be typechecked on a machine where `sdk` was never installed.
 * That is invisible to a developer with everything installed and fatal on a clean
 * checkout — which is how the first CI run failed three groups at once.
 *
 * Declaring `needs` fixed it. This exists so the declaration cannot rot: the
 * graph is recomputed from the source every run, and a new relative import into
 * a sibling fails here rather than in a stranger's terminal.
 *
 * Extra declarations are allowed. `vectors` needs `crypto` because it shells out
 * to crypto's npm script, which no source scan can see, and a checker that
 * forbids what it cannot verify would just teach people to delete the truth.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closure, edges, packages } from './package-graph.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(ROOT, 'scripts/verify-all.mjs'), 'utf8');

let bad = 0;
const fail = (m) => { console.error(`FAIL  ${m}`); bad++; };

/* Read the declarations out of GROUPS ------------------------------------- */

// Parsed rather than imported: verify-all runs its whole suite on import, so
// requiring it here would recurse. The shape is fixed and asserted below.
const declared = new Map();   // group name -> { dir, needs }
const ROW = /\{\s*name:\s*'([a-z0-9-]+)',\s*dir:\s*'([^']+)'([^\n]*?),\s*why:/g;

for (const m of src.matchAll(ROW)) {
  const [, name, dir, rest] = m;
  const needs = [...(rest.match(/needs:\s*\[([^\]]*)\]/)?.[1] ?? '')
    .matchAll(/'([a-z0-9-]+)'/g)].map((n) => n[1]);
  declared.set(name, { dir, needs });
}

if (declared.size < 15) fail(`only parsed ${declared.size} groups out of verify-all.mjs — the shape changed, fix this script`);

/* Compare against what the source actually does --------------------------- */

const g = edges();
const known = new Set(packages());

// Each group's own step list, so we can tell whether it installs itself.
const STEPS = /\{\s*name:\s*'([a-z0-9-]+)',[\s\S]*?steps:\s*\[([\s\S]*?)\n\s*\]\}/g;
const steps = new Map([...src.matchAll(STEPS)].map((m) => [m[1], m[2]]));

for (const [name, { dir, needs }] of declared) {
  if (dir === '.' || !known.has(dir)) continue;    // repo-level group, no package of its own

  // 1 — every package whose sources this group compiles must be installed.
  const required = closure(dir, g);
  const missing = required.filter((r) => !needs.includes(r));
  if (missing.length) {
    fail(
      `group \`${name}\` compiles sources from ${missing.map((x) => `\`${x}\``).join(', ')} ` +
      `but does not declare ${missing.length > 1 ? 'them' : 'it'} in \`needs\` — ` +
      `this passes locally and fails on a clean checkout`,
    );
  }

  // 2 — and the group must install the package it RUNS IN. The browser groups
  // share a directory with a unit group and quietly inherited its node_modules;
  // that works in one process and never in CI, where they are separate runners.
  const installsItself = /npm['"\s,]+\[?['"]ci['"]/.test(steps.get(name) ?? '') || needs.includes(dir);
  if (!installsItself) {
    fail(
      `group \`${name}\` runs in \`${dir}\` but neither runs \`npm ci\` nor declares ` +
      `\`${dir}\` in \`needs\` — it is borrowing an install from another group`,
    );
  }
}

/* ------------------------------------------------------------------------- */

const total = [...declared.values()].reduce((n, d) => n + d.needs.length, 0);
console.log(
  bad
    ? `\n${bad} undeclared cross-package dependency/ies\n`
    : `package graph: ${declared.size} groups, ${total} declared prerequisites, none missing\n`,
);
process.exit(bad ? 1 : 0);
