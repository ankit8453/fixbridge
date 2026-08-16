/**
 * The one place this console talks to the API.
 *
 * Three things live here and nowhere else: where the access token is kept, how a
 * `401` becomes a silent retry, and how the API's error envelope becomes
 * something a screen can render.
 *
 * **The access token never touches storage.** It lives in a module variable and
 * dies with the tab. An ops console holds the credential that can suspend a
 * technician and move money; putting that string in `localStorage` hands it to
 * any script that ever gets injected into this origin. The refresh token does go
 * to `localStorage` — it is single-use, device-bound and its reuse is treated as
 * theft by the API (see docs/API.md `/auth/refresh`), so the trade is worth it
 * for surviving a page reload.
 */

export const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

const REFRESH_TOKEN_KEY = 'fixbridge.admin.refreshToken';
const DEVICE_ID_KEY = 'fixbridge.admin.deviceId';

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

export interface ApiErrorDetail {
  field?: string;
  message?: string;
  code?: string;
}

/**
 * The API's error envelope, as an exception.
 *
 * `requestId` is carried all the way to the screen on purpose: every error state
 * in this console prints it, because "it failed" is not a bug report and the
 * request id is the only thing that finds the server-side log.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly details: ApiErrorDetail[] | Record<string, unknown> | null;

  constructor(
    status: number,
    code: string,
    message: string,
    requestId: string | null,
    details: ApiErrorDetail[] | Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }

  /** Field-level validation messages, when the failure was a `VALIDATION_ERROR`. */
  get fieldErrors(): ApiErrorDetail[] {
    return Array.isArray(this.details) ? this.details : [];
  }
}

/** A network failure is not an API failure; it deserves its own honest message. */
const networkError = (): ApiError =>
  new ApiError(
    0,
    'NETWORK_UNREACHABLE',
    `Could not reach the API at ${API_BASE_URL}. Check that it is running.`,
    null,
  );

/* -------------------------------------------------------------------------- */
/* Session state                                                              */
/* -------------------------------------------------------------------------- */

let accessToken: string | null = null;
let sessionLostHandler: () => void = () => {};

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getRefreshToken(): string | null {
  return window.localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setRefreshToken(token: string | null): void {
  if (token === null) window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  else window.localStorage.setItem(REFRESH_TOKEN_KEY, token);
}

/**
 * A stable per-browser device id.
 *
 * Refresh tokens are bound to a device by the API, so this must survive reloads
 * or every reload would look like a stolen token being replayed from elsewhere.
 */
export function getDeviceId(): string {
  const existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;

  const fresh = `admin-console-${crypto.randomUUID()}`;
  window.localStorage.setItem(DEVICE_ID_KEY, fresh);
  return fresh;
}

/** The auth provider registers here so a dead session logs the console out. */
export function onSessionLost(handler: () => void): void {
  sessionLostHandler = handler;
}

export function clearSession(): void {
  accessToken = null;
  setRefreshToken(null);
}

/* -------------------------------------------------------------------------- */
/* Requests                                                                   */
/* -------------------------------------------------------------------------- */

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** Set for `/auth/*` calls, which must never trigger the refresh dance. */
  skipAuth?: boolean;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(path, API_BASE_URL);

  for (const [key, value] of Object.entries(query ?? {})) {
    // Undefined and empty are "filter not applied". Sending `status=` would be a
    // 400 from the API's strict schemas rather than an unfiltered list.
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

async function readError(response: Response): Promise<ApiError> {
  const requestId = response.headers.get('X-Request-Id');

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // A non-JSON error body means something in front of the API answered — a
    // proxy, or nothing at all. Fall through to the generic message.
  }

  const envelope = (body as { error?: Record<string, unknown> } | null)?.error;

  if (envelope && typeof envelope.code === 'string') {
    return new ApiError(
      response.status,
      envelope.code,
      typeof envelope.message === 'string' ? envelope.message : response.statusText,
      typeof envelope.requestId === 'string' ? envelope.requestId : requestId,
      (envelope.details as ApiErrorDetail[] | Record<string, unknown> | undefined) ?? null,
    );
  }

  return new ApiError(
    response.status,
    'UNEXPECTED_RESPONSE',
    `The API answered ${response.status} without an error envelope.`,
    requestId,
  );
}

/**
 * Rotates the refresh token, at most once concurrently.
 *
 * The single in-flight promise is not an optimisation. Refresh tokens are
 * single-use and reuse is treated as theft, so two screens whose queries expire
 * in the same tick must not both present the same token — that would revoke
 * every session for this device and sign the ops user out mid-decision.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;

    try {
      const response = await fetch(buildUrl('/api/v1/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': 'en' },
        body: JSON.stringify({ refreshToken, deviceId: getDeviceId() }),
      });

      if (!response.ok) return false;

      const session = (await response.json()) as { accessToken?: string; refreshToken?: string };
      if (!session.accessToken || !session.refreshToken) return false;

      accessToken = session.accessToken;
      setRefreshToken(session.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
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
        // English only: this is an internal tool staffed by our own team. If ops
        // hiring ever makes Hindi the working language of the room, this header
        // and a translation layer are the change — not a rewrite.
        'Accept-Language': 'en',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw networkError();
  }
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await send(path, options, options.skipAuth ? null : accessToken);

  /**
   * The invisible refresh.
   *
   * Only `AUTH_TOKEN_EXPIRED` is retried, and only once. `AUTH_TOKEN_INVALID`
   * and `AUTH_SESSION_REVOKED` mean the token is not merely stale — retrying
   * those would loop against a server that has already decided.
   */
  if (response.status === 401 && !options.skipAuth) {
    const error = await readError(response.clone());

    if (error.code === 'AUTH_TOKEN_EXPIRED') {
      const refreshed = await refreshAccessToken();

      if (!refreshed) {
        clearSession();
        sessionLostHandler();
        throw error;
      }

      response = await send(path, options, accessToken);
    } else {
      clearSession();
      sessionLostHandler();
      throw error;
    }
  }

  if (!response.ok) throw await readError(response);

  // `204` is not used by this API today, but a mutation that grows one later
  // should not start throwing a JSON parse error at ops.
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

/* -------------------------------------------------------------------------- */
/* Pagination                                                                 */
/* -------------------------------------------------------------------------- */

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Normalises `{ <items>, page, pageSize, total }` into one shape.
 *
 * The item key differs per endpoint — `cases`, `providers`, `complaints`,
 * `events` — and several of the newest ones are not in docs/API.md yet. Rather
 * than hardcode a guess per endpoint and render a blank table when it is wrong,
 * this takes the expected key and falls back to whichever property is an array.
 * A console that silently shows an empty queue is worse than one that is
 * slightly clever about finding the rows.
 */
export function toPage<T>(body: unknown, itemsKey: string): Page<T> {
  const record = (body ?? {}) as Record<string, unknown>;

  const named = record[itemsKey];
  const items = Array.isArray(named)
    ? named
    : (Object.values(record).find((value) => Array.isArray(value)) ?? []);

  return {
    items: items as T[],
    page: typeof record.page === 'number' ? record.page : 1,
    pageSize: typeof record.pageSize === 'number' ? record.pageSize : (items as T[]).length,
    total: typeof record.total === 'number' ? record.total : (items as T[]).length,
  };
}
