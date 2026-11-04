import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // API tests share one Postgres; each uses its own schema, but run files serially to keep it simple.
    fileParallelism: false,
    testTimeout: 30_000,
    env: { LOG_LEVEL: 'silent' },
  },
});
