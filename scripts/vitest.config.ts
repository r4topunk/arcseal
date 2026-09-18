import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // The dry-run and resume suites both run `forge script`, which writes the shared
    // contracts/broadcast/Deploy.s.sol/31337/run-latest.json that record-deployment.mjs reads: one file at a time.
    fileParallelism: false,
  },
});
