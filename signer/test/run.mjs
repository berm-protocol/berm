import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
let bad = 0;
for (const f of readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort()) {
  const r = spawnSync(process.execPath, [resolve(here, f)], { stdio: 'inherit' });
  if (r.status !== 0) bad++;
}
process.exit(bad === 0 ? 0 : 1);
