import { defineConfig } from 'vitest/config';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Scoped to this package; without a root, vitest walks the monorepo through
// symlinked node_modules and collects suites that have nothing to do with it.
export default defineConfig({
  root: dirname(fileURLToPath(import.meta.url)),
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
