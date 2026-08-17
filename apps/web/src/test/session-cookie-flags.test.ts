// @vitest-environment node
//
// Route handlers run server-side; NextRequest/NextResponse assume Node's
// fetch globals (Headers, Request) rather than jsdom's, which shadows them
// differently. See vitest.config.ts for the general rule.

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as login } from '../app/api/session/login/route';
import { REFRESH_COOKIE_NAME } from '../lib/auth/cookie';

/**
 * The one property this whole auth design exists to guarantee: page
 * JavaScript can never read the refresh token, because it never touches a
 * cookie page JavaScript is allowed to read, and it never appears in a
 * response body page JavaScript parses. This file tests both halves of that
 * against the actual route handler — not a description of what it should
 * do, but the real `POST` function apps/web/src/app/api/session/login serves.
 */

const upstreamSession = {
  tokenType: 'Bearer',
  accessToken: 'access-token-1',
  expiresIn: 900,
  refreshToken: 'refresh-token-should-never-leave-this-file',
  refreshExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  user: { id: 'u1', phone: '+9198765*****', roles: ['customer'], status: 'active' },
};

function loginRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/session/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: '+919876543210', otp: '000000', deviceId: 'web-test-device-1' }),
  });
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(upstreamSession), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('refresh cookie flags', () => {
  it('is httpOnly and SameSite=Lax, and NOT Secure in development (plain http)', async () => {
    vi.stubEnv('NODE_ENV', 'development');

    const response = await login(loginRequest());
    const cookie = response.headers
      .getSetCookie()
      .find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));

    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    // Not merely absent — a browser silently drops a Secure cookie set over
    // plain http, so shipping this flag in dev would make login look broken.
    expect(cookie).not.toMatch(/;\s*Secure/i);
  });

  it('is Secure in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const response = await login(loginRequest());
    const cookie = response.headers
      .getSetCookie()
      .find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));

    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it('never puts the refresh token in the JSON response body', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const response = await login(loginRequest());
    const cookie = response.headers
      .getSetCookie()
      .find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
    const body: unknown = await response.json();

    // The cookie carries it (that's the point)...
    expect(cookie).toContain('refresh-token-should-never-leave-this-file');
    // ...but the body page JS receives must not.
    expect(body).not.toHaveProperty('refreshToken');
    expect(JSON.stringify(body)).not.toContain('refresh-token-should-never-leave-this-file');
    expect(body).toMatchObject({ accessToken: 'access-token-1', expiresIn: 900 });
  });
});
