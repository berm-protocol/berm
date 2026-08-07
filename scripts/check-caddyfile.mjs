#!/usr/bin/env node
/**
 * Catch Caddyfile syntax that only fails on the server.
 *
 * WHY THIS EXISTS. A `xonly.ai` deployment failed twice on one rule: Caddy
 * requires a block's opening brace to be the LAST token on its line.
 *
 *     handle /health { respond "ok" 200 }        <- rejected
 *     handle /health {                            <- fine
 *       respond "ok" 200
 *     }
 *
 * `caddy validate` catches it, but only where caddy is installed — which is the
 * machine we were trying to provision. The error arrived as a server that
 * accepted TCP on :80 and served nothing, which points nowhere near the cause.
 *
 * This is a regex, not a parser. It is not trying to be `caddy validate`; it is
 * trying to catch the one class of mistake that costs an hour of remote
 * debugging, before the file ever leaves here.
 */

import { readFileSync, existsSync } from 'node:fs';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node check-caddyfile.mjs <Caddyfile> [...]');
  process.exit(2);
}

let problems = 0;

for (const file of files) {
  if (!existsSync(file)) {
    console.error(`FAIL  ${file} does not exist`);
    problems++;
    continue;
  }

  const lines = readFileSync(file, 'utf8').split('\n');

  lines.forEach((raw, i) => {
    const n = i + 1;
    // Strip comments and string literals before looking for braces, so a brace
    // inside "…" or `…` — a CSP header, a JSON body — is not a false positive.
    // An earlier version of this check flagged every Content-Security-Policy
    // line in the file it was written to protect.
    const line = raw
      .replace(/#.*$/, '')
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/`[^`]*`/g, '``')
      .trim();

    if (!line) return;

    const opens = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;

    if (opens > 0 && !line.endsWith('{')) {
      console.error(`FAIL  ${file}:${n}  a block's opening brace must be the last token on its line`);
      console.error(`        ${raw.trim()}`);
      problems++;
    } else if (opens > 0 && closes > 0) {
      console.error(`FAIL  ${file}:${n}  single-line block — Caddy rejects { … } on one line`);
      console.error(`        ${raw.trim()}`);
      problems++;
    }
  });

  const text = readFileSync(file, 'utf8');
  const stripped = text.replace(/#.*$/gm, '').replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/`[^`]*`/g, '``');
  const bal = (stripped.match(/\{/g) ?? []).length - (stripped.match(/\}/g) ?? []).length;
  if (bal !== 0) {
    console.error(`FAIL  ${file}  braces unbalanced by ${bal > 0 ? `+${bal}` : bal}`);
    problems++;
  }
}

if (problems) {
  console.error(`\n${problems} Caddyfile problem(s) — do not deploy this`);
  process.exit(1);
}
console.log(`Caddyfile OK: ${files.length} file(s), no single-line blocks, braces balanced`);
