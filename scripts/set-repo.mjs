/**
 * Point every repository URL in the tree at one org/name pair.
 *
 *   node scripts/set-repo.mjs berm-protocol berm
 *   node scripts/set-repo.mjs --check          fail if a placeholder survives
 *
 * WHY A SCRIPT. Three files carry a clone URL and they drifted immediately —
 * one said `xonly`, one said `berm`, one said `DUMMY`. A reader who follows a
 * clone line that 404s has been told, correctly, that nothing here is checked.
 * So the URL has exactly one way to be written and one command that writes it.
 *
 * `--check` runs in CI. A placeholder that ships is a dead link in the security
 * policy, which is the single worst file to have a dead link in.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Every file that names the repository, and the shape it names it in. */
const SITES = [
  {
    file: '.github/ISSUE_TEMPLATE/config.yml',
    pattern: /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/blob\/main\/SECURITY\.md/,
    write: (org, name) => `https://github.com/${org}/${name}/blob/main/SECURITY.md`,
  },
  {
    file: 'docs/content/verify.md',
    pattern: /git clone https:\/\/github\.com\/[^/\s]+\/[^/\s]+ && cd [^/\s]+\/crypto/,
    write: (org, name) => `git clone https://github.com/${org}/${name} && cd ${name}/crypto`,
  },
  {
    file: 'CONTRIBUTING.md',
    pattern: /git clone https:\/\/github\.com\/[^/\s]+\/[^/\s]+ && cd \S+/,
    write: (org, name) => `git clone https://github.com/${org}/${name} && cd ${name}`,
  },
];

/**
 * Anything matching this is unset. Kept as a list rather than one token because
 * the placeholders were written by hand at different times and `--check` has to
 * catch all of them, not the one we remembered.
 */
const PLACEHOLDERS = [/\bDUMMY\b/, /<org>/, /YOUR_ORG/, /example-org/];

const argv = process.argv.slice(2);

if (argv[0] === '--check') {
  let bad = 0;
  for (const s of SITES) {
    const body = readFileSync(join(ROOT, s.file), 'utf8');
    const line = body.split('\n').find((l) => PLACEHOLDERS.some((p) => p.test(l)));
    if (line) {
      console.error(`FAIL  ${s.file}  still a placeholder: ${line.trim()}`);
      bad++;
    }
    if (!s.pattern.test(body)) {
      console.error(`FAIL  ${s.file}  no clone URL found where one is expected`);
      bad++;
    }
  }
  console.log(bad ? `\n${bad} problem(s)\n` : 'repository URLs are set and consistent\n');
  process.exit(bad ? 1 : 0);
}

const [org, name = 'berm'] = argv;
if (!org) {
  console.error('usage: node scripts/set-repo.mjs <org> [repo-name]');
  process.exit(2);
}

for (const s of SITES) {
  const path = join(ROOT, s.file);
  const before = readFileSync(path, 'utf8');
  const after = before.replace(s.pattern, s.write(org, name));
  if (after === before && !s.pattern.test(before)) {
    console.error(`FAIL  ${s.file}  nothing matched — the file changed shape, fix this script`);
    process.exit(1);
  }
  writeFileSync(path, after);
  console.log(`  set  ${s.file}`);
}
console.log(`\ngithub.com/${org}/${name}\n`);
