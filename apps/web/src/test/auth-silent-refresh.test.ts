import { describe, it } from 'vitest';
import { apiRequest, ApiError } from '../lib/api';
import { getAccessToken, login, requestOtp } from '../lib/auth/session';
import { expect, mockApi, sessionBody } from './harness';

/**
 * The classic bug, and the test that catches it.
 *
 * `apiRequest` attaches whatever access token is in memory and, on a
 * `401 AUTH_TOKEN_EXPIRED`, calls `refreshAccessToken()` before retrying
 * once. Several screens can all hold a stale token at once (a tab that sat
 * in the background past the token's 15-minute life, say) — if each of their
 * `401`s triggered its own call to `/api/v1/auth/refresh`, every one after
 * the first would present an already-rotated refresh token, which the API
 * treats as theft and revokes the whole device. `session.ts`'s
 * `refreshAccessToken` shares one in-flight promise for exactly this reason;
 * this test proves three concurrent callers produce exactly one refresh.
 *
 * Each test logs in first (against the mocked verify endpoint) so a refresh
 * token actually exists in `localStorage` before the 401s fire — the new SPA
 * design (see `lib/auth/session.ts`'s own comment on why the refresh token
 * moved out of an httpOnly cookie) only ever attempts a network refresh when
 * one is present.
 */
describe('silent refresh — single-flight', () => {
  it('refreshes exactly once for three concurrent 401s, and all three retries succeed', async () => {
    const api = mockApi({
      'POST /api/v1/auth/otp/verify': { status: 200, body: sessionBody() },
      'GET /api/v1/protected': (call) => {
        if (call.headers.authorization === 'Bearer new-access-token') {
          return { status: 200, body: { ok: true } };
        }
        return {
          status: 401,
          body: {
            error: { code: 'AUTH_TOKEN_EXPIRED', message: 'Token expired', requestId: 'r1' },
          },
        };
      },
      // A deliberate delay: it stands in for a real network round trip
      // (milliseconds in production, but not nothing) so this test actually
      // exercises overlap — three near-instant mocked 401s must all reach
      // `refreshAccessToken()` while the first refresh is still pending, the
      // same as three real requests failing within the same instant would.
      // Without the delay, an all-mocked round trip can resolve faster than
      // the other two callers even get to the call, which would make three
      // *sequential* refreshes look identical to one shared one.
      'POST /api/v1/auth/refresh': async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { status: 200, body: sessionBody({ accessToken: 'new-access-token' }) };
      },
    });

    await login('+919876543210', '000000');

    const results = await Promise.all([
      apiRequest('/api/v1/protected'),
      apiRequest('/api/v1/protected'),
      apiRequest('/api/v1/protected'),
    ]);

    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    // The whole point: not three refresh calls, one.
    expect(api.callCount('POST /api/v1/auth/refresh')).toBe(1);
    // Six protected-endpoint calls (three that hit the stale token, three
    // retries) is the expected cost of not coordinating retries either —
    // this asserts the retry actually happened for every caller, not just
    // the one that triggered the refresh.
    expect(api.callCount('GET /api/v1/protected')).toBe(6);
    expect(getAccessToken()).toBe('new-access-token');
  });

  it('does not attempt a refresh for a non-expiry 401 (AUTH_TOKEN_INVALID)', async () => {
    const api = mockApi({
      'POST /api/v1/auth/otp/verify': { status: 200, body: sessionBody() },
      'GET /api/v1/protected': {
        status: 401,
        body: { error: { code: 'AUTH_TOKEN_INVALID', message: 'Bad token', requestId: 'r2' } },
      },
    });

    await login('+919876543210', '000000');

    await expect(apiRequest('/api/v1/protected')).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });

    // A token the API has already decided is invalid must never be retried —
    // retrying it would just loop against a server that has already refused.
    expect(api.callCount('POST /api/v1/auth/refresh')).toBe(0);
  });

  it('surfaces the original error if the shared refresh itself fails', async () => {
    const api = mockApi({
      'POST /api/v1/auth/otp/verify': { status: 200, body: sessionBody() },
      'GET /api/v1/protected': {
        status: 401,
        body: { error: { code: 'AUTH_TOKEN_EXPIRED', message: 'Token expired', requestId: 'r3' } },
      },
      'POST /api/v1/auth/refresh': {
        status: 401,
        body: {
          error: { code: 'AUTH_SESSION_REVOKED', message: 'Session revoked.', requestId: null },
        },
      },
    });

    await login('+919876543210', '000000');

    await expect(apiRequest('/api/v1/protected')).rejects.toBeInstanceOf(ApiError);
    expect(api.callCount('POST /api/v1/auth/refresh')).toBe(1);
    expect(getAccessToken()).toBeNull();
  });
});

describe('login and OTP request', () => {
  it('requestOtp calls the API directly, unauthenticated', async () => {
    const api = mockApi({
      'POST /api/v1/auth/otp/request': {
        status: 200,
        body: { phone: '+9198765*****', expiresInSeconds: 300 },
      },
    });

    const result = await requestOtp('+919876543210');

    expect(result.expiresInSeconds).toBe(300);
    expect(api.lastCall('POST /api/v1/auth/otp/request')?.body).toEqual({ phone: '+919876543210' });
  });

  it('login adopts the access token the verify endpoint returns, and strips the refresh token from what it hands back', async () => {
    mockApi({ 'POST /api/v1/auth/otp/verify': { status: 200, body: sessionBody() } });

    expect(getAccessToken()).toBeNull();

    const session = await login('+919876543210', '000000');

    expect(session.accessToken).toBe('access-token-1');
    expect(getAccessToken()).toBe('access-token-1');
    // `ClientSession` (what callers hold) never carries the refresh token —
    // it is written straight to storage by `adopt()` and never handed back,
    // so it cannot end up in a variable some other code accidentally logs.
    expect(session).not.toHaveProperty('refreshToken');
  });
});
