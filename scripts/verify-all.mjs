/**
 * Every check this project makes about itself, in one command.
 *
 * CI calls exactly this. That is the point: a pipeline that runs a different
 * set of commands than a developer does is a pipeline that goes green while the
 * repo is broken, and red for reasons nobody can reproduce locally.
 *
 *   node scripts/verify-all.mjs              everything
 *   node scripts/verify-all.mjs --fast       skip the browser suites
 *   node scripts/verify-all.mjs crypto sdk   named groups only
 *
 * Exit code is the number of failed groups, so a shell can branch on it.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * `browser: true` marks a group that needs Chromium. Those are the slow ones
 * and the ones that fail on a machine without it, so they are skippable —
 * explicitly and loudly, never silently.
 *
 * `needs: [...]` names OTHER packages that must be installed first. Several
 * packages import a sibling by relative path, so the compiler ends up resolving
 * the sibling's bare imports from the sibling's own node_modules. On a developer
 * machine everything is installed and this is invisible; on a clean checkout it
 * is fatal, and it was — the first CI run failed three groups this way.
 *
 * `scripts/check-package-graph.mjs` recomputes these from the source and fails
 * if a declaration stops covering reality, so this list cannot quietly rot.
 */
const GROUPS = [
  { name: 'crypto', dir: 'crypto', why: 'identity derivation, vectors, the v1 quarantine', steps: [
    ['npm', ['ci', '--no-audit', '--no-fund']],
    ['npm', ['run', 'typecheck']],
    ['npm', ['test']],
  ]},
  // Not a source import — this group shells out to crypto's own npm script, so
  // it needs crypto's dev dependencies (tsx) present. Same failure either way.
  { name: 'vectors', dir: '.', needs: ['crypto'], why: 'the frozen vectors still regenerate byte-identically', steps: [
    // Hash-compared rather than git-diffed: works outside a checkout, and it
    // states the actual claim — these exact bytes come back.
    ['node', ['scripts/check-vectors-frozen.mjs']],
  ]},
  { name: 'sdk', dir: 'sdk', why: 'window.berm surface, relay quorum, forged-event rejection', steps: [
    ['npm', ['ci', '--no-audit', '--no-fund']],
    ['npm', ['run', 'typecheck']],
    ['npm', ['test']],
    ['npm', ['run', 'bundle']],
  ]},
  { name: 'graph', dir: 'graph', why: 'the four privacy claims', steps: [
    ['npm', ['ci', '--no-audit', '--no-fund']],
    ['npm', ['run', 'typecheck']],
    ['npm', ['test']],
  ]},
  { name: 'docs', dir: 'docs', why: 'frontmatter, dead links, X Article rules', steps: [
    ['node', ['check.mjs']],
  ]},
  { name: 'sdk-browser', dir: 'sdk', browser: true, needs: ['sdk'], why: 'hello example, end to end, two local relays', steps: [
    // The example page loads dist/berm-sdk.global.js. This group used to run
    // only the verify and inherit the bundle from the `sdk` group — fine in one
    // local process, absent on a CI runner that never ran that group.
    ['npm', ['run', 'bundle']],
    ['npm', ['run', 'example:verify']],
  ]},
  { name: 'graph-browser', dir: 'graph', browser: true, needs: ['graph'], why: 'CSP enforcement and byte-identical pages', steps: [
    ['npm', ['run', 'build']],
    ['npm', ['run', 'verify']],
  ]},
  { name: 'editor', dir: 'editor', browser: true, needs: ['sdk'], why: 'decline path publishes nothing', steps: [
    ['npm', ['ci', '--no-audit', '--no-fund']],
    ['npm', ['run', 'build']],
    ['npm', ['run', 'verify']],
  ]},
  { name: 'post', dir: 'post', needs: ['editor', 'landing', 'link', 'sdk'], why: 'X unit counting, refuse-not-truncate, no claim of X delivery', steps: [
    ['npm', ['ci', '--no-audit', '--no-fund']],
    ['npm', ['run', 'typecheck']],
    ['npm', ['test']],
  ]},
  { name: 'post-browser', dir: 'post', browser: true, needs: ['post', 'editor', 'landing', 'link', 'sdk'], why: 'card rasterises, decline publishes nothing, intent opens', steps: [
    ['npm', ['run', 'build']],
    ['npm', ['run', 'verify']],
  ]},
  { name: 'landing', dir: 'landing', why: 'three verdict states, hash-addressed cards, /@handle/slug', steps: [
    ['npm', ['ci', '--no-audit', '--no-fund']],
    ['npm', ['run', 'typecheck']],
    ['npm', ['test']],
  ]},
  { name: 'landing-browser', dir: 'landing', browser: true, needs: ['landing'], why: 'verified / unverified / mismatch, produced against real relays', steps: [
    ['npm', ['run', 'build']],
    ['npm', ['run', 'verify']],
  ]},
  { name: 'node-pages', dir: 'node-pages', needs: ['landing'], why: 'a node publishes only what it verified, and refuses to truncate', steps: [
    ['npm', ['ci', '--no-audit', '--no-fund']],
    ['npm', ['run', 'typecheck']],
    ['npm', ['test']],
    ['npm', ['run', 'verify']],
  ]},
  { name: 'docs-site', dir: '.', why: 'docs build to static HTML with no script and no external origin', steps: [
    ['node', ['docs/build.mjs']],
    // A clone line that 404s tells the reader, correctly, that nothing here is
    // checked. The security policy is the worst possible file to link deadly.
    ['node', ['scripts/set-repo.mjs', '--check']],
    // The root README is the front door and its numbers had already drifted.
    ['node', ['scripts/check-readme.mjs']],
  ]},
  { name: 'chain', dir: 'chain', why: 'no privileged surface, executed in a real EVM, anchor never becomes a dependency', steps: [
    ['npm', ['ci', '--no-audit', '--no-fund']],
    ['npm', ['run', 'typecheck']],
    ['npm', ['test']],
    ['npm', ['run', 'verify']],
  ]},
  { name: 'link', dir: 'link', browser: true, needs: ['sdk'], why: 'claim never renders as verified', steps: [
    ['npm', ['ci', '--no-audit', '--no-fund']],
    ['npm', ['run', 'build']],
    ['npm', ['run', 'verify']],
  ]},
  { name: 'recovery', dir: 'recovery', browser: true, needs: ['sdk'], why: 'readiness verdicts and guardian prompt', steps: [
    ['npm', ['ci', '--no-audit', '--no-fund']],
    ['npm', ['run', 'build']],
    ['npm', ['run', 'verify']],
  ]},
  { name: 'bags', dir: 'bags', why: 'fee-split validation and continuity grading', steps: [
    ['npm', ['ci', '--no-audit', '--no-fund']],
    ['npx', ['vitest', 'run']],
    ['npx', ['tsc', '-p', 'tsconfig.json', '--noEmit']],
  ]},
  { name: 'signer-log', dir: 'signer-log', why: 'build attestations and mismatch detection', steps: [
    ['npm', ['ci', '--no-audit', '--no-fund']],
    ['npx', ['vitest', 'run']],
    ['npx', ['tsc', '-p', 'tsconfig.json', '--noEmit']],
  ]},
  // `bespoke`: CI gives this its own job because the runner needs setting up in
  // a specific way — here, PHP with extensions switched OFF, which is the claim.
  // A generic node runner cannot test it, so it stays out of the unit matrix.
  { name: 'node-php', dir: '.', bespoke: true, why: 'BIP-340 in pure PHP, NIP-01 ids, XSS, no extensions', steps: [
    ['php', ['wordpress/tests/run.php']],
  ]},
  { name: 'supply-chain', dir: '.', why: 'no CDN, no quarantine leak, CI runs every group, no undeclared cross-package imports', steps: [
    ['node', ['scripts/check-supply-chain.mjs']],
    // `--groups` exits before running anything, so this does not recurse.
    ['node', ['scripts/check-ci.mjs']],
    // Cross-package imports are real and undeclared ones only fail on a clean
    // checkout, i.e. in a stranger's terminal rather than in ours.
    ['node', ['scripts/check-package-graph.mjs']],
    // Ten verify scripts once hardcoded a browser path that exists in exactly
    // one sandbox. Passed there, failed everywhere, including CI.
    ['node', ['scripts/check-no-machine-paths.mjs']],
  ]},
];

/* ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const fast = argv.includes('--fast');
const named = argv.filter((a) => !a.startsWith('--'));

/**
 * `--groups [browser|unit]` prints a JSON array of group names.
 *
 * CI builds its matrix from this rather than hand-listing groups. The workflow
 * used to carry its own list and it had already drifted — `post`, `landing`,
 * `chain` and `node-pages` existed with full suites that CI never ran, in a file
 * whose own header says a pipeline with its own command list goes green while
 * the repo is broken. Adding a group to GROUPS above is now the only step.
 */
if (argv.includes('--groups')) {
  const kind = argv[argv.indexOf('--groups') + 1];
  const pick = kind === 'browser' ? (g) => g.browser && !g.bespoke
             : kind === 'unit'    ? (g) => !g.browser && !g.bespoke
             : () => true;
  console.log(JSON.stringify(GROUPS.filter(pick).map((g) => g.name)));
  process.exit(0);
}

const selected = GROUPS
  .filter((g) => (named.length ? named.includes(g.name) : true))
  .filter((g) => !(fast && g.browser));

const skipped = GROUPS.filter((g) => fast && g.browser && (!named.length || named.includes(g.name)));

const results = [];

/**
 * A sibling package is installed once per process, not once per group.
 *
 * `npm ci` deletes node_modules and reinstalls, so repeating it for every group
 * that names the same dependency would be slow and, worse, would wipe an install
 * another group in the same run is relying on.
 */
const installed = new Set();

function installNeed(pkg) {
  if (installed.has(pkg)) return true;
  const cwd = resolve(ROOT, pkg);
  if (!existsSync(join(cwd, 'package.json'))) return false;
  process.stdout.write(`  \u00b7 npm ci --no-audit --no-fund   (needed by this group)  ${pkg}\n`);
  const r = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], {
    cwd, stdio: 'inherit', shell: process.platform === 'win32',
  });
  if (r.status === 0) installed.add(pkg);
  return r.status === 0;
}

for (const g of selected) {
  const cwd = resolve(ROOT, g.dir);
  if (!existsSync(cwd)) {
    results.push({ ...g, ok: false, detail: 'directory missing' });
    continue;
  }

  process.stdout.write(`\n[1m▸ ${g.name}[0m  ${g.why}\n`);
  let ok = true;
  let detail = '';

  // Siblings first. This package's own `npm ci` is one of its own steps, but the
  // packages it reaches INTO must be installed before any compiler runs here, or
  // their bare imports resolve to nothing and the failure reads as a missing
  // dependency of this package rather than of the one it borrowed code from.
  for (const need of g.needs ?? []) {
    if (!installNeed(need)) {
      ok = false;
      detail = `could not install prerequisite package \`${need}\``;
      break;
    }
  }

  for (const [cmd, args] of ok ? g.steps : []) {
    const label = `${cmd} ${args.join(' ')}`;
    process.stdout.write(`  · ${label}\n`);
    const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) {
      ok = false;
      detail = `${label} exited ${r.status ?? 'signal ' + r.signal}`;
      break;
    }
  }

  results.push({ ...g, ok, detail });
}

/* ------------------------------------------------------------------ */

const failed = results.filter((r) => !r.ok);
const pad = Math.max(...results.map((r) => r.name.length), 12);

console.log('\n' + '─'.repeat(64));
for (const r of results) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(pad)}  ${r.ok ? r.why : r.detail}`);
}
for (const s of skipped) {
  // Never let a skip look like a pass. A green summary that quietly omits the
  // browser suites is how a broken build ships.
  console.log(`  SKIP  ${s.name.padEnd(pad)}  needs Chromium (--fast)`);
}
console.log('─'.repeat(64));

if (skipped.length) {
  console.log(`\n${skipped.length} group(s) skipped — this run does NOT prove the browser behaviour.`);
}
console.log(failed.length ? `\n${failed.length} group(s) FAILED\n` : '\nall green\n');

process.exit(failed.length);
