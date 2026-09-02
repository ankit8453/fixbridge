import { describe, expect, it, vi } from 'vitest';
import type { AppLogger } from '../../core/logger';
import { createMbgOtpTransport, type MbgOtpOptions } from './mbg-otp';

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

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Records what was sent, and answers however the test says to. */
function recordingFetch(responses: Response[] = []) {
  const calls: Call[] = [];

  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });

    return responses.shift() ?? new Response('{}', { status: 200 });
  });

  return { calls, impl: impl as unknown as typeof fetch };
}

function options(over: Partial<MbgOtpOptions> = {}): MbgOtpOptions {
  const { impl } = recordingFetch();

  return {
    baseUrl: 'https://app.example.test/api',
    accessToken: 'test-token',
    flowId: 'flow-123',
    fieldName: 'DATA_BANK_OTP',
    includePlus: false,
    timeoutMs: 5_000,
    logger: fakeLogger(),
    fetchImpl: impl,
    ...over,
  };
}

describe('createMbgOtpTransport', () => {
  it('refuses to build without credentials', () => {
    expect(() => createMbgOtpTransport(options({ accessToken: '' }))).toThrow(/MBG_ACCESS_TOKEN/);
    expect(() => createMbgOtpTransport(options({ flowId: '' }))).toThrow(/MBG_OTP_FLOW_ID/);
  });

  it('makes the three calls in order', async () => {
    const { calls, impl } = recordingFetch();
    const transport = createMbgOtpTransport(options({ fetchImpl: impl }));

    await transport.send({ phone: '+919876543210', otp: '123456', expiresInSeconds: 300 });

    expect(calls).toHaveLength(3);
    // Contact first: MBGCart cannot message a number it has never seen.
    expect(calls[0]!.body).toEqual({ phone: '919876543210' });
    expect(calls[1]!.body).toMatchObject({
      actions: [{ action: 'set_field_value', field_name: 'DATA_BANK_OTP', value: '123456' }],
    });
    // The flow last, so the field it reads is already populated.
    expect(calls[2]!.body).toMatchObject({
      actions: [{ action: 'send_flow', flow_id: 'flow-123' }],
    });
  });

  it('sends the token as a header and never in the body', async () => {
    const { calls, impl } = recordingFetch();
    const transport = createMbgOtpTransport(options({ fetchImpl: impl }));

    await transport.send({ phone: '+919876543210', otp: '123456', expiresInSeconds: 300 });

    for (const call of calls) {
      expect(call.headers['X-ACCESS-TOKEN']).toBe('test-token');
      expect(JSON.stringify(call.body)).not.toContain('test-token');
    }
  });

  it('strips the plus by default and keeps it when asked', async () => {
    // Which format the provider wants cannot be verified from here, so it is a
    // setting — and both sides of it are worth pinning down.
    const stripped = recordingFetch();
    await createMbgOtpTransport(options({ fetchImpl: stripped.impl })).send({
      phone: '+919876543210',
      otp: '1',
      expiresInSeconds: 300,
    });
    expect(stripped.calls[0]!.body).toEqual({ phone: '919876543210' });

    const kept = recordingFetch();
    await createMbgOtpTransport(options({ fetchImpl: kept.impl, includePlus: true })).send({
      phone: '+919876543210',
      otp: '1',
      expiresInSeconds: 300,
    });
    expect(kept.calls[0]!.body).toEqual({ phone: '+919876543210' });
  });

  it('stops at the first failure rather than sending a flow with no code', async () => {
    // If the field write fails, triggering the flow would deliver a message
    // containing whatever the previous code was — or nothing at all.
    const { calls, impl } = recordingFetch([
      new Response('{}', { status: 200 }),
      new Response('nope', { status: 422 }),
    ]);
    const transport = createMbgOtpTransport(options({ fetchImpl: impl }));

    await expect(
      transport.send({ phone: '+919876543210', otp: '123456', expiresInSeconds: 300 }),
    ).rejects.toMatchObject({ statusCode: 502, code: 'OTP_DELIVERY_FAILED' });

    expect(calls).toHaveLength(2);
  });

  it('turns a network failure into a delivery error, not a crash', async () => {
    const impl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    await expect(
      createMbgOtpTransport(options({ fetchImpl: impl })).send({
        phone: '+919876543210',
        otp: '123456',
        expiresInSeconds: 300,
      }),
    ).rejects.toMatchObject({ statusCode: 502 });
  });

  it('never writes the code or the token to the log', async () => {
    const logger = fakeLogger();
    // A provider that echoes the request back would otherwise put the code
    // straight into our error log.
    const { impl } = recordingFetch([
      new Response(JSON.stringify({ echoed: '123456' }), { status: 500 }),
    ]);

    await createMbgOtpTransport(options({ fetchImpl: impl, logger }))
      .send({ phone: '+919876543210', otp: '123456', expiresInSeconds: 300 })
      .catch(() => undefined);

    const written = JSON.stringify([
      vi.mocked(logger.error).mock.calls,
      vi.mocked(logger.info).mock.calls,
    ]);

    expect(written).not.toContain('test-token');
    expect(written).not.toContain('9876543210');
  });
});
