import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Integration tests are matched by `*.integration.test.ts` and are excluded
    // via the CLI in `npm run test:unit` (used by CI's no-services job).
    globals: false,
    /**
     * One file at a time.
     *
     * Every integration suite shares the same Postgres, Redis and seeded
     * dataset — one mutable fixture. Phase 5's gate tests block a seeded user
     * and unlist a seeded profile (restoring both afterwards), while Phase 3 and
     * Phase 4 assert exact counts over the same rows; run in parallel, those
     * race. The same class of bug appeared in Phase 3 over shared Redis keys.
     *
     * Serialising costs a few seconds and removes an entire category of
     * flakiness. Revisit only if the suite gets slow enough to hurt, and then by
     * giving integration tests their own database rather than by re-enabling
     * parallel access to a shared one.
     */
    fileParallelism: false,
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
      OTP_RATE_WINDOW_SECONDS: '900',
      /**
       * Off by default here: suites sign the same phone in repeatedly, and a
       * real 60-second gap between requests would make them sleep. The cooldown
       * has its own dedicated test that switches it back on.
       */
      OTP_RESEND_COOLDOWN_SECONDS: '0',
      /**
       * Every supertest request comes from 127.0.0.1, so a realistic per-IP cap
       * would fire during unrelated sign-ins and make suites order-dependent.
       * The per-IP path is covered directly in `core/rate-limit.integration.test.ts`
       * against real Redis; here it is lifted out of the way.
       */
      OTP_MAX_PER_IP: '1000',

      /**
       * The suite always runs on the fake gateway, whatever `.env` says.
       *
       * A developer who has pointed their local `.env` at real Razorpay test
       * keys — which is exactly what `docs/money.md` tells them to do for a
       * smoke test — must not thereby make `npm test` reach across the
       * internet. Tests that depend on a third party's staging environment are
       * tests people learn to ignore, and these are the money tests.
       *
       * The secrets below are the fake's own signing inputs, not credentials.
       */
      PAYMENT_GATEWAY: 'fake',
      RAZORPAY_KEY_ID: 'rzp_test_fake_key',
      RAZORPAY_KEY_SECRET: 'fake-key-secret',
      RAZORPAY_WEBHOOK_SECRET: 'fake-webhook-secret',
    },
    reporters: ['default'],
  },
});
