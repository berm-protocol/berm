/**
 * Which packages does a package's *source* reach into?
 *
 *   node scripts/package-graph.mjs           print the graph
 *   node scripts/package-graph.mjs post      print one package's closure
 *
 * WHY THIS EXISTS. Several packages import a sibling by relative path —
 * `post/src/sdk/types.ts` does `export * from '../../../sdk/src/types.js'`.
 * TypeScript and esbuild then compile the sibling's file, and resolve *its* bare
 * imports (`nostr-tools`, `@noble/hashes`) from the sibling's own directory. So
 * `post` cannot be typechecked unless `sdk/node_modules` exists.
 *
 * On a developer machine every sibling is installed, so this is invisible. On a
 * clean checkout it is fatal, and it was: the first CI run failed three groups
 * with `Cannot find module 'nostr-tools'` and `Could not resolve "nostr-tools"`.
 * A forker would have hit the same wall on their first command.
 *
 * The graph is computed from the source rather than declared, so it cannot go
 * stale. `verify-all.mjs` declares what each group needs; `check-package-graph.mjs`
 * asserts the declarations still cover what this computes.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const SKIP = new Set(['node_modules', 'dist', 'out', '.git', 'coverage', 'vendor']);
const CODE = /\.(ts|tsx|mjs|js)$/;

/** A package is a top-level directory with a package.json. */
export function packages() {
  return readdirSync(ROOT)
    .filter((d) => {
      const p = join(ROOT, d);
      return !SKIP.has(d) && !d.startsWith('.') && statSync(p).isDirectory()
        && existsSync(join(p, 'package.json'));
    })
    .sort();
}

function* files(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (CODE.test(e.name)) yield p;
  }
}

/**
 * Direct edges only.
 *
 * The `../` count must match the file's depth below its package root *plus one*,
 * which is what makes the import land on a sibling rather than on a folder inside
 * the same package. An earlier version of this counted only `../../` and missed
 * `post/src/sdk/types.ts` — three levels up — which was the single most important
 * edge in the graph. Depth is computed, not assumed.
 */
export function edges() {
  const pkgs = new Set(packages());
  const out = new Map([...pkgs].map((p) => [p, new Set()]));
  const RE = /from\s+['"]((?:\.\.\/)+)([a-z][a-z0-9-]*)\//g;

  for (const p of pkgs) {
    for (const f of files(join(ROOT, p))) {
      const rel = relative(join(ROOT, p), dirname(f));
      const depth = rel === '' ? 0 : rel.split(sep).length;
      const body = readFileSync(f, 'utf8');
      for (const m of body.matchAll(RE)) {
        const ups = m[1].length / 3;
        if (ups === depth + 1 && pkgs.has(m[2]) && m[2] !== p) out.get(p).add(m[2]);
      }
    }
  }
  return out;
}

/** Transitive: installing `post` needs `sdk` because it needs `editor` which needs `sdk`. */
export function closure(pkg, g = edges()) {
  const seen = new Set();
  const stack = [...(g.get(pkg) ?? [])];
  while (stack.length) {
    const d = stack.pop();
    if (seen.has(d)) continue;
    seen.add(d);
    stack.push(...(g.get(d) ?? []));
  }
  return [...seen].sort();
}

/* CLI ---------------------------------------------------------------------- */

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const g = edges();
  const one = process.argv[2];
  if (one) {
    console.log(JSON.stringify(closure(one, g)));
  } else {
    for (const p of packages()) {
      const c = closure(p, g);
      if (c.length) console.log(`${p.padEnd(12)} needs ${c.join(', ')}`);
    }
  }
}
