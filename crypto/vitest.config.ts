import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // The V6 offline PIN search is intentionally slow — it is the most
    // persuasive test in the repo and its runtime IS the finding.
    testTimeout: 120_000,
  },
});
