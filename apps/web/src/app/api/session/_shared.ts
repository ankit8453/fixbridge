import type { AuthSession } from '@fixbridge/shared';
import { API_BASE_URL } from '@/lib/env';

/**
 * Shared by the three route handlers in this folder (`login`, `refresh`,
 * `logout`) so they cannot drift on what a "stripped" session looks like or
 * how an upstream call is shaped. Not a route itself — a leading underscore
 * excludes a folder/file from Next's file-based routing.
 */

export interface StrippedSession {
  accessToken: string;
  expiresIn: number;
  user: AuthSession['user'];
}

/**
 * Strips the refresh token before a session ever reaches page JS. This is
 * the one function every response in this folder that carries a session MUST
 * pass through — see apps/web/README.md's auth section for why.
 */
export function stripRefreshToken(session: AuthSession): StrippedSession {
  return { accessToken: session.accessToken, expiresIn: session.expiresIn, user: session.user };
}

export function errorEnvelope(
  code: string,
  message: string,
): { error: { code: string; message: string; requestId: null } } {
  return { error: { code, message, requestId: null } };
}

export async function callApi(
  path: string,
  body: unknown,
  acceptLanguage: string,
): Promise<Response> {
  return fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept-Language': acceptLanguage },
    body: JSON.stringify(body),
  });
}

/**
 * Seconds from now until `iso`, floored at 0 — sizes the refresh cookie's
 * `Max-Age` from the API's own `refreshExpiresAt` rather than a duplicated
 * constant, so the two can never drift out of sync.
 */
export function secondsUntil(iso: string): number {
  return Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
}
