import { defineConfig } from 'vitest/config';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Scoped to this package's own tests.
 *
 * Without this, vitest walks up past the symlinked node_modules and collects
 * every suite in the monorepo — including crypto's deliberate nine-second PIN
 * search, which then times out and reports a failure that has nothing to do
 * with this package.
 */
export default defineConfig({
  test: {
    root: dirname(fileURLToPath(import.meta.url)),
    include: ['test/**/*.test.ts'],
  },
});
