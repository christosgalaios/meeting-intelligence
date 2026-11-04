import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // API tests share one Postgres; each uses its own schema, but run files serially to keep it simple.
    fileParallelism: false,
    testTimeout: 30_000,
    env: { LOG_LEVEL: 'silent' },
    // A number to quote, not a gate: there is deliberately no threshold. Run with `npm run test:coverage`.
    coverage: { provider: 'v8', include: ['src/**/*.ts'], exclude: ['src/**/*.d.ts'], reporter: ['text-summary', 'text'] },
  },
});
