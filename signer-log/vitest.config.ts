import { defineConfig } from 'vitest/config';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Scoped to this package — a symlinked node_modules otherwise pulls in every
// suite in the monorepo, including crypto's deliberate nine-second PIN search.
export default defineConfig({
  test: { root: dirname(fileURLToPath(import.meta.url)), include: ['test/**/*.test.ts'] },
});
