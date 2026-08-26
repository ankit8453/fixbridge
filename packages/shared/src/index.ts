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
/* Identity                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Roles a user can hold. One user may hold several — a technician is very often
 * also a customer — so these are modelled as a set, never a single column.
 *
 * Must stay in lockstep with the `role` enum in `apps/api/prisma/schema.prisma`;
 * a compile-time assertion in the API enforces that.
 */
export const ROLES = ['customer', 'technician', 'ops', 'admin'] as const;

export type Role = (typeof ROLES)[number];

/** The role every brand-new account is created with. */
export const DEFAULT_ROLE: Role = 'customer';

export const USER_STATUSES = ['active', 'blocked'] as const;

export type UserStatus = (typeof USER_STATUSES)[number];

/** What the access token carries and what `req.user` exposes to handlers. */
export interface AuthenticatedUser {
  id: string;
  roles: Role[];
  deviceId: string;
  /**
   * True when this session belongs to an `admin_users` staff account rather
   * than a `users` row. The two tables share nothing but a uuid shape, so
   * anything that stores the actor (the audit log above all) must know which
   * one the id points into.
   */
  staff?: boolean;
}

/** A user as returned to a client — the phone is always masked. */
export interface AuthUser {
  id: string;
  /** Masked, e.g. `+9198765*****`. The full number never leaves the server. */
  phone: string;
  name: string | null;
  roles: Role[];
  status: UserStatus;
  defaultCityId: CityId | null;
  /**
   * The language every asynchronous message to this person renders in.
   *
   * Separate from `Accept-Language`, which only governs the response to a live
   * request. A WhatsApp composed by a background job three hours later has no
   * header to read, and guessing wrong means a Jabalpur mistri gets their
   * suspension explained in English.
   */
  preferredLanguage: Locale;
  createdAt: IsoTimestamp;
}

/** Issued by OTP verification and by refresh. */
export interface AuthTokens {
  tokenType: 'Bearer';
  accessToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
  /** Opaque random string — not a JWT. Only its hash is stored server-side. */
  refreshToken: string;
  refreshExpiresAt: IsoTimestamp;
}

export interface AuthSession extends AuthTokens {
  user: AuthUser;
}

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
