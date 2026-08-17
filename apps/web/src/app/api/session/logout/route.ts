import { NextResponse, type NextRequest } from 'next/server';
import { expiredRefreshCookieOptions, REFRESH_COOKIE_NAME } from '@/lib/auth/cookie';
import { callApi } from '../_shared';

/**
 * Proxies `POST /api/v1/auth/logout`, best-effort.
 *
 * The cookie is cleared regardless of whether the upstream call succeeds — a
 * client that asked to sign out must never remain signed in locally just
 * because the API was briefly unreachable when the request fired.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const refreshToken = request.cookies.get(REFRESH_COOKIE_NAME)?.value;
  const acceptLanguage = request.headers.get('accept-language') ?? 'hi';

  if (refreshToken) {
    try {
      await callApi('/api/v1/auth/logout', { refreshToken }, acceptLanguage);
    } catch {
      // Best-effort — see the module comment above.
    }
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(REFRESH_COOKIE_NAME, '', expiredRefreshCookieOptions());
  return response;
}
