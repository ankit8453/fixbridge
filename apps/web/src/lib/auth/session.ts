import type { AuthUser } from '@fixbridge/shared';
import { getClientLocale } from '../../i18n/locale-client';
import { API_BASE_URL } from '../env';
import { networkError, parseErrorResponse } from '../api-error';

/**
 * Where the session actually lives, and the single-flight refresh.
 *
 * **The access token is a module variable and nothing else.** It is never
 * written to `localStorage`, `sessionStorage` or a non-httpOnly cookie — any
 * of those are readable by an injected script, and this token is what lets a
 * page act as the signed-in user. Living only in memory means it also dies
 * with the tab/reload, which is why `AuthProvider` calls `refreshAccessToken`
 * once on mount: the httpOnly refresh cookie (set only by the route handlers
 * below) is what actually survives a reload.
 */

let accessToken: string | null = null;
let sessionLostHandler: () => void = () => {};

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function clearSession(): void {
  accessToken = null;
}

/** `api.ts` registers here: a refresh that fails mid-session must be able to tell the UI. */
export function onSessionLost(handler: () => void): void {
  sessionLostHandler = handler;
}

/* -------------------------------------------------------------------------- */
/* Device id                                                                   */
/* -------------------------------------------------------------------------- */

const DEVICE_ID_KEY = 'fixbridge.web.deviceId';

/**
 * A stable per-browser device id, generated once and kept in `localStorage`.
 *
 * This is NOT a secret and does not need httpOnly/cookie treatment — knowing
 * a device id lets nobody do anything; it only lets the API tell "the same
 * browser refreshing its token" apart from "a stolen refresh token replayed
 * from somewhere else" (see docs/API.md `/auth/refresh`). Losing it (cleared
 * storage, different browser) just looks like a new device signing in, not a
 * security hole.
 */
export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'server';

  const existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;

  const fresh = `web-${crypto.randomUUID()}`;
  window.localStorage.setItem(DEVICE_ID_KEY, fresh);
  return fresh;
}

/* -------------------------------------------------------------------------- */
/* Session-issuing calls                                                      */
/* -------------------------------------------------------------------------- */

/**
 * What `/api/session/login` and `/api/session/refresh` hand back to page JS.
 * Deliberately has no `refreshToken` field — the route handlers strip it
 * before responding, so there is never a moment where it exists in a variable
 * this bundle's JavaScript could read, log or accidentally serialise.
 */
export interface ClientSession {
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
}

async function postLocal(path: string, body: unknown): Promise<ClientSession> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      // Same-origin default already sends/receives cookies for a same-origin
      // request; explicit for readability, not because the default is unsafe.
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        // The route handler forwards this upstream — see app/api/session/_shared.ts.
        'Accept-Language': getClientLocale(),
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw networkError(path);
  }

  if (!response.ok) throw await parseErrorResponse(response);
  return (await response.json()) as ClientSession;
}

/**
 * `POST /api/v1/auth/otp/request` issues no tokens, so it talks to the
 * external API directly rather than through a route handler — there is
 * nothing here for a proxy to protect.
 */
export async function requestOtp(
  phone: string,
): Promise<{ phone: string; expiresInSeconds: number }> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/v1/auth/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Language': getClientLocale() },
      body: JSON.stringify({ phone }),
    });
  } catch {
    throw networkError(API_BASE_URL);
  }

  if (!response.ok) throw await parseErrorResponse(response);
  return (await response.json()) as { phone: string; expiresInSeconds: number };
}

export async function login(phone: string, otp: string): Promise<ClientSession> {
  const session = await postLocal('/api/session/login', { phone, otp, deviceId: getDeviceId() });
  setAccessToken(session.accessToken);
  return session;
}

export async function logout(): Promise<void> {
  clearSession();
  try {
    // Best-effort revocation. The in-memory session is already gone either
    // way — a network failure here must never leave someone stuck signed in.
    await postLocal('/api/session/logout', {});
  } catch {
    // Swallowed deliberately, see above.
  }
}

/**
 * Rotates the access token via `/api/session/refresh`, at most once
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
    try {
      const session = await postLocal('/api/session/refresh', { deviceId: getDeviceId() });
      setAccessToken(session.accessToken);
      return session;
    } catch {
      // Whatever the reason — no cookie, a reused/expired refresh token, the
      // API unreachable — the honest outcome is "not signed in any more".
      clearSession();
      sessionLostHandler();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}
