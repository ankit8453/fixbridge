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

      // Hermetic auth settings so the suite does not depend on a developer's
      // .env. dotenv never overrides an already-set variable, so these win.
      JWT_SECRET: 'test-only-secret-value-at-least-32-characters-long',
      AUTH_FIXED_OTP: '000000',
      AUTH_FIXED_OTP_PHONE_PREFIX: '+9199999',
      OTP_MAX_PER_PHONE: '3',
      OTP_MAX_PER_IP: '5',
      OTP_RATE_WINDOW_SECONDS: '900',
    },
    reporters: ['default'],
  },
});
