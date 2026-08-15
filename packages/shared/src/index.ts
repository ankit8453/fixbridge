/**
 * Shared types and constants.
 *
 * Kept deliberately small in Phase 1. Domain DTOs (provider, booking, quotation, …)
 * arrive with the phases that own them.
 */

/* -------------------------------------------------------------------------- */
/* Application identity                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Fallback application name.
 *
 * The brand name is NOT decided. Nothing may hardcode a brand anywhere —
 * read the effective name from the `APP_NAME` env var / typed config instead.
 * This constant only exists so the config loader has a default.
 */
export const DEFAULT_APP_NAME = 'fixbridge';

/** The effective, runtime-configured application name (from `APP_NAME`). */
export type AppName = string;

/* -------------------------------------------------------------------------- */
/* Localisation                                                               */
/* -------------------------------------------------------------------------- */

/** Locales the product ships with from day one. */
export const SUPPORTED_LOCALES = ['hi', 'en'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Hindi first — launch city is Jabalpur, M.P. */
export const DEFAULT_LOCALE: Locale = 'hi';

/* -------------------------------------------------------------------------- */
/* Money                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Money is ALWAYS an integer number of paise. Never floats, never rupees.
 * 1 rupee = 100 paise.
 */
export type Paise = number;

export const PAISE_PER_RUPEE = 100;

export interface Money {
  amountPaise: Paise;
  currency: 'INR';
}

/* -------------------------------------------------------------------------- */
/* Transport-level shapes                                                     */
/* -------------------------------------------------------------------------- */

/** ISO-8601 timestamp string, e.g. `2026-08-15T10:30:00.000Z`. */
export type IsoTimestamp = string;

/** A single field-level validation failure. */
export interface ApiFieldError {
  field: string;
  message: string;
  code: string;
}

/** The one and only error envelope every endpoint returns. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
    stack?: string;
  };
}

export type CheckStatus = 'ok' | 'fail';

export interface HealthResponse {
  status: 'ok' | 'degraded';
  app: AppName;
  version: string;
  /** Process uptime in seconds. */
  uptime: number;
  checks: {
    postgres: CheckStatus;
    redis: CheckStatus;
  };
  /** Localised human-readable summary (Accept-Language aware). */
  message: string;
}

/* -------------------------------------------------------------------------- */
/* Geography                                                                  */
/* -------------------------------------------------------------------------- */

/** Every city-scoped table carries `city_id` from day one (multi-city ready). */
export type CityId = number;

export interface City {
  id: CityId;
  name: string;
  state: string;
  isActive: boolean;
  createdAt: IsoTimestamp;
}
