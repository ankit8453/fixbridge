import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../core/context';
import { buildHealthReport } from './service';

function buildContext(overrides: {
  queryRaw?: () => Promise<unknown>;
  ping?: () => Promise<string>;
}): AppContext {
  return {
    config: { APP_NAME: 'configured-name' },
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    version: '9.9.9',
    prisma: { $queryRaw: overrides.queryRaw ?? (() => Promise.resolve([{ '?column?': 1 }])) },
    redis: { ping: overrides.ping ?? (() => Promise.resolve('PONG')) },
  } as unknown as AppContext;
}

describe('buildHealthReport', () => {
  it('reports ok when both dependencies answer', async () => {
    const report = await buildHealthReport(buildContext({}));

    expect(report.status).toBe('ok');
    expect(report.checks).toEqual({ postgres: 'ok', redis: 'ok' });
  });

  it('reads the app name from config rather than a hardcoded brand', async () => {
    const report = await buildHealthReport(buildContext({}));

    expect(report.app).toBe('configured-name');
    expect(report.version).toBe('9.9.9');
    expect(typeof report.uptime).toBe('number');
  });

  it('reports degraded when postgres is down but still answers', async () => {
    const report = await buildHealthReport(
      buildContext({ queryRaw: () => Promise.reject(new Error('ECONNREFUSED')) }),
    );

    expect(report.status).toBe('degraded');
    expect(report.checks).toEqual({ postgres: 'fail', redis: 'ok' });
  });

  it('reports degraded when redis is down', async () => {
    const report = await buildHealthReport(
      buildContext({ ping: () => Promise.reject(new Error('ECONNREFUSED')) }),
    );

    expect(report.status).toBe('degraded');
    expect(report.checks).toEqual({ postgres: 'ok', redis: 'fail' });
  });

  it('treats an unexpected redis reply as a failure', async () => {
    const report = await buildHealthReport(buildContext({ ping: () => Promise.resolve('nope') }));

    expect(report.checks.redis).toBe('fail');
  });

  it('never throws — a failing dependency must still produce a report', async () => {
    const report = await buildHealthReport(
      buildContext({
        queryRaw: () => Promise.reject(new Error('boom')),
        ping: () => Promise.reject(new Error('boom')),
      }),
    );

    expect(report.status).toBe('degraded');
    expect(report.checks).toEqual({ postgres: 'fail', redis: 'fail' });
  });
});
