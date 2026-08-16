import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { DEFAULT_APP_NAME } from '@fixbridge/shared';

/**
 * Load `apps/api/.env` if present. Real environment variables always win —
 * dotenv never overwrites something already set (important for CI/containers).
 *
 * `__dirname` is `src/core` in dev and `dist/core` after a build; both are two
 * levels below `apps/api`, so one resolve covers both.
 */
loadDotenv({ path: path.resolve(__dirname, '..', '..', '.env') });

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
const NODE_ENVS = ['development', 'test', 'production'] as const;

/**
 * A URL string restricted to a set of protocols. Written with `refine` rather
 * than a built-in url validator so it works the same across zod majors and
 * produces an error message a human can act on.
 */
const urlWithProtocols = (protocols: readonly string[], label: string) =>
  z
    .string()
    .min(1)
    .refine(
      (value) => {
        try {
          return protocols.includes(new URL(value).protocol);
        } catch {
          return false;
        }
      },
      { message: `must be a valid ${label} URL (expected protocol: ${protocols.join(' or ')})` },
    );

/**
 * The placeholder shipped in `.env.example`. Committing it to a real deployment
 * would hand every attacker a token-signing key, so production rejects it.
 */
export const EXAMPLE_JWT_SECRET = 'dev-only-secret-change-me-at-least-32-chars';

const baseConfigSchema = z.object({
  /** The brand name is not decided — this is the single source of truth for it. */
  APP_NAME: z.string().min(1).default(DEFAULT_APP_NAME),
  NODE_ENV: z.enum(NODE_ENVS).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  DATABASE_URL: urlWithProtocols(['postgres:', 'postgresql:'], 'PostgreSQL'),
  REDIS_URL: urlWithProtocols(['redis:', 'rediss:'], 'Redis'),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(0).max(120_000).default(10_000),

  /**
   * Hop count passed to Express's `trust proxy`. Keep at 0 unless the API really
   * sits behind a proxy: trusting `X-Forwarded-For` blindly lets any caller spoof
   * their IP and walk straight past the per-IP OTP rate limit.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),

  /* ---- auth ---- */

  /** HS256 signing key for access tokens. No default — a missing key must fail the boot. */
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  /** Access tokens are deliberately short-lived; refresh rotation covers longevity. */
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(1_800).default(300),
  OTP_MAX_VERIFY_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  OTP_RATE_WINDOW_SECONDS: z.coerce.number().int().min(60).max(3_600).default(900),
  /** Raised from 3: a user who mistypes twice on a slow SMS should not be locked out. */
  OTP_MAX_PER_PHONE: z.coerce.number().int().min(1).max(100).default(5),
  /**
   * Raised from 5 for CGNAT: Indian mobile carriers put large numbers of
   * subscribers behind one public IP, so a tight per-IP cap locks out strangers.
   * The per-phone cap does the real work; this is a coarse flood guard.
   */
  OTP_MAX_PER_IP: z.coerce.number().int().min(1).max(1_000).default(30),
  /**
   * Minimum gap between OTP requests for one phone. Most budget burn is an
   * impatient user tapping resend while the carrier sits on the first SMS —
   * this turns a 15-minute lockout into a 40-second wait.
   */
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(0).max(600).default(60),

  /**
   * Development/testing shortcut: this OTP always verifies, but only for phones
   * starting with `AUTH_FIXED_OTP_PHONE_PREFIX`. Refused outright in production
   * by the refinement below — it is not a runtime check that can be bypassed.
   */
  AUTH_FIXED_OTP: z
    .string()
    .regex(/^\d{6}$/, 'must be exactly 6 digits')
    .optional(),
  AUTH_FIXED_OTP_PHONE_PREFIX: z
    .string()
    .regex(/^\+91\d{0,8}$/, 'must be an E.164 Indian prefix, e.g. +9199999')
    .default('+9199999'),

  /** Phone for the admin/ops account created by `npm run seed`. */
  SEED_ADMIN_PHONE: z.string().min(1).default('+919999900001'),

  /* ---- profiles ---- */

  /**
   * Completeness score a technician must reach before appearing in search.
   * See `modules/providers/completeness.ts` for the weighting.
   */
  PROVIDER_LISTING_THRESHOLD: z.coerce.number().int().min(0).max(100).default(80),
  /** Saved addresses per customer. Keeps the picker usable and bounds abuse. */
  MAX_ADDRESSES_PER_USER: z.coerce.number().int().min(1).max(50).default(5),
  /** Default city for endpoints that accept an optional cityId. Jabalpur = 1. */
  DEFAULT_CITY_ID: z.coerce.number().int().min(1).default(1),

  /* ---- object storage (KYC documents) ---- */

  /** S3-compatible endpoint. MinIO locally; leave unset for real AWS S3. */
  S3_ENDPOINT: z.string().min(1).optional(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  /** Private bucket. Nothing in it is ever world-readable. */
  S3_BUCKET: z.string().min(1).default('fixbridge-kyc'),
  /** MinIO needs path-style addressing; real S3 prefers virtual-host style. */
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  /** Pre-signed URLs are deliberately short-lived — DPDP means least exposure. */
  STORAGE_UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
  STORAGE_DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
  STORAGE_MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(100 * 1_024 * 1_024)
    .default(10 * 1_024 * 1_024),

  /** Phone for the ops-only account created by `npm run seed`. */
  SEED_OPS_PHONE: z.string().min(1).default('+919999900002'),

  /* ---- search ---- */

  /** Public endpoint, so it gets its own per-IP budget. */
  SEARCH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1_000).default(30),
  /** Hard ceiling on the customer-supplied `max_distance_km`. */
  SEARCH_MAX_DISTANCE_KM: z.coerce.number().int().min(1).max(100).default(25),
  /**
   * How many matches are pulled back for ranking before pagination. Ranking runs
   * in TypeScript so the scorer stays pure and pluggable, which means the
   * candidate set has to be bounded. See docs/search.md.
   */
  SEARCH_MAX_CANDIDATES: z.coerce.number().int().min(10).max(2_000).default(200),
  /** pg_trgm similarity floor for fuzzy synonym matching. */
  SEARCH_TRIGRAM_THRESHOLD: z.coerce.number().min(0.05).max(1).default(0.3),
  /** Category provider counts are cached; staleness is accepted, see docs. */
  CATEGORY_COUNT_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(3_600).default(300),

  /* ---- ranking weights ----
   * Changing how results are ordered must never require a code change. Every
   * weight is config; the scorer reads them and nothing else does.
   */
  RANK_WEIGHT_DISTANCE: z.coerce.number().min(0).max(100).default(50),
  RANK_WEIGHT_BADGE: z.coerce.number().min(0).max(100).default(15),
  RANK_WEIGHT_EXPERIENCE: z.coerce.number().min(0).max(100).default(10),
  RANK_WEIGHT_COMPLETENESS: z.coerce.number().min(0).max(100).default(5),
  /** Phase 9 supplies real trust scores; until then every provider is neutral. */
  RANK_WEIGHT_TRUST: z.coerce.number().min(0).max(100).default(10),
  /** Phase 6 supplies real acceptance rates. */
  RANK_WEIGHT_ACCEPTANCE: z.coerce.number().min(0).max(100).default(5),
  RANK_WEIGHT_PRICE: z.coerce.number().min(0).max(100).default(5),
  /** Distance at which the distance score halves. Smaller = more local bias. */
  RANK_DISTANCE_HALF_LIFE_KM: z.coerce.number().min(0.1).max(50).default(5),

  /* ---- slots & bookings ---- */

  /** How far ahead slots are materialised. The nightly job extends this. */
  SLOT_HORIZON_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  /** Slot length. A template window shorter than this produces no slot. */
  SLOT_INCREMENT_MINUTES: z.coerce.number().int().min(15).max(480).default(60),
  /** How long a technician has to answer before the request expires. */
  BOOKING_REQUEST_TTL_MINUTES: z.coerce.number().int().min(1).max(240).default(15),
  /** Snapshot onto each booking at creation. Stored, never charged — Phase 8. */
  BOOKING_VISIT_FEE_PAISE: z.coerce.number().int().min(0).default(4_900),
  /** Start/end handshake codes. Shorter than a login OTP; spoken aloud, in person. */
  BOOKING_OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(4),
  BOOKING_OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),

  /* ---- outbox ---- */

  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(200).max(60_000).default(2_000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(8),
  /** Backoff base in seconds: attempt N waits base * 2^(N-1), capped. */
  OUTBOX_BACKOFF_BASE_SECONDS: z.coerce.number().int().min(1).max(600).default(5),
  OUTBOX_BACKOFF_MAX_SECONDS: z.coerce.number().int().min(5).max(86_400).default(3_600),
  /**
   * Background jobs run in-process. Off by default in tests, which drive the
   * jobs directly with an injected clock rather than waiting for a timer.
   */
  JOBS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  /** How often unanswered requests are swept. A minute is fine granularity here. */
  BOOKING_EXPIRY_JOB_INTERVAL_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
  /**
   * How often the slot horizon is extended.
   *
   * Called "nightly" in the docs, but it is an interval, not a clock time: a
   * process that restarts twice a day would never reach a 24-hour timer. The job
   * is idempotent, so running it four times a day costs a diff that finds
   * nothing — much cheaper than a horizon that quietly stopped advancing.
   */
  SLOT_HORIZON_JOB_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(86_400_000)
    .default(6 * 60 * 60 * 1_000),

  /* ---- payments ---- */

  /**
   * Which gateway is real.
   *
   * Defaults to `fake` so a fresh clone, and every test, works with no keys and
   * no network. Production is not allowed to leave it there — see the guard
   * below: shipping a payments build that silently takes fake money would be
   * the worst possible failure of this phase.
   */
  PAYMENT_GATEWAY: z.enum(['fake', 'razorpay']).default('fake'),
  /** Required only when `PAYMENT_GATEWAY=razorpay`. Never logged, never in code. */
  RAZORPAY_KEY_ID: z.string().min(1).optional(),
  RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),
  /** The platform's cut when no `commission_config` row applies. 1200 = 12%. */
  COMMISSION_DEFAULT_BPS: z.coerce.number().int().min(0).max(10_000).default(1_200),
  /**
   * Take the visit fee up front, at booking rather than at completion.
   *
   * Off for the pilot. The flow is built and tested because the decision to turn
   * it on should be a config change and a conversation, not a sprint — but a
   * technician who has not turned up yet has not earned anything, and asking a
   * first-time customer to pay before they see anybody is the surest way to lose
   * them in a market that runs on trust.
   */
  COLLECT_FEE_AT_BOOKING: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  /** Below this, a payout is not worth a bank transfer. ₹100. */
  PAYOUT_MINIMUM_PAISE: z.coerce.number().int().min(0).default(10_000),
  /** Wallet history depth. */
  WALLET_LEDGER_PAGE_SIZE: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * Cross-field rules. These are schema-level, not runtime `if` statements, so a
 * production process holding a dangerous combination cannot start at all.
 */
export const configSchema = baseConfigSchema.superRefine((config, ctx) => {
  /**
   * Razorpay needs all three keys or none.
   *
   * Checked in every environment, not just production: a half-configured gateway
   * fails at the first signature check, which is the worst moment to find out —
   * a customer has already paid by then.
   */
  if (config.PAYMENT_GATEWAY === 'razorpay') {
    const required = [
      ['RAZORPAY_KEY_ID', config.RAZORPAY_KEY_ID],
      ['RAZORPAY_KEY_SECRET', config.RAZORPAY_KEY_SECRET],
      ['RAZORPAY_WEBHOOK_SECRET', config.RAZORPAY_WEBHOOK_SECRET],
    ] as const;

    for (const [field, value] of required) {
      if (value === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: 'is required when PAYMENT_GATEWAY=razorpay',
        });
      }
    }
  }

  if (config.NODE_ENV !== 'production') return;

  /**
   * Production may not take fake money.
   *
   * The same shape of guard as the fixed-OTP one: a dangerous combination is
   * refused by the schema, so the process cannot start holding it rather than
   * discovering it at the first payment.
   */
  if (config.PAYMENT_GATEWAY === 'fake') {
    ctx.addIssue({
      code: 'custom',
      path: ['PAYMENT_GATEWAY'],
      message:
        'must not be "fake" when NODE_ENV=production — it would accept payments that never happened',
    });
  }

  if (config.AUTH_FIXED_OTP !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['AUTH_FIXED_OTP'],
      message: 'must not be set when NODE_ENV=production — it would bypass OTP verification',
    });
  }

  if (config.JWT_SECRET === EXAMPLE_JWT_SECRET) {
    ctx.addIssue({
      code: 'custom',
      path: ['JWT_SECRET'],
      message: 'must not be the placeholder from .env.example when NODE_ENV=production',
    });
  }
});

export type AppConfig = Readonly<z.infer<typeof configSchema>>;

/** Thrown when the process environment cannot produce a valid config. */
export class ConfigValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(
      [
        'Invalid environment configuration:',
        ...issues.map((issue) => `  - ${issue}`),
        '',
        'Copy apps/api/.env.example to apps/api/.env and fill in the missing values.',
      ].join('\n'),
    );
    this.name = 'ConfigValidationError';
  }
}

/**
 * Pure parser — no side effects, no caching. Unit tests use this directly.
 * Unknown environment variables are ignored, not rejected.
 */
export function parseConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = configSchema.safeParse(env);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const field = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${field}: ${issue.message}`;
    });
    throw new ConfigValidationError(issues);
  }

  return Object.freeze(result.data);
}

let cachedConfig: AppConfig | undefined;

/** Memoised process config. Throws `ConfigValidationError` on bad input. */
export function loadConfig(): AppConfig {
  cachedConfig ??= parseConfig();
  return cachedConfig;
}

/** Test-only escape hatch. */
export function resetConfigCache(): void {
  cachedConfig = undefined;
}
