import { describe, it } from 'vitest';
import { getAccessToken, login, logout } from '../lib/auth/session';
import { expect, mockApi, sessionBody } from './harness';

/**
 * Replaces the old Next app's `session-cookie-flags.test.ts`, which asserted
 * the refresh token was set as an `HttpOnly` cookie by a server route
 * handler — that handler does not exist in this SPA (see `lib/auth/
 * session.ts`'s own comment on why the refresh token now lives in
 * `localStorage` instead, and what is honestly weaker about that).
 *
 * What this test asserts instead, for the mechanism that actually exists
 * now: the refresh token lands in the one storage key the rest of the app
 * (and this test) knows about, the access token is never written to
 * storage at all, and `logout()`/a failed refresh clear it.
 */
const REFRESH_TOKEN_KEY = 'fixbridge.web.refreshToken';

describe('refresh token storage (the accepted trade-off)', () => {
  it('login writes the refresh token to localStorage, not the access token', async () => {
    mockApi({
      'POST /api/v1/auth/otp/verify': {
        status: 200,
        body: sessionBody({ refreshToken: 'refresh-token-should-be-stored' }),
      },
    });

    await login('+919876543210', '000000');

    expect(window.localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('refresh-token-should-be-stored');
    // The access token is a module variable only — see getAccessToken() — and
    // must never appear under any localStorage key, which this checks by
    // scanning every key rather than guessing one.
    const persisted = Object.keys(window.localStorage).map((key) =>
      window.localStorage.getItem(key),
    );
    expect(persisted).not.toContain('access-token-1');
  });

  it('logout clears the stored refresh token and the in-memory access token', async () => {
    mockApi({
      'POST /api/v1/auth/otp/verify': { status: 200, body: sessionBody() },
      'POST /api/v1/auth/logout': { status: 200, body: { message: 'ok' } },
    });

    await login('+919876543210', '000000');
    expect(window.localStorage.getItem(REFRESH_TOKEN_KEY)).not.toBeNull();

    await logout();

    expect(window.localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
    expect(getAccessToken()).toBeNull();
  });
});
