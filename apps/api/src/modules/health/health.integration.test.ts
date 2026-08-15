import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { parseConfig, type AppConfig } from '../../core/config';
import { createContext, disposeContext, type AppContext } from '../../core/context';

/**
 * Runs against the real docker-compose services. When Postgres or Redis is not
 * reachable every test skips with a clear reason instead of failing — so a
 * fresh clone with no infrastructure still gets a green `npm run test`.
 *
 * CI runs this in a dedicated job with service containers; the no-services job
 * uses `npm run test:unit`, which excludes `*.integration.test.ts`.
 */
let app: Express | undefined;
let context: AppContext | undefined;
let unavailableReason: string | undefined;

const SKIP_BANNER = (reason: string) =>
  `[skipped] /health integration test — ${reason}. Start the services with \`docker compose up -d\` and rerun.`;

/** Prisma errors start with blank lines — take the first line that says something. */
function firstMeaningfulLine(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';

  const line = error.message
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part.length > 0);

  return line ?? error.name;
}

beforeAll(async () => {
  let config: AppConfig;

  try {
    config = parseConfig();
  } catch (error) {
    unavailableReason = `environment is not configured: ${firstMeaningfulLine(error)}`;
    return;
  }

  context = createContext(config);

  try {
    await context.prisma.$queryRaw`SELECT 1`;
    await context.redis.ping();
  } catch (error) {
    unavailableReason = `dependencies unreachable: ${firstMeaningfulLine(error)}`;
    return;
  }

  app = createApp(context);
});

afterAll(async () => {
  if (context) {
    await disposeContext(context);
  }
});

describe('GET /health (integration)', () => {
  it('returns 200 with both dependency checks green', async (ctx) => {
    if (!app) {
      console.warn(SKIP_BANNER(unavailableReason ?? 'unknown'));
      ctx.skip();
      return;
    }

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.checks).toEqual({ postgres: 'ok', redis: 'ok' });
    expect(response.body.app).toBe(context?.config.APP_NAME);
    expect(response.body.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(typeof response.body.uptime).toBe('number');
  });

  it('echoes a caller-supplied request id', async (ctx) => {
    if (!app) {
      ctx.skip();
      return;
    }

    const response = await request(app).get('/health').set('X-Request-Id', 'my-trace-id');

    expect(response.headers['x-request-id']).toBe('my-trace-id');
  });

  it('generates a request id when the caller sends none', async (ctx) => {
    if (!app) {
      ctx.skip();
      return;
    }

    const response = await request(app).get('/health');

    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('localises the summary message from Accept-Language', async (ctx) => {
    if (!app) {
      ctx.skip();
      return;
    }

    const hindi = await request(app).get('/health').set('Accept-Language', 'hi');
    const english = await request(app).get('/health').set('Accept-Language', 'en-IN,en;q=0.9');

    expect(hindi.headers['content-language']).toBe('hi');
    expect(hindi.body.message).toBe('सेवा ठीक चल रही है।');
    expect(english.headers['content-language']).toBe('en');
    expect(english.body.message).toBe('Service is running normally.');
  });

  it('returns the standard error envelope for an unknown route', async (ctx) => {
    if (!app) {
      ctx.skip();
      return;
    }

    const response = await request(app).get('/definitely-not-a-route');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.requestId).toBeTruthy();
  });

  it('has the seeded launch city in the database', async (ctx) => {
    if (!context || unavailableReason) {
      ctx.skip();
      return;
    }

    const city = await context.prisma.city.findFirst({ where: { name: 'Jabalpur' } });

    expect(city).not.toBeNull();
    expect(city?.state).toBe('Madhya Pradesh');
    expect(city?.isActive).toBe(true);
  });
});
