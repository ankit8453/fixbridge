import { describe, expect, it, vi } from 'vitest';
import Redis from 'ioredis';
import { createRedisClient } from './redis';
import type { AppConfig } from './config';
import type { AppLogger } from './logger';

/**
 * DEF-001 — the fallback must be a door, not a trapdoor.
 *
 * `createRedisClient` swaps to an in-memory stub when Redis is unreachable so
 * requests keep being served. That is deliberate. The defect was that it also
 * told ioredis to *stop reconnecting*, so a blip at startup — or a
 * `docker compose up` taking its usual forty seconds — left the process on the
 * stub until somebody restarted it.
 *
 * On more than one instance that is worse than an outage: each process holds
 * its own OTP map, so a booking code issued by one is rejected by another, and
 * the rate limiters silently reset to empty. Neither failure is visible until
 * a customer is standing at their door with a code that does not work.
 *
 * These tests assert the retry policy directly rather than orchestrating a
 * real Redis outage, because the policy *is* the fix: never return `null`.
 */

function retryStrategyFrom(): (attempt: number) => number | null {
  const captured: { strategy?: (attempt: number) => number | null } = {};

  const RedisMock = vi.fn((_url: string, options: Record<string, unknown>) => {
    captured.strategy = options.retryStrategy as (attempt: number) => number | null;
    return { on: vi.fn(), status: 'connecting' };
  });

  vi.mocked(Redis).mockImplementation(RedisMock as never);

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as AppLogger;
  createRedisClient({ REDIS_URL: 'redis://127.0.0.1:6379' } as AppConfig, logger);

  if (!captured.strategy) throw new Error('retryStrategy was never configured');
  return captured.strategy;
}

vi.mock('ioredis', () => ({ default: vi.fn() }));

describe('redis retry policy', () => {
  it('never gives up reconnecting, however long the outage', () => {
    const retry = retryStrategyFrom();

    // The original bug: `null` at attempt 4 meant ioredis stopped for good.
    for (const attempt of [1, 2, 3, 4, 5, 20, 500, 100_000]) {
      expect(retry(attempt), `attempt ${attempt} must schedule another try`).not.toBeNull();
    }
  });

  it('backs off, but never slower than five seconds', () => {
    const retry = retryStrategyFrom();

    // Quick while it might still be a blip…
    expect(retry(1)).toBe(100);
    expect(retry(2)).toBe(200);

    // …then capped, so a long outage costs one attempt every five seconds
    // rather than a busy loop against a socket that is not listening.
    expect(retry(50)).toBe(5_000);
    expect(retry(10_000)).toBe(5_000);
  });

  it('warns exactly once when it switches to the fallback', () => {
    const captured: { strategy?: (attempt: number) => number | null } = {};
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as AppLogger;

    vi.mocked(Redis).mockImplementation(
      vi.fn((_url: string, options: Record<string, unknown>) => {
        captured.strategy = options.retryStrategy as (attempt: number) => number | null;
        return { on: vi.fn(), status: 'connecting' };
      }) as never,
    );

    createRedisClient({ REDIS_URL: 'redis://127.0.0.1:6379' } as AppConfig, logger);

    const retry = captured.strategy as (attempt: number) => number | null;
    for (let attempt = 1; attempt <= 10; attempt += 1) retry(attempt);

    // One warning, not ten — a reconnect loop that logs on every attempt
    // drowns the log it is trying to draw attention to.
    const warnings = vi
      .mocked(logger.warn)
      .mock.calls.filter((call) => String(call[0]).includes('in-memory fallback'));
    expect(warnings).toHaveLength(1);
  });
});
