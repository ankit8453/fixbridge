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
  /**
   * 3001, not 3000.
   *
   * Phase 12's web app owns `:3000` — it is the origin a person's browser
   * actually visits, and Next's dev server, its docs and every tutorial assume
   * that port. Moving the API is the cheaper of the two: nothing bookmarks it,
   * and production sets `PORT` explicitly anyway.
   */
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
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

  /**
   * How a login code reaches somebody.
   *
   * `logger` prints it to the terminal and is refused in production. `disabled`
   * lets the API start without being able to send at all — for a deployment
   * standing up before its messaging credentials exist. It has to be asked for
   * explicitly, so nobody arrives there by forgetting to configure something.
   */
  AUTH_OTP_TRANSPORT: z.enum(['logger', 'disabled', 'mbg']).default('logger'),

  /* ---- MBGCart WhatsApp. Required when AUTH_OTP_TRANSPORT=mbg. ---- */

  MBG_API_BASE_URL: z.string().url().default('https://app.mbgcart.com/api'),

  /** `X-ACCESS-TOKEN`. **The secret.** Never logged, never in code. */
  MBG_ACCESS_TOKEN: z.string().min(1).optional(),

  /** The dashboard flow that actually sends the WhatsApp message. */
  MBG_OTP_FLOW_ID: z.string().min(1).optional(),

  /** Contact field the flow reads the code from. */
  MBG_OTP_FIELD_NAME: z.string().min(1).default('DATA_BANK_OTP'),

  /**
   * Whether the number keeps its leading `+`.
   *
   * Phones are stored in E.164 (`+919876543210`) and most WhatsApp providers
   * want the digits alone, which is the default. If MBGCart accepts the call
   * but nothing arrives, this is the first thing to try.
   */
  MBG_PHONE_INCLUDE_PLUS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  MBG_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(8_000),

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

  /**
   * The dev password for the seeded ops and admin accounts.
   *
   * A development convenience with the same shape of guard as `AUTH_FIXED_OTP`:
   * the refinement below refuses it outright in production, so a seeded, known
   * password cannot reach a real deployment by being forgotten. Staff passwords
   * in production are set by an operator, never by a seed.
   */
  SEED_STAFF_PASSWORD: z.string().min(12).optional(),

  /**
   * Sign-in attempts before the ops console locks somebody out, per identifier
   * and per IP.
   *
   * Two separate budgets because they stop different attacks: one attacker
   * guessing many passwords for one known ops account, and one attacker trying
   * one common password against many accounts. A limit on either alone leaves
   * the other wide open. Tighter than the OTP limits because a password is
   * guessable in a way a phone is not.
   */
  ADMIN_LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(5),
  ADMIN_LOGIN_MAX_PER_IP: z.coerce.number().int().min(1).max(1_000).default(20),
  ADMIN_LOGIN_WINDOW_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),

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

  /**
   * Profile photos get their own, tighter cap.
   *
   * A KYC document may legitimately be a multi-page scanned certificate; a
   * photograph of a face has no such excuse. A modern phone photo is 2-4 MB, so
   * 5 MB fits real uploads with headroom while keeping one technician from
   * parking 10 MB per attempt — and the browser downscales before uploading, so
   * most land far below this.
   */
  PROFILE_PHOTO_MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(20 * 1_024 * 1_024)
    .default(5 * 1_024 * 1_024),

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
  /**
   * How long a request stays acceptable before it expires.
   *
   * Deliberately longer than the 15 minutes a technician is *asked* to respond
   * in: that prompt is a nudge, not a deadline. During the pilot the people on
   * the platform are five technicians who do not yet watch the app, and a
   * booking that dies at minute 15 cannot be rescued by the phone call that
   * actually gets it accepted. The technician can still accept it himself the
   * whole time, which is the outcome worth having.
   *
   * A booking also never outlives its own start time — see `expiryCutoffFor`.
   */
  BOOKING_REQUEST_TTL_MINUTES: z.coerce.number().int().min(1).max(240).default(60),

  /**
   * Lets ops accept a booking on the technician's behalf.
   *
   * Pilot scaffolding, and meant to be switched off: it exists because the
   * first few technicians take work by phone before they trust the app. Once
   * they are answering in-app — say twenty or thirty active — set this false
   * and the button disappears. See `acceptOnBehalf` in bookings/service.ts.
   */
  BOOKING_OPS_ACCEPT_ENABLED: z
    .string()
    .default('true')
    .transform((value) => value === 'true'),

  /**
   * What the technician is *asked* for, in the message he receives.
   *
   * Separate from the TTL above because they answer different questions: this
   * is "please reply quickly", that is "when does this booking die".
   */
  BOOKING_RESPONSE_PROMPT_MINUTES: z.coerce.number().int().min(1).max(240).default(15),
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
  PAYMENT_GATEWAY: z.enum(['fake', 'razorpay', 'paytm']).default('fake'),
  /** Required only when `PAYMENT_GATEWAY=razorpay`. Never logged, never in code. */
  RAZORPAY_KEY_ID: z.string().min(1).optional(),
  RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),

  /* ---- Paytm. Required only when `PAYMENT_GATEWAY=paytm`. ---- */

  /**
   * Merchant ID. Public — it is sent to the client to open checkout, and is
   * the closest thing Paytm has to Razorpay's publishable key.
   */
  PAYTM_MID: z.string().min(1).optional(),

  /**
   * Merchant key. **The secret.** Every checksum is derived from it, so it
   * signs and verifies everything and must never leave the server or reach a
   * log line.
   */
  PAYTM_MERCHANT_KEY: z.string().min(1).optional(),

  /**
   * The website identifier Paytm issues alongside the MID. Staging is
   * `WEBSTAGING`; production is whatever the dashboard shows, commonly
   * `DEFAULT`. Wrong values here fail at Initiate Transaction rather than at
   * payment, which is at least an early and obvious failure.
   */
  PAYTM_WEBSITE: z.string().min(1).default('WEBSTAGING'),

  /**
   * API host, without a trailing slash.
   *
   * Staging is `https://securestage.paytmpayments.com`; production is
   * `https://secure.paytmpayments.com`. Note this is the newer
   * `paytmpayments.com` domain — older guides still show `securegw.paytm.in`.
   *
   * A host rather than a `staging: boolean` because the two differ only by
   * hostname, and a boolean invites a build that is "not staging" without
   * anyone checking what that actually points at.
   */
  PAYTM_HOST: z.string().url().default('https://securestage.paytmpayments.com'),

  /**
   * Where Paytm sends the customer back to after payment.
   *
   * Paytm posts the result here as a form. It is **not** treated as proof of
   * anything — see the adapter — but it has to exist and be reachable, and
   * Paytm validates it against the merchant configuration.
   */
  PAYTM_CALLBACK_URL: z.string().url().optional(),
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

  /* ---- reviews & trust ---- */

  /**
   * How long after settlement a review may be written.
   *
   * Long enough that somebody who was out that week can still say something,
   * short enough that the memory is real. A rating written six weeks later is
   * mostly about how the last conversation went.
   */
  REVIEW_WINDOW_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  /** How long after a booking ends a complaint may be raised. */
  COMPLAINT_WINDOW_DAYS: z.coerce.number().int().min(1).max(180).default(14),

  /**
   * Trust score weights. Reordering what matters must never need a code change,
   * so every weight lives here and the scorer reads them from its input.
   */
  TRUST_WEIGHT_RATING: z.coerce.number().min(0).max(100).default(35),
  TRUST_WEIGHT_ACCEPTANCE: z.coerce.number().min(0).max(100).default(20),
  TRUST_WEIGHT_RELIABILITY: z.coerce.number().min(0).max(100).default(20),
  TRUST_WEIGHT_COMPLAINTS: z.coerce.number().min(0).max(100).default(15),
  TRUST_WEIGHT_RECENCY: z.coerce.number().min(0).max(100).default(10),
  /** A review's influence halves after this many days. */
  TRUST_RATING_HALF_LIFE_DAYS: z.coerce.number().int().min(1).max(3_650).default(90),
  /** "Recently active" halves after this many days idle. */
  TRUST_RECENCY_HALF_LIFE_DAYS: z.coerce.number().int().min(1).max(3_650).default(90),
  /** Weighted complaint load at which that component hits zero. */
  TRUST_COMPLAINT_ZERO_AT: z.coerce.number().min(1).max(100).default(6),

  /* ---- badge bands ---- */

  BADGE_SILVER_MIN_SCORE: z.coerce.number().int().min(0).max(100).default(70),
  BADGE_SILVER_MIN_JOBS: z.coerce.number().int().min(0).default(10),
  BADGE_GOLD_MIN_SCORE: z.coerce.number().int().min(0).max(100).default(85),
  BADGE_GOLD_MIN_JOBS: z.coerce.number().int().min(0).default(30),

  /* ---- auto-suspension ---- */

  SUSPEND_TRUST_BELOW: z.coerce.number().int().min(0).max(100).default(30),
  SUSPEND_TRUST_MIN_JOBS: z.coerce.number().int().min(1).default(10),
  SUSPEND_CANCELLATION_COUNT: z.coerce.number().int().min(1).default(3),
  SUSPEND_CANCELLATION_WINDOW_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  /** How long an automatic suspension lasts before it lapses on its own. */
  SUSPEND_DURATION_DAYS: z.coerce.number().int().min(1).max(365).default(7),

  /**
   * How often every active technician is rescored, whether or not anything
   * happened to them.
   *
   * Called "nightly" in the docs, but it is an interval for the same reason the
   * slot horizon is: a process that restarts twice a day would never reach a
   * 24-hour timer. It is cheap to run often — a recompute reads current truth and
   * writes a snapshot only when the number actually moved — and it exists so the
   * recency component decays for somebody who has simply stopped working, which
   * no event will ever announce.
   */
  TRUST_RECOMPUTE_JOB_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(86_400_000)
    .default(6 * 60 * 60 * 1_000),

  /* ---- notifications ---- */

  /**
   * Which implementation actually sends.
   *
   * `console` is the default so a fresh clone runs the whole pipeline — routing,
   * language, quiet hours, retries — with no vendor account and no network.
   * Production refuses `fake` below; it would silently swallow every suspension
   * notice while looking perfectly healthy.
   */
  NOTIFY_WHATSAPP_TRANSPORT: z.enum(['console', 'fake', 'whatsapp_cloud']).default('console'),
  NOTIFY_SMS_TRANSPORT: z.enum(['console', 'fake', 'msg91']).default('console'),

  /** MSG91. Required only when `NOTIFY_SMS_TRANSPORT=msg91`. */
  MSG91_AUTH_KEY: z.string().min(1).optional(),
  /** The 6-character DLT-registered sender id, e.g. `FIXBRG`. */
  MSG91_SENDER_ID: z.string().min(1).optional(),
  /**
   * JSON: template stem → DLT template id. Transactional SMS in India sends the
   * *registered* text, not ours, so this mapping is the contract between our
   * wording and the operator's. See docs/notifications.md.
   */
  MSG91_TEMPLATE_MAP: z.string().min(2).optional(),

  /** WhatsApp Cloud API. Required only when `NOTIFY_WHATSAPP_TRANSPORT=whatsapp_cloud`. */
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1).optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1).optional(),
  WHATSAPP_API_VERSION: z.string().min(2).default('v21.0'),
  /** JSON: template stem → the template name registered with Meta, in both locales. */
  WHATSAPP_TEMPLATE_MAP: z.string().min(2).optional(),

  /**
   * Quiet hours, in IST. Standard-class messages caught inside the window are
   * **held and released** at `QUIET_HOURS_END_IST`, never dropped. Setting both
   * to the same hour turns the feature off.
   */
  QUIET_HOURS_START_IST: z.coerce.number().int().min(0).max(23).default(22),
  QUIET_HOURS_END_IST: z.coerce.number().int().min(0).max(23).default(7),

  /** External send attempts before a delivery is parked for ops. */
  NOTIFY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  /** How often held messages are checked for release. */
  NOTIFY_RELEASE_JOB_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(3_600_000)
    .default(5 * 60_000),
  /** Inbox page size ceiling. */
  NOTIFICATION_PAGE_SIZE: z.coerce.number().int().min(1).max(100).default(20),

  /* ---- admin console ---- */

  /**
   * Where the ops console is served from, and the only origin allowed to call
   * `/api/v1/admin` from a browser.
   *
   * A convenience, not a security boundary — CORS is enforced by the browser and
   * anybody with curl ignores it entirely. The real guard is the `ops`/`admin`
   * role check on every admin route, which is applied once at the top of each
   * router so a new endpoint cannot miss it.
   */
  ADMIN_ORIGIN: z.string().min(1).default('http://localhost:5173'),

  /**
   * The customer/partner web app's origin.
   *
   * Same reasoning and the same non-guarantee as `ADMIN_ORIGIN` above: CORS is a
   * browser convenience, not a security boundary. It matters more here only
   * because this origin talks to nearly every endpoint rather than to one
   * router.
   */
  WEB_ORIGIN: z.string().min(1).default('http://localhost:3000'),

  /* ---- app releases (sideloaded APKs) ---- */

  /**
   * The newest build of each app, and the oldest one still allowed to talk to
   * this API.
   *
   * These live in config rather than the database because a release is a
   * deploy-time fact, not a business record: the APK is published alongside
   * the API that understands it, and coupling the two to one env change is
   * what stops a forced-update flag from drifting away from the binary it
   * refers to.
   *
   * `MIN` is the blunt instrument. Raising it locks every older install out of
   * the app until they update, so it exists for the case where an old client
   * would misread a response badly enough to be dangerous — a changed money
   * field, a removed status — and not for ordinary releases.
   *
   * Versions are `major.minor.patch`, matching `pubspec.yaml`.
   */
  APP_CUSTOMER_LATEST_VERSION: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .default('0.1.0'),
  APP_CUSTOMER_MIN_VERSION: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .default('0.1.0'),
  APP_PARTNER_LATEST_VERSION: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .default('0.1.0'),
  APP_PARTNER_MIN_VERSION: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .default('0.1.0'),

  /** Where the APK actually lives. Served from the marketing site, not here. */
  APP_CUSTOMER_DOWNLOAD_URL: z.string().min(1).default('http://localhost:3000/download'),
  APP_PARTNER_DOWNLOAD_URL: z.string().min(1).default('http://localhost:3000/download'),
});

/**
 * Cross-field rules. These are schema-level, not runtime `if` statements, so a
 * production process holding a dangerous combination cannot start at all.
 */
export const configSchema = baseConfigSchema.superRefine((config, ctx) => {
  /**
   * Development conveniences must not reach production.
   *
   * The local `.env` deliberately loosens the OTP limits — 100 requests per
   * phone instead of 5 — so a test run is not throttled halfway through. That
   * is fine on a laptop and dangerous in production, where the same numbers
   * would leave OTP verification effectively unthrottled against brute force.
   *
   * A QA pass flagged this as something to "remember to check before launch".
   * A thing you have to remember is a thing you eventually forget, so the boot
   * refuses instead: a production process cannot start with limits this loose.
   */
  if (config.NODE_ENV === 'production') {
    const ceilings = [
      ['OTP_MAX_PER_PHONE', config.OTP_MAX_PER_PHONE, 10],
      ['OTP_MAX_PER_IP', config.OTP_MAX_PER_IP, 30],
      ['OTP_MAX_VERIFY_ATTEMPTS', config.OTP_MAX_VERIFY_ATTEMPTS, 10],
    ] as const;

    for (const [field, value, ceiling] of ceilings) {
      if (value > ceiling) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message:
            `is ${value} in production, which is above the safe ceiling of ${ceiling}. ` +
            'This looks like a development override — brute-force protection depends on it.',
        });
      }
    }
  }

  /**
   * Razorpay needs all three keys or none.
   *
   * Checked in every environment, not just production: a half-configured gateway
   * fails at the first signature check, which is the worst moment to find out —
   * a customer has already paid by then.
   */
  /**
   * WhatsApp delivery needs its credentials, or it will fail at the first
   * sign-in attempt rather than at boot — which is exactly the wrong moment to
   * discover a missing token.
   */
  if (config.AUTH_OTP_TRANSPORT === 'mbg') {
    const required = [
      ['MBG_ACCESS_TOKEN', config.MBG_ACCESS_TOKEN],
      ['MBG_OTP_FLOW_ID', config.MBG_OTP_FLOW_ID],
    ] as const;

    for (const [field, value] of required) {
      if (value === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: 'is required when AUTH_OTP_TRANSPORT=mbg',
        });
      }
    }
  }

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

  /**
   * A selected vendor needs its credentials, in every environment.
   *
   * Same reasoning as the gateway: a half-configured transport fails at the first
   * real send, and the first real send is somebody's suspension notice.
   */
  if (config.NOTIFY_SMS_TRANSPORT === 'msg91') {
    for (const [field, value] of [
      ['MSG91_AUTH_KEY', config.MSG91_AUTH_KEY],
      ['MSG91_SENDER_ID', config.MSG91_SENDER_ID],
      ['MSG91_TEMPLATE_MAP', config.MSG91_TEMPLATE_MAP],
    ] as const) {
      if (value === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: 'is required when NOTIFY_SMS_TRANSPORT=msg91',
        });
      }
    }
  }

  if (config.NOTIFY_WHATSAPP_TRANSPORT === 'whatsapp_cloud') {
    for (const [field, value] of [
      ['WHATSAPP_PHONE_NUMBER_ID', config.WHATSAPP_PHONE_NUMBER_ID],
      ['WHATSAPP_ACCESS_TOKEN', config.WHATSAPP_ACCESS_TOKEN],
      ['WHATSAPP_TEMPLATE_MAP', config.WHATSAPP_TEMPLATE_MAP],
    ] as const) {
      if (value === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: 'is required when NOTIFY_WHATSAPP_TRANSPORT=whatsapp_cloud',
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

  /**
   * Production may not pretend to send.
   *
   * `fake` records the message in memory and reports success, which in
   * production would mean every suspension notice and every cash-recorded alert
   * vanishing while every dashboard stayed green. Worse than an outage, because
   * an outage is visible.
   */
  for (const field of ['NOTIFY_WHATSAPP_TRANSPORT', 'NOTIFY_SMS_TRANSPORT'] as const) {
    if (config[field] === 'fake') {
      ctx.addIssue({
        code: 'custom',
        path: [field],
        message: 'must not be "fake" when NODE_ENV=production — messages would be silently dropped',
      });
    }
  }

  if (config.AUTH_FIXED_OTP !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['AUTH_FIXED_OTP'],
      message: 'must not be set when NODE_ENV=production — it would bypass OTP verification',
    });
  }

  /**
   * A seeded staff password is a known password. In production that is a
   * published credential for the accounts that can move money, so the process
   * refuses to start holding one — the same structural guard as the fixed OTP
   * rather than a runtime check somebody can forget.
   */
  if (config.SEED_STAFF_PASSWORD !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['SEED_STAFF_PASSWORD'],
      message:
        'must not be set when NODE_ENV=production — it would seed a known password on staff accounts',
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
