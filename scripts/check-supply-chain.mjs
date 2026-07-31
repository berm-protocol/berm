/**
 * Supply-chain invariants, checked mechanically.
 *
 * The project's security claims (Berm v2 §6, T7) are: no CDN, nothing loaded
 * from an origin we do not control, the broken v1 derivation never reaches a
 * shipped artifact, and NIP-04 appears nowhere — including in tests.
 *
 * Claims like that decay the moment they are only written down. Each one here
 * is a grep with a reason attached.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'out', 'coverage', '.next', 'vendor',
]);

/** Directories that are deliberately excluded from the shipped-artifact rules. */
const QUARANTINE = 'crypto/src/quarantine';

const problems = [];
const notes = [];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const SOURCE = new Set(['.ts', '.js', '.mjs', '.php', '.html', '.json', '.md']);
const files = [...walk(ROOT)].filter((f) => SOURCE.has(extname(f)));

/* ---- 1. no external origins in anything that ships to a browser ---- */
{
  const CDN = /https?:\/\/(cdn\.|unpkg\.com|cdnjs\.|jsdelivr\.|ajax\.googleapis|fonts\.googleapis|fonts\.gstatic)/i;
  const shipped = files.filter((f) => ['.html', '.ts', '.js', '.mjs'].includes(extname(f)));
  for (const f of shipped) {
    const rel = relative(ROOT, f);
    // Documentation may legitimately discuss CDNs; it does not load from them.
    if (rel.startsWith('docs/') || rel.startsWith('nips/')) continue;
    const src = readFileSync(f, 'utf8');
    const m = CDN.exec(src);
    if (m) problems.push(`${rel}: external origin "${m[0]}" — the project loads nothing it does not serve`);
  }
}

/* ---- 2. the v1 quarantine never leaves quarantine ---- */
{
  const importers = [];
  for (const f of files.filter((f) => ['.ts', '.js', '.mjs'].includes(extname(f)))) {
    const rel = relative(ROOT, f);
    if (rel.replace(/\\/g, '/').startsWith(QUARANTINE)) continue;
    const src = readFileSync(f, 'utf8');
    if (/from\s+['"][^'"]*quarantine\/v1-broken/.test(src) || /require\([^)]*quarantine\/v1-broken/.test(src)) {
      importers.push(rel);
    }
  }
  /**
   * Two importers are legitimate, and both exist to DEMONSTRATE the break:
   *
   *   crypto/test/negative.test.ts   computes a victim's key from public data
   *   demo/src/main.ts              does the same live, in the visitor's browser
   *
   * The invariant is not "nothing imports it" — it is that the broken
   * derivation is never reachable from a path that produces a real identity.
   * A third importer means someone wired it somewhere new, and that is worth
   * stopping for even when the intent is innocent.
   */
  const ALLOWED = ['crypto/test/negative.test.ts', 'demo/src/main.ts'];
  const norm = (p) => p.replace(/\\/g, '/');
  const allowed = importers.filter((f) => ALLOWED.includes(norm(f)));
  const rogue = importers.filter((f) => !ALLOWED.includes(norm(f)));

  if (rogue.length) {
    problems.push(`the v1 quarantine is imported outside the two demonstration files: ${rogue.join(', ')}`);
  }
  for (const a of ALLOWED) {
    if (!importers.map(norm).includes(a)) {
      problems.push(`${a} no longer imports the v1 quarantine — a proof that v1 is broken stopped running`);
    }
  }
  if (allowed.length) notes.push(`v1 quarantine imported only by ${allowed.map(norm).join(', ')}`);

  // The real seal: it must not be re-exported from the package surface.
  try {
    const index = readFileSync(join(ROOT, 'crypto', 'src', 'index.ts'), 'utf8');
    // Match a real import/export, not the comment that explains why there
    // isn't one. Grepping for the bare word flagged the documentation that
    // exists precisely to record this rule.
    if (/(?:from|import|require\s*\()\s*['"][^'"]*quarantine/.test(index)) {
      problems.push('crypto/src/index.ts imports the quarantine — it would become part of the public API');
    }
  } catch {
    problems.push('crypto/src/index.ts unreadable');
  }

  const tsconfig = join(ROOT, 'crypto', 'tsconfig.json');
  try {
    const cfg = readFileSync(tsconfig, 'utf8');
    if (!/["']src\/quarantine["']/.test(cfg)) {
      problems.push('crypto/tsconfig.json no longer excludes src/quarantine — it would compile into dist');
    }
  } catch {
    problems.push('crypto/tsconfig.json unreadable');
  }
}

/* ---- 3. NIP-04 appears nowhere, including tests ---- */
{
  for (const f of files.filter((f) => ['.ts', '.js', '.mjs', '.php'].includes(extname(f)))) {
    const rel = relative(ROOT, f);
    const src = readFileSync(f, 'utf8');
    // Match the API, not the words "NIP-04" in a comment explaining the ban.
    const m = /\bnip04\b|\bnip_04\b|nip04Encrypt|nip04Decrypt/i.exec(src);
    if (m && !/prohibited|deprecated|never|not exposed|MUST NOT/i.test(src.slice(Math.max(0, m.index - 200), m.index + 200))) {
      problems.push(`${rel}: references ${m[0]} — NIP-04 is prohibited repo-wide, NIP-44 v2 only`);
    }
  }
}

/* ---- 4. no private key material committed ---- */
{
  const KEY = /\bnsec1[02-9ac-hj-np-z]{20,}/;

  /**
   * One file may contain literal nsecs: the frozen vector baseline.
   *
   * Every input there is itself the SHA-256 of a fixed public string, so the
   * keys are reproducible by anyone (`npm run vectors:generate`) and belong to
   * nobody. The exception is narrow on purpose — it is granted to one path, and
   * only while that file still declares itself frozen, so it cannot quietly
   * become somewhere real keys get parked.
   */
  const VECTORS = 'crypto/vectors/test-vectors.json';
  const norm = (p) => p.replace(/\\/g, '/');

  for (const f of files) {
    const rel = norm(relative(ROOT, f));
    const src = readFileSync(f, 'utf8');
    if (!KEY.test(src)) continue;

    if (rel !== VECTORS) {
      // Test fixtures generate keys at runtime. A literal nsec anywhere else is
      // either a mistake or somebody's real key, and both are worth stopping for.
      problems.push(`${rel}: a literal nsec appears in the source tree`);
      continue;
    }

    let meta;
    try { meta = JSON.parse(src); } catch { meta = {}; }
    if (meta.frozen !== true) {
      problems.push(`${VECTORS} contains keys but no longer declares itself frozen`);
    } else {
      notes.push(`${VECTORS} holds derived keys — reproducible from public inputs, declared frozen`);
    }
  }
}

/* ---- 5. the frozen vectors are still declared frozen ---- */
{
  try {
    const readme = readFileSync(join(ROOT, 'crypto', 'README.md'), 'utf8');
    if (!/frozen/i.test(readme)) {
      problems.push('crypto/README.md no longer describes the vectors as frozen');
    }
  } catch { /* covered elsewhere */ }
}

/* ------------------------------------------------------------------ */

console.log(`supply chain: scanned ${files.length} files`);
for (const n of notes) console.log(`  · ${n}`);

if (problems.length) {
  console.error('\nFAILURES:');
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error('');
  process.exit(1);
}
console.log('  · no external origins, no NIP-04, no committed keys, quarantine sealed\n');
