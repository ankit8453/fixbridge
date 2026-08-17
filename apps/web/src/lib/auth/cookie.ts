/**
 * The refresh-token cookie's name and flags, in one place so the three route
 * handlers that touch it (`login`, `refresh`, `logout`) and the server-side
 * guard helper that only checks for its presence cannot disagree on what it
 * is called or how it is set.
 */
export const REFRESH_COOKIE_NAME = 'fixbridge_refresh';

/**
 * `Secure` is conditional on `NODE_ENV === 'production'` rather than always
 * on. Local development serves this app over plain `http://localhost:3000` —
 * a browser silently refuses to store a `Secure` cookie set over `http`, so
 * "always secure" would mean the refresh cookie simply never gets set in dev
 * and every reload looks like a fresh, logged-out session. Production always
 * serves over `https`, so the cost of this conditional is zero there.
 */
export function refreshCookieOptions(maxAgeSeconds: number): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
} {
  return {
    // The whole point: page JavaScript must never be able to read this value
    // (XSS containment). Only these route handlers, running on the server,
    // ever see it.
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // Lax, not Strict: a customer who follows a WhatsApp-forwarded booking
    // link (a top-level navigation from outside the app) must arrive already
    // recognised if they have a session, or every shared link becomes a
    // surprise re-login. Lax still withholds the cookie on cross-site
    // subrequests (images, fetches from other origins), which is the actual
    // CSRF-relevant case.
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

/** Clears the cookie — `logout`, and any refresh failure that ends the session. */
export function expiredRefreshCookieOptions(): ReturnType<typeof refreshCookieOptions> {
  return { ...refreshCookieOptions(0), maxAge: 0 };
}
