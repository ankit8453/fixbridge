import { QueryClient } from '@tanstack/react-query';
import { getClientLocale } from '../i18n/locale-client';
import type { Locale } from '../i18n/config';
import { API_BASE_URL } from './env';
import { ApiError, networkError, parseErrorResponse } from './api-error';
import { getAccessToken, refreshAccessToken } from './auth/session';

/**
 * The one place this app talks to the API for already-authenticated reads
 * and writes.
 *
 * Token *issuance* — login, refresh, logout, the admin two-step — deliberately
 * does NOT go through here; that lives in `auth/session.ts`, which talks to
 * the API's unauthenticated auth endpoints directly (there is no local proxy
 * layer in this SPA — see that module's own comment on the refresh-token
 * storage trade-off). Everything else — search, bookings, quotations, the
 * wallet, whatever a future surface needs — goes through `apiRequest` below,
 * which attaches the in-memory access token and handles a single silent
 * refresh on `401` before giving up.
 */

export { ApiError };
export type { ApiErrorDetail } from './api-error';

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  query?: Record<string, QueryValue>;
  body?: unknown;
  /**
   * Set for calls that must never trigger the refresh dance. In practice
   * this is almost never needed from a page: the truly unauthenticated auth
   * calls (`otp/request`, login, refresh) live in `auth/session.ts` instead.
   * It exists for a genuinely public `GET` (e.g. a marketing-page stat) made
   * while signed out, where a stray `401` should just mean "no data", not
   * kick off a refresh attempt against a session that was never there.
   */
  skipAuth?: boolean;
  /** Overrides the detected locale for this one request. Rarely needed. */
  locale?: Locale;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(path, API_BASE_URL);

  for (const [key, value] of Object.entries(query ?? {})) {
    // Undefined/null/empty means "filter not applied" to a caller. Sending
    // `status=` would be a 400 from the API's strict schemas instead of an
    // unfiltered list, which is a worse failure for a page to hit.
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

async function send(
  path: string,
  options: RequestOptions,
  token: string | null,
): Promise<Response> {
  try {
    return await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': options.locale ?? getClientLocale(),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw networkError(API_BASE_URL);
  }
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await send(path, options, options.skipAuth ? null : getAccessToken());

  /**
   * The invisible refresh.
   *
   * Only `AUTH_TOKEN_EXPIRED` is retried, and only once. `AUTH_TOKEN_INVALID`
   * / `AUTH_SESSION_REVOKED` mean the token is not merely stale — retrying
   * those would loop against a server that has already decided, and a
   * refused login should surface immediately rather than after a pointless
   * round trip.
   */
  if (response.status === 401 && !options.skipAuth) {
    const error = await parseErrorResponse(response.clone());

    if (error.code === 'AUTH_TOKEN_EXPIRED') {
      const refreshed = await refreshAccessToken();
      if (!refreshed) throw error;

      response = await send(path, options, getAccessToken());
    } else {
      throw error;
    }
  }

  if (!response.ok) throw await parseErrorResponse(response);

  // No endpoint returns 204 today, but a mutation that grows one later should
  // not start throwing a JSON-parse error at every screen that calls it.
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

/* -------------------------------------------------------------------------- */
/* Pagination                                                                  */
/* -------------------------------------------------------------------------- */

export type PaginationSpelling = 'page_size' | 'pageSize';

/**
 * The API's pagination query params, in the one place their spelling forks.
 *
 * Every paginated endpoint takes `page` + `page_size` EXCEPT the Phase 4
 * verification queue (`GET /admin/verification/queue`), which takes
 * `pageSize` — camelCase, no underscore (see
 * apps/api/src/modules/verification/types.ts). Rather than make every call
 * site remember which one endpoint is the exception, this defaults to the
 * common spelling; the one caller that needs the other passes
 * `spelling: 'pageSize'` explicitly, so the quirk is visible exactly once, at
 * the one call site it actually affects.
 */
export function paginationParams(
  page: number,
  pageSize: number,
  spelling: PaginationSpelling = 'page_size',
): Record<string, QueryValue> {
  return spelling === 'pageSize' ? { page, pageSize } : { page, page_size: pageSize };
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Normalises a paginated response body into one shape — regardless of which
 * key holds the rows (`results`, `cases`, `providers`, `bookings`, ...) or
 * which of the two spellings above the response echoes back for the page
 * size. Falls back to whichever property in the body is an array, so an
 * endpoint this file has not been taught about yet still renders a list
 * instead of a silently empty one.
 */
export function parsePage<T>(body: unknown, itemsKey: string): Page<T> {
  const record = (body ?? {}) as Record<string, unknown>;

  const named = record[itemsKey];
  const items = Array.isArray(named)
    ? named
    : (Object.values(record).find((value) => Array.isArray(value)) ?? []);

  const pageSize =
    typeof record.pageSize === 'number'
      ? record.pageSize
      : typeof record.page_size === 'number'
        ? record.page_size
        : (items as T[]).length;

  return {
    items: items as T[],
    page: typeof record.page === 'number' ? record.page : 1,
    pageSize,
    total: typeof record.total === 'number' ? record.total : (items as T[]).length,
  };
}

/* -------------------------------------------------------------------------- */
/* TanStack Query                                                             */
/* -------------------------------------------------------------------------- */

/**
 * One `QueryClient` factory, shared by the real app (mounted once in
 * `main.tsx`) and tests (which want a fresh one per test with retries off —
 * see `src/test/harness.tsx`).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        refetchOnWindowFocus: false, // mobile-first: no desktop-window-focus habit to serve
        retry: (failureCount, error) => {
          // A 4xx is an answer, not a hiccup — retrying a 403 three times
          // only makes the error state take three times as long to appear,
          // which matters more on a slow connection, not less.
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}
