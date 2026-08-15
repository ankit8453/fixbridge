import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseConfig } from './config';
import { consumeRateLimit, resetRateLimit } from './rate-limit';

/**
 * The limiter against real Redis, including the atomic INCR + EXPIRE + TTL Lua
 * script that the unit tests cannot reach.
 *
 * Uses its own keys and its own connection, so it never touches the counters the
 * HTTP suites depend on.
 */
let redis: Redis | undefined;
let unavailableReason: string | undefined;

const KEY_PREFIX = 'test:rate-limit:';
let keyCounter = 0;
const nextKey = (): string => `${KEY_PREFIX}${(keyCounter += 1)}`;

beforeAll(async () => {
  try {
    const config = parseConfig();
    redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
    await redis.connect();
    await redis.ping();
  } catch (error) {
    unavailableReason = error instanceof Error ? error.message.split('\n')[0] : 'unknown error';
    redis = undefined;
  }
});

beforeEach(() => {
  keyCounter += 1000;
});

afterAll(async () => {
  if (!redis) return;

  const keys = await redis.keys(`${KEY_PREFIX}*`);
  if (keys.length > 0) await redis.del(...keys);

  redis.disconnect();
});

describe('consumeRateLimit (integration)', () => {
  it('allows hits up to the limit and blocks the next one', async (ctx) => {
    if (!redis) {
      console.warn(`[skipped] rate limiter integration — Redis unreachable: ${unavailableReason}`);
      ctx.skip();
      return;
    }

    const key = nextKey();

    expect((await consumeRateLimit(redis, key, 3, 900)).allowed).toBe(true);
    expect((await consumeRateLimit(redis, key, 3, 900)).allowed).toBe(true);
    expect((await consumeRateLimit(redis, key, 3, 900)).allowed).toBe(true);

    const blocked = await consumeRateLimit(redis, key, 3, 900);
    expect(blocked.allowed).toBe(false);
    expect(blocked.count).toBe(4);
    expect(blocked.remaining).toBe(0);
  });

  it('sets a TTL on the first hit so a counter can never stick forever', async (ctx) => {
    if (!redis) return ctx.skip();

    const key = nextKey();
    await consumeRateLimit(redis, key, 5, 120);

    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(120);
  });

  it('reports a Retry-After that fits inside the window', async (ctx) => {
    if (!redis) return ctx.skip();

    const key = nextKey();
    for (let i = 0; i < 3; i += 1) await consumeRateLimit(redis, key, 2, 60);

    const result = await consumeRateLimit(redis, key, 2, 60);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('does not extend the window on later hits — it is a fixed window', async (ctx) => {
    if (!redis) return ctx.skip();

    const key = nextKey();
    await consumeRateLimit(redis, key, 10, 100);
    const firstTtl = await redis.ttl(key);

    await consumeRateLimit(redis, key, 10, 100);
    const secondTtl = await redis.ttl(key);

    expect(secondTtl).toBeLessThanOrEqual(firstTtl);
  });

  it('keeps separate keys independent — one phone cannot exhaust another', async (ctx) => {
    if (!redis) return ctx.skip();

    const a = nextKey();
    const b = nextKey();

    for (let i = 0; i < 4; i += 1) await consumeRateLimit(redis, a, 3, 900);

    expect((await consumeRateLimit(redis, a, 3, 900)).allowed).toBe(false);
    expect((await consumeRateLimit(redis, b, 3, 900)).allowed).toBe(true);
  });

  it('counts correctly under concurrent hits', async (ctx) => {
    if (!redis) return ctx.skip();

    const key = nextKey();

    // The whole point of the Lua script: ten parallel requests must produce ten
    // distinct counts, and exactly the first three may pass a limit of three.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => consumeRateLimit(redis as Redis, key, 3, 900)),
    );

    expect(new Set(results.map((r) => r.count)).size).toBe(10);
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
  });

  it('starts over after a reset', async (ctx) => {
    if (!redis) return ctx.skip();

    const key = nextKey();
    for (let i = 0; i < 4; i += 1) await consumeRateLimit(redis, key, 3, 900);
    expect((await consumeRateLimit(redis, key, 3, 900)).allowed).toBe(false);

    await resetRateLimit(redis, key);

    expect((await consumeRateLimit(redis, key, 3, 900)).allowed).toBe(true);
  });
});
