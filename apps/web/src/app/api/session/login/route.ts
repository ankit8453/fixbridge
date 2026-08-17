import { NextResponse, type NextRequest } from 'next/server';
import type { AuthSession } from '@fixbridge/shared';
import { REFRESH_COOKIE_NAME, refreshCookieOptions } from '@/lib/auth/cookie';
import { callApi, errorEnvelope, secondsUntil, stripRefreshToken } from '../_shared';

/**
 * Proxies `POST /api/v1/auth/otp/verify`.
 *
 * This is the only place the refresh token the API issues is allowed to
 * exist outside the API itself — it goes straight into an httpOnly cookie
 * and is stripped from the JSON body before it goes anywhere near the
 * response `page.tsx` code will read. See apps/web/README.md for the full
 * flow and why the cookie can't just be set from the browser after an
 * ordinary `fetch` to the API (the API doesn't know this origin's cookie jar
 * exists, and CORS forbids a cross-origin response from setting one anyway).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json(errorEnvelope('BAD_REQUEST', 'Malformed request body.'), {
      status: 400,
    });
  }

  const acceptLanguage = request.headers.get('accept-language') ?? 'hi';
  const upstream = await callApi('/api/v1/auth/otp/verify', body, acceptLanguage);
  const payload: unknown = await upstream.json().catch(() => null);

  if (!upstream.ok || !payload) {
    return NextResponse.json(
      payload ?? errorEnvelope('UPSTREAM_ERROR', 'The API did not return a usable response.'),
      { status: upstream.status || 502 },
    );
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
