import { describe, expect, it, vi } from 'vitest';
import type { AppLogger } from '../../core/logger';
import { createOtpTransport } from './transport';

/**
 * Which transport a deployment gets decides whether it can start at all, and
 * one of the wrong answers leaks login codes into a log file. Worth testing.
 */
function fakeLogger(): AppLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
  } as unknown as AppLogger;
}

describe('createOtpTransport', () => {
  it('refuses the logging transport in production', () => {
    // The one combination that must never boot: it would succeed at printing a
    // login code into the logs, which is worse than failing.
    expect(() => createOtpTransport(fakeLogger(), 'production', 'logger')).toThrow(
      /must never run in production/,
    );
  });

  it('defaults to logging outside production', () => {
    expect(createOtpTransport(fakeLogger(), 'development').name).toBe('logger');
    expect(createOtpTransport(fakeLogger(), 'test').name).toBe('logger');
  });

  it('starts in production when delivery is explicitly disabled', () => {
    // The point of the disabled transport: everything that does not depend on
    // signing in can come up and be verified while messaging is arranged.
    const transport = createOtpTransport(fakeLogger(), 'production', 'disabled');
    expect(transport.name).toBe('disabled');
  });

  it('says so loudly when starting production without sign-in', () => {
    const logger = fakeLogger();
    createOtpTransport(logger, 'production', 'disabled');

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('nobody can sign in'));
  });

  it('fails at send time rather than pretending to deliver', async () => {
    // A transport that resolved silently would leave somebody waiting for a
    // code that was never going to arrive.
    const transport = createOtpTransport(fakeLogger(), 'production', 'disabled');

    await expect(
      transport.send({ phone: '+919999900001', otp: '123456', expiresInSeconds: 300 }),
    ).rejects.toMatchObject({ statusCode: 503, code: 'OTP_DELIVERY_UNAVAILABLE' });
  });

  it('never writes the code when it cannot send it', async () => {
    const logger = fakeLogger();
    const transport = createOtpTransport(logger, 'production', 'disabled');

    await transport
      .send({ phone: '+919999900001', otp: '654321', expiresInSeconds: 300 })
      .catch(() => undefined);

    const logged = JSON.stringify(vi.mocked(logger.error).mock.calls);
    expect(logged).not.toContain('654321');
  });
});
