import type { AuthUser } from '@fixbridge/shared';
import { getClientLocale } from '../../i18n/locale-client';
import { API_BASE_URL } from '../env';
import { networkError, parseErrorResponse } from '../api-error';

/**
 * Where the session actually lives, and the single-flight refresh.
 *
 * ## The one forced change from the Next.js version, stated plainly
 *
 * The old app kept the refresh token in an httpOnly cookie, set by a Next.js
 * route handler running on a server — page JavaScript could never read it,
 * full stop. A static SPA has no server of its own to hold that cookie, so
 * this refresh token lives in `localStorage` instead.
 *
 * **This is weaker, not equivalent.** An XSS bug anywhere in this bundle (a
 * badly-escaped name, a compromised dependency) can now read `localStorage`
 * and steal a 30-day credential, not just whatever lives in the current tab's
 * memory. That is the accepted cost of removing the server: there is nowhere
 * left to put an httpOnly cookie. What still holds from the old design:
 *
 *  - **The access token is still a module variable, never persisted.** It
 *    dies with the tab/reload regardless of what happens to the refresh
 *    token, which keeps the *common* case (a stolen access token from a log
 *    line, a browser extension reading page state) to a 15-minute blast
 *    radius rather than 30 days.
 *  - **Single-flight refresh** is unchanged (see `refreshAccessToken` below)
 *    — that guarantee has nothing to do with where the token is stored.
 *
 * If this system ever gets a server component back (a thin BFF, an edge
 * function) reintroducing an httpOnly cookie for the refresh token is the
 * fix, not a `localStorage` hardening trick — there is no amount of
 * obfuscation that makes JS-readable storage equivalent to JS-unreadable
 * storage.
 */

let accessToken: string | null = null;
let sessionLostHandler: () => void = () => {};

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** `api.ts` registers here: a refresh that fails mid-session must be able to tell the UI. */
export function onSessionLost(handler: () => void): void {
  sessionLostHandler = handler;
}

/* -------------------------------------------------------------------------- */
/* Device id                                                                   */
/* -------------------------------------------------------------------------- */

const DEVICE_ID_KEY = 'fixbridge.web.deviceId';
const REFRESH_TOKEN_KEY = 'fixbridge.web.refreshToken';

/**
 * A stable per-browser device id, generated once and kept in `localStorage`.
 *
 * This is NOT a secret and does not need protecting the way the refresh
 * token does — knowing a device id lets nobody do anything; it only lets the
 * API tell "the same browser refreshing its token" apart from "a stolen
 * refresh token replayed from somewhere else" (see docs/API.md
 * `/auth/refresh`). Losing it (cleared storage, different browser) just
 * looks like a new device signing in, not a security hole.
 */
export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'server';

  const existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;

  const fresh = `web-${crypto.randomUUID()}`;
  window.localStorage.setItem(DEVICE_ID_KEY, fresh);
  return fresh;
}

function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(REFRESH_TOKEN_KEY);
}

function setRefreshToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(REFRESH_TOKEN_KEY, token);
  else window.localStorage.removeItem(REFRESH_TOKEN_KEY);
}

/** Clears everything this tab knows about the session — access token, refresh token, both. */
export function clearSession(): void {
  accessToken = null;
  setRefreshToken(null);
}

/* -------------------------------------------------------------------------- */
/* Session-issuing calls                                                      */
/* -------------------------------------------------------------------------- */

/** What every session-issuing call hands back to the rest of the app. */
export interface ClientSession {
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
}

/** The full shape the API's auth endpoints actually return — see docs/API.md. */
interface AuthSessionResponse {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: string;
  user: AuthUser;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Language': getClientLocale() },
      body: JSON.stringify(body),
    });
  } catch {
    throw networkError(API_BASE_URL);
  }

  if (!response.ok) throw await parseErrorResponse(response);
  return (await response.json()) as T;
}

/** Stores the pair, and hands the caller back only what page code needs day to day. */
function adopt(session: AuthSessionResponse): ClientSession {
  setAccessToken(session.accessToken);
  setRefreshToken(session.refreshToken);
  return { accessToken: session.accessToken, expiresIn: session.expiresIn, user: session.user };
}

export async function requestOtp(
  phone: string,
): Promise<{ phone: string; expiresInSeconds: number }> {
  return postJson('/api/v1/auth/otp/request', { phone });
}

export async function login(phone: string, otp: string): Promise<ClientSession> {
  const session = await postJson<AuthSessionResponse>('/api/v1/auth/otp/verify', {
    phone,
    otp,
    deviceId: getDeviceId(),
  });
  return adopt(session);
}

/* -------------------------------------------------------------------------- */
/* The ops console's two-step sign-in                                        */
/* -------------------------------------------------------------------------- */

export interface AdminChallenge {
  challengeId: string;
  /** Masked — display only, same trap as the customer login screen's OTP flow. */
  phone: string;
  expiresInSeconds: number;
}

/** Step one: id + password. Returns a challenge, never a session — see docs/API.md. */
export async function adminPasswordStep(
  loginId: string,
  password: string,
): Promise<AdminChallenge> {
  return postJson('/api/v1/auth/admin/password', { loginId, password });
}

/** Step two: the challenge + the OTP that was sent. Returns the real session. */
export async function adminLogin(challengeId: string, otp: string): Promise<ClientSession> {
  const session = await postJson<AuthSessionResponse>('/api/v1/auth/admin/verify', {
    challengeId,
    otp,
    deviceId: getDeviceId(),
  });
  return adopt(session);
}

/* -------------------------------------------------------------------------- */
/* Logout + refresh                                                          */
/* -------------------------------------------------------------------------- */

export async function logout(): Promise<void> {
  const refreshToken = getRefreshToken();
  clearSession();

  if (!refreshToken) return;

  try {
    // Best-effort revocation. The in-memory/local session is already gone
    // either way — a network failure here must never leave someone stuck
    // signed in on this device.
    await postJson('/api/v1/auth/logout', { refreshToken });
  } catch {
    // Swallowed deliberately, see above.
  }
}

/**
 * Rotates the access token via `/api/v1/auth/refresh`, at most once
 * concurrently.
 *
 * **This is the classic bug.** Several queries can hit a stale access token
 * in the same tick — a token that expired while the tab was in the
 * background, say, with three panels each firing their own request the
 * moment it becomes visible again. Refresh tokens are single-use and
 * rotated on every exchange; if each of those three 401s triggered its own
 * refresh call, the second and third would present a refresh token the first
 * had already rotated away, and the API treats replaying a spent refresh
 * token as theft — it revokes the *entire* device. One shared in-flight
 * promise means concurrent callers all await the same exchange and only one
 * refresh token is ever spent per expiry.
 */
let refreshInFlight: Promise<ClientSession | null> | null = null;

export async function refreshAccessToken(): Promise<ClientSession | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return null;

    try {
      const session = await postJson<AuthSessionResponse>('/api/v1/auth/refresh', {
        refreshToken,
        deviceId: getDeviceId(),
      });
      return adopt(session);
    } catch {
      // Whatever the reason — no stored token, a reused/expired one, the API
      // unreachable — the honest outcome is "not signed in any more".
      clearSession();
      sessionLostHandler();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}
