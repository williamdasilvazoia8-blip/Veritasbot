import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Integration tests share one PostgreSQL database; run files sequentially.
    fileParallelism: false,
    testTimeout: 20_000,
    globalSetup: ['tests/setup/global-setup.ts'],
  },
});
