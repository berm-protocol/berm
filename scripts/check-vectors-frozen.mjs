/**
 * The frozen vectors still regenerate byte-identically.
 *
 * Originally this was `npm run vectors:generate && git diff --exit-code`, which
 * failed confusingly outside a git checkout and told you nothing useful when it
 * did. Hashing the file directly is both more robust and a better description
 * of the actual claim: *these exact bytes come back*.
 *
 * A mismatch does not mean a test is wrong. It means a derivation changed,
 * which means every existing user's identity changed. Regeneration is a
 * deliberate, versioned migration and never a fix for red CI.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CRYPTO = join(ROOT, 'crypto');
const VECTORS = join(CRYPTO, 'vectors', 'test-vectors.json');

const sha = (b) => createHash('sha256').update(b).digest('hex');

/**
 * The baseline, pinned.
 *
 * WHY THIS EXISTS. The original check regenerated the file and compared the hash
 * before and after — which proves the generator is DETERMINISTIC and nothing
 * more. It does not prove the values still match the historical baseline, and
 * that gap is not theoretical: during the XNSB→Berm rename the generator's test
 * seed strings were renamed along with everything else, every derived key in the
 * file changed, and this check would have stayed green forever afterwards
 * because regeneration was still idempotent.
 *
 * Pinning the hash closes it. Any change to a derived value now fails loudly and
 * has to be explained and re-pinned deliberately, which is the whole point of
 * calling the file frozen.
 *
 * Last re-pinned: the Berm rename. Only `$schema`, `generatedBy`, and one sample
 * profile's display string moved — proved field-by-field against the previous
 * file, with every key, npub, scalar and conversation key byte-identical.
 */
const PINNED = '1177dbdaab556a30bd443ac4ba92d2a1ca351cb3c1b8bd697a51c61a6de62193';

const before = readFileSync(VECTORS);
const beforeHash = sha(before);
console.log(`before  ${beforeHash}`);

const r = spawnSync('npm', ['run', 'vectors:generate'], {
  cwd: CRYPTO, stdio: 'inherit', shell: process.platform === 'win32',
});
if (r.status !== 0) {
  console.error('\nvectors:generate failed — cannot verify the baseline\n');
  process.exit(1);
}

const after = readFileSync(VECTORS);
const afterHash = sha(after);
console.log(`after   ${afterHash}`);

if (afterHash !== beforeHash) {
  // Put the file back. A check that leaves the tree dirty turns one failure
  // into a second, confusing one on the next run.
  writeFileSync(VECTORS, before);
  console.error(`
VECTORS CHANGED.

  ${beforeHash}  committed
  ${afterHash}  regenerated

The file has been restored, so nothing is lost. But a derivation now produces
different bytes from the same public inputs, which means every identity derived
by the old code no longer matches the new code.

If that is intentional it is a migration: bump the version, write the upgrade
path, and say so explicitly. If it is not intentional, something in the
derivation, the salts, or a dependency changed underneath you.
`);
  process.exit(1);
}

if (afterHash !== PINNED) {
  console.error(`
VECTORS DIFFER FROM THE PINNED BASELINE.

  ${PINNED}  pinned
  ${afterHash}  on disk

Regeneration is still deterministic, so the generator is not broken — but the
values are no longer the ones this project froze. Something changed the INPUTS:
a salt, a test seed string, or a dependency.

Do not re-pin to make this pass. Diff the file against the previous baseline
field by field and establish that no key material moved. If something did, it is
a migration and needs a version bump and an upgrade path.
`);
  process.exit(1);
}

console.log('\nvectors reproduce byte-identically, and match the pinned baseline\n');
