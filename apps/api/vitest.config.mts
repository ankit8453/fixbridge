import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Integration tests are matched by `*.integration.test.ts` and are excluded
    // via the CLI in `npm run test:unit` (used by CI's no-services job).
    globals: false,
    testTimeout: 15_000,
    hookTimeout: 30_000,
    env: {
      // Keeps pino out of pretty-transport (worker thread) mode and keeps test
      // output clean. Real values still come from apps/api/.env or the CI env.
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    },
    reporters: ['default'],
  },
});
