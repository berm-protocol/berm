/**
 * Install the Chromium that this repo's packages actually ask for.
 *
 *   node scripts/install-chromium.mjs            local
 *   node scripts/install-chromium.mjs --with-deps  CI (installs OS libraries too)
 *
 * WHY THIS EXISTS. Playwright keys its browser downloads to its own version, so
 * `playwright@1.49.0 install chromium` puts a browser on disk that
 * `playwright@1.62.0` will not look for. The two do not share a path and the
 * error you get says "executable doesn't exist", pointing at the browser rather
 * than at the version mismatch that caused it.
 *
 * That is exactly what happened: `pages.yml` pinned 1.49.0 while every package
 * had drifted to 1.62.x, and all eight browser groups failed at once in a job
 * that had been green for weeks. `ci.yml` survived only because its unpinned
 * `npx playwright install` fetches latest, which currently matches — luck, and
 * it inverts the day the packages lag behind latest.
 *
 * So the version is READ FROM THE LOCKFILES rather than written down anywhere.
 * There is no number in this file and none in any workflow.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const withDeps = process.argv.includes('--with-deps');

/** Every distinct playwright version any package-lock in the tree resolves to. */
function resolvedVersions() {
  const found = new Map();                       // version -> [package names]

  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const lock = join(ROOT, entry.name, 'package-lock.json');
    if (!existsSync(lock) || statSync(lock).size > 20_000_000) continue;

    let data;
    try { data = JSON.parse(readFileSync(lock, 'utf8')); } catch { continue; }

    // npm lockfile v2/v3 keeps resolved versions under `packages`.
    const v = data.packages?.['node_modules/playwright']?.version;
    if (!v) continue;
    if (!found.has(v)) found.set(v, []);
    found.get(v).push(entry.name);
  }
  return found;
}

const versions = resolvedVersions();

if (versions.size === 0) {
  console.error('FAIL  no package-lock resolves playwright — nothing to install, and the browser groups will fail');
  process.exit(1);
}

for (const [v, pkgs] of versions) {
  console.log(`playwright ${v}  (${pkgs.join(', ')})`);
}

// Patch releases usually share a Chromium build, but "usually" is not a thing to
// bet a suite on — install for each distinct version. The second install is
// nearly free when the build is shared, because Playwright skips what is there.
for (const [v] of versions) {
  const args = ['--yes', `playwright@${v}`, 'install'];
  if (withDeps) args.push('--with-deps');
  args.push('chromium');
  console.log(`\n$ npx ${args.join(' ')}`);
  execFileSync('npx', args, { stdio: 'inherit', cwd: ROOT });
}

console.log(`\nchromium installed for ${versions.size} playwright version(s)\n`);
