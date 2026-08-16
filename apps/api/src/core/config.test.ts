import { describe, expect, it } from 'vitest';
import { ConfigValidationError, EXAMPLE_JWT_SECRET, parseConfig } from './config';

const VALID_ENV = {
  DATABASE_URL: 'postgresql://fixbridge:fixbridge@localhost:5432/fixbridge?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'config-test-secret-value-at-least-32-chars',
  S3_ACCESS_KEY_ID: 'test-access-key',
  S3_SECRET_ACCESS_KEY: 'test-secret-key',
} satisfies NodeJS.ProcessEnv;

/** A production environment that is otherwise entirely valid. */
const PRODUCTION_ENV = {
  ...VALID_ENV,
  NODE_ENV: 'production',
  // Production may not run on the fake gateway, so a "clean" production
  // environment has to name a real one and carry its keys. These are obvious
  // placeholders — no real key ever appears in this repo.
  PAYMENT_GATEWAY: 'razorpay',
  RAZORPAY_KEY_ID: 'rzp_test_placeholder',
  RAZORPAY_KEY_SECRET: 'placeholder-secret',
  RAZORPAY_WEBHOOK_SECRET: 'placeholder-webhook-secret',
} satisfies NodeJS.ProcessEnv;

describe('parseConfig', () => {
  it('accepts the minimum viable environment and applies defaults', () => {
    const config = parseConfig({ ...VALID_ENV });

    expect(config.APP_NAME).toBe('fixbridge');
    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(3000);
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.SHUTDOWN_TIMEOUT_MS).toBe(10_000);
  });

  it('defaults the auth knobs to the documented values', () => {
    const config = parseConfig({ ...VALID_ENV });

    expect(config.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(config.REFRESH_TOKEN_TTL_DAYS).toBe(30);
    expect(config.OTP_TTL_SECONDS).toBe(300);
    expect(config.OTP_MAX_VERIFY_ATTEMPTS).toBe(5);
    // Retuned after the Phase 2 review: CGNAT means a tight per-IP cap locks
    // out strangers sharing a carrier NAT, and 3 per phone is one mistyped
    // digit away from a lockout.
    expect(config.OTP_MAX_PER_PHONE).toBe(5);
    expect(config.OTP_MAX_PER_IP).toBe(30);
    expect(config.OTP_RESEND_COOLDOWN_SECONDS).toBe(60);
    expect(config.OTP_RATE_WINDOW_SECONDS).toBe(900);
    expect(config.AUTH_FIXED_OTP).toBeUndefined();
    expect(config.AUTH_FIXED_OTP_PHONE_PREFIX).toBe('+9199999');
  });

  it('does not trust any proxy hop by default', () => {
    // Trusting X-Forwarded-For blindly would let a caller spoof their IP
    // straight past the per-IP OTP limit.
    expect(parseConfig({ ...VALID_ENV }).TRUST_PROXY_HOPS).toBe(0);
  });

  it('keeps the app name configurable so no brand is baked into the build', () => {
    const config = parseConfig({ ...VALID_ENV, APP_NAME: 'some-other-name' });
    expect(config.APP_NAME).toBe('some-other-name');
  });

  it('coerces PORT from its string environment form', () => {
    const config = parseConfig({ ...VALID_ENV, PORT: '8080' });
    expect(config.PORT).toBe(8080);
    expect(typeof config.PORT).toBe('number');
  });

  it('ignores unrelated environment variables', () => {
    const config = parseConfig({ ...VALID_ENV, HOME: '/root', SOME_CI_VAR: 'x' });
    expect(config).not.toHaveProperty('SOME_CI_VAR');
  });

  it('returns a frozen object', () => {
    const config = parseConfig({ ...VALID_ENV });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('rejects a missing DATABASE_URL and names the field', () => {
    const env = { ...VALID_ENV } as NodeJS.ProcessEnv;
    delete env.DATABASE_URL;

    expect(() => parseConfig(env)).toThrow(ConfigValidationError);
    expect(() => parseConfig(env)).toThrow(/DATABASE_URL/);
  });

  it('rejects a DATABASE_URL that is not a postgres URL', () => {
    expect(() => parseConfig({ ...VALID_ENV, DATABASE_URL: 'mysql://localhost:3306/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects a REDIS_URL with the wrong protocol', () => {
    expect(() => parseConfig({ ...VALID_ENV, REDIS_URL: 'http://localhost:6379' })).toThrow(
      /REDIS_URL/,
    );
  });

  it('rejects an out-of-range PORT', () => {
    expect(() => parseConfig({ ...VALID_ENV, PORT: '70000' })).toThrow(/PORT/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => parseConfig({ ...VALID_ENV, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('rejects an unknown LOG_LEVEL', () => {
    expect(() => parseConfig({ ...VALID_ENV, LOG_LEVEL: 'chatty' })).toThrow(/LOG_LEVEL/);
  });

  it('reports every invalid field at once', () => {
    let message = '';
    try {
      parseConfig({ DATABASE_URL: 'nope', REDIS_URL: 'nope' });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }

    expect(message).toMatch(/DATABASE_URL/);
    expect(message).toMatch(/REDIS_URL/);
    expect(message).toMatch(/JWT_SECRET/);
    expect(message).toMatch(/S3_ACCESS_KEY_ID/);
    expect(message).toMatch(/\.env\.example/);
  });
});

describe('parseConfig — auth secrets', () => {
  it('requires JWT_SECRET', () => {
    const env = { ...VALID_ENV } as NodeJS.ProcessEnv;
    delete env.JWT_SECRET;

    expect(() => parseConfig(env)).toThrow(/JWT_SECRET/);
  });

  it('rejects a JWT_SECRET that is too short to be worth signing with', () => {
    expect(() => parseConfig({ ...VALID_ENV, JWT_SECRET: 'short' })).toThrow(
      /JWT_SECRET.*32 characters/s,
    );
  });

  it('rejects a fixed OTP that is not six digits', () => {
    expect(() => parseConfig({ ...VALID_ENV, AUTH_FIXED_OTP: '123' })).toThrow(
      /AUTH_FIXED_OTP.*6 digits/s,
    );
    expect(() => parseConfig({ ...VALID_ENV, AUTH_FIXED_OTP: 'abcdef' })).toThrow(/AUTH_FIXED_OTP/);
  });

  it('rejects a fixed-OTP prefix that is not an Indian E.164 prefix', () => {
    expect(() => parseConfig({ ...VALID_ENV, AUTH_FIXED_OTP_PHONE_PREFIX: '99999' })).toThrow(
      /AUTH_FIXED_OTP_PHONE_PREFIX/,
    );
  });
});

/**
 * Done criterion 4: the fixed-OTP bypass must be structurally impossible in
 * production. These assert the *config loader* refuses to produce such a config
 * at all — not that some runtime branch happens to skip it.
 */
describe('parseConfig — production guards', () => {
  it('accepts a clean production environment', () => {
    const config = parseConfig({ ...PRODUCTION_ENV });

    expect(config.NODE_ENV).toBe('production');
    expect(config.AUTH_FIXED_OTP).toBeUndefined();
  });

  /**
   * The same shape of guard as the fixed OTP, for the same reason. A production
   * build on the fake gateway would accept payments that never happened, which
   * is the single worst thing this codebase could do.
   */
  it('refuses to start production on the fake gateway', () => {
    expect(() => parseConfig({ ...PRODUCTION_ENV, PAYMENT_GATEWAY: 'fake' })).toThrow(
      ConfigValidationError,
    );
    expect(() => parseConfig({ ...PRODUCTION_ENV, PAYMENT_GATEWAY: 'fake' })).toThrow(
      /PAYMENT_GATEWAY.*payments that never happened/s,
    );
  });

  it('defaults to the fake gateway outside production, with no keys at all', () => {
    const config = parseConfig({ ...VALID_ENV });

    expect(config.PAYMENT_GATEWAY).toBe('fake');
    expect(config.RAZORPAY_KEY_ID).toBeUndefined();
  });

  it.each(['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'])(
    'refuses PAYMENT_GATEWAY=razorpay without %s, in any environment',
    (missing) => {
      // Checked outside production too: a half-configured gateway fails at the
      // first signature check, by which point a customer has already paid.
      const env = { ...VALID_ENV, PAYMENT_GATEWAY: 'razorpay' } as Record<string, string>;
      env.RAZORPAY_KEY_ID = 'rzp_test_placeholder';
      env.RAZORPAY_KEY_SECRET = 'placeholder-secret';
      env.RAZORPAY_WEBHOOK_SECRET = 'placeholder-webhook-secret';
      delete env[missing];

      expect(() => parseConfig(env)).toThrow(new RegExp(`${missing}.*required`, 's'));
    },
  );

  it('refuses to start production with AUTH_FIXED_OTP set', () => {
    expect(() => parseConfig({ ...PRODUCTION_ENV, AUTH_FIXED_OTP: '000000' })).toThrow(
      ConfigValidationError,
    );
    expect(() => parseConfig({ ...PRODUCTION_ENV, AUTH_FIXED_OTP: '000000' })).toThrow(
      /AUTH_FIXED_OTP.*production/s,
    );
  });

  it('refuses a valid-looking fixed OTP in production too', () => {
    // Six digits, so it passes the field-level check — only the cross-field
    // production rule stops it.
    expect(() => parseConfig({ ...PRODUCTION_ENV, AUTH_FIXED_OTP: '482913' })).toThrow(
      /AUTH_FIXED_OTP/,
    );
  });

  it('allows the fixed OTP in development and test', () => {
    expect(
      parseConfig({ ...VALID_ENV, NODE_ENV: 'development', AUTH_FIXED_OTP: '000000' })
        .AUTH_FIXED_OTP,
    ).toBe('000000');
    expect(
      parseConfig({ ...VALID_ENV, NODE_ENV: 'test', AUTH_FIXED_OTP: '000000' }).AUTH_FIXED_OTP,
    ).toBe('000000');
  });

  it('refuses the .env.example placeholder secret in production', () => {
    expect(() => parseConfig({ ...PRODUCTION_ENV, JWT_SECRET: EXAMPLE_JWT_SECRET })).toThrow(
      /JWT_SECRET.*placeholder/s,
    );
  });

  it('still allows the placeholder secret in development', () => {
    expect(
      parseConfig({ ...VALID_ENV, NODE_ENV: 'development', JWT_SECRET: EXAMPLE_JWT_SECRET })
        .JWT_SECRET,
    ).toBe(EXAMPLE_JWT_SECRET);
  });

  it('reports both production violations together', () => {
    let message = '';
    try {
      parseConfig({
        ...PRODUCTION_ENV,
        JWT_SECRET: EXAMPLE_JWT_SECRET,
        AUTH_FIXED_OTP: '000000',
      });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }

    expect(message).toMatch(/AUTH_FIXED_OTP/);
    expect(message).toMatch(/JWT_SECRET/);
  });
});
