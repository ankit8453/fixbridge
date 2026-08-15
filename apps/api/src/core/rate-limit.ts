import type Redis from 'ioredis';

export interface RateLimitResult {
  allowed: boolean;
  /** Hits recorded in the current window, including this one. */
  count: number;
  limit: number;
  /** Hits still available. 0 once the limit is reached. */
  remaining: number;
  /** Seconds until the window resets — what goes into `Retry-After`. */
  retryAfterSeconds: number;
}

/**
 * INCR the counter, set the TTL on first hit, and read the TTL back — atomically,
 * so two concurrent requests cannot both see "first hit" and leave the key
 * without an expiry (which would lock a phone out forever).
 *
 * Returns `{ count, ttl }`.
 */
const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;

/** Pure decision step, split out from Redis so the arithmetic is unit-testable. */
export function evaluateRateLimit(
  count: number,
  limit: number,
  ttlSeconds: number,
  windowSeconds: number,
): RateLimitResult {
  const retryAfterSeconds = ttlSeconds > 0 ? ttlSeconds : windowSeconds;

  return {
    allowed: count <= limit,
    count,
    limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds,
  };
}

/**
 * Fixed-window counter. Chosen over a sliding window because the limits here are
 * tiny (3–5 per 15 min) and the failure mode of a fixed window — a burst across
 * a boundary — is irrelevant at that scale.
 */
export async function consumeRateLimit(
  redis: Redis,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const raw = (await redis.eval(CONSUME_SCRIPT, 1, key, String(windowSeconds))) as [number, number];
  const [count, ttl] = raw;

  return evaluateRateLimit(Number(count), limit, Number(ttl), windowSeconds);
}

/** Drop a counter — used by tests and by "you have signed in, forget the attempts". */
export async function resetRateLimit(redis: Redis, key: string): Promise<void> {
  await redis.del(key);
}
