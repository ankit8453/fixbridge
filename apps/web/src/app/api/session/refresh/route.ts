import { NextResponse, type NextRequest } from 'next/server';
import type { AuthSession } from '@fixbridge/shared';
import {
  expiredRefreshCookieOptions,
  REFRESH_COOKIE_NAME,
  refreshCookieOptions,
} from '@/lib/auth/cookie';
import { callApi, errorEnvelope, secondsUntil, stripRefreshToken } from '../_shared';

/**
 * Proxies `POST /api/v1/auth/refresh`.
 *
 * The refresh token comes from the httpOnly cookie, never from the request
 * body — page JavaScript cannot read it to send it even if it wanted to,
 * which is the entire point of the cookie being httpOnly. Only `deviceId`
 * (not a secret; see `lib/auth/session.ts`) travels in the body from the
 * browser.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const refreshToken = request.cookies.get(REFRESH_COOKIE_NAME)?.value;

  if (!refreshToken) {
    // No cookie means definitely signed out. Answering locally — no call to
    // the API — keeps every anonymous page's boot-time refresh attempt (see
    // AuthProvider) from spending a network round trip to learn what this
    // process already knows.
    return NextResponse.json(errorEnvelope('AUTH_NO_SESSION', 'No session cookie present.'), {
      status: 401,
    });
  }

  const body: unknown = await request.json().catch(() => ({}));
  const deviceId =
    typeof (body as { deviceId?: unknown } | null)?.deviceId === 'string'
      ? (body as { deviceId: string }).deviceId
      : '';

  const acceptLanguage = request.headers.get('accept-language') ?? 'hi';
  const upstream = await callApi(
    '/api/v1/auth/refresh',
    { refreshToken, deviceId },
    acceptLanguage,
  );
  const payload: unknown = await upstream.json().catch(() => null);

  if (!upstream.ok || !payload) {
    // The API refusing a refresh means this specific token is no longer good
    // for anything — replay of an already-rotated token is treated as theft
    // (docs/API.md `/auth/refresh`), an ordinary expiry is just as final.
    // Clearing the cookie here stops every subsequent page load from
    // repeating the same failed exchange until it naturally expires.
    const response = NextResponse.json(
      payload ?? errorEnvelope('UPSTREAM_ERROR', 'The API did not return a usable response.'),
      { status: upstream.status || 502 },
    );
    response.cookies.set(REFRESH_COOKIE_NAME, '', expiredRefreshCookieOptions());
    return response;
  }

  const session = payload as AuthSession;
  const response = NextResponse.json(stripRefreshToken(session));

  response.cookies.set(
    REFRESH_COOKIE_NAME,
    session.refreshToken,
    refreshCookieOptions(secondsUntil(session.refreshExpiresAt)),
  );

  return response;
}
