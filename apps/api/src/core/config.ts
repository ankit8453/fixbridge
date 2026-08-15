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

export const configSchema = z.object({
  /** The brand name is not decided — this is the single source of truth for it. */
  APP_NAME: z.string().min(1).default(DEFAULT_APP_NAME),
  NODE_ENV: z.enum(NODE_ENVS).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  DATABASE_URL: urlWithProtocols(['postgres:', 'postgresql:'], 'PostgreSQL'),
  REDIS_URL: urlWithProtocols(['redis:', 'rediss:'], 'Redis'),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(0).max(120_000).default(10_000),
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
