import Redis from 'ioredis';
import type { AppConfig } from './config';
import type { AppLogger } from './logger';

/** Give up reconnecting after this many attempts so a dead Redis cannot pin the process open. */
const MAX_RECONNECT_ATTEMPTS = 3;

class MemoryRedisMock {
  private map = new Map<string, string>();
  private sets = new Map<string, Set<string>>();

  /**
   * Pattern scan, matching the subset of glob ioredis callers actually use
   * here (a trailing `*`). Returning `[]` from a missing method is not good
   * enough: the caller does `.length` on the result, and `undefined.length`
   * is the crash this mock existed to prevent.
   */
  keys(pattern: string): Promise<string[]> {
    const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
    const exact = !pattern.endsWith('*');

    const hits = [...this.map.keys(), ...this.sets.keys()].filter((key) =>
      exact ? key === pattern : key.startsWith(prefix),
    );

    return Promise.resolve([...new Set(hits)]);
  }

  on() {
    return this;
  }
  once() {
    return this;
  }
  quit() {
    return Promise.resolve('OK');
  }
  disconnect() {}

  async set(key: string, val: string, px?: string, ttl?: number, nx?: string) {
    if (nx === 'NX' && this.map.has(key)) return null;
    this.map.set(key, val);
    if (ttl && px === 'PX') {
      setTimeout(() => this.map.delete(key), ttl);
    }
    return 'OK';
  }

  async get(key: string) {
    return this.map.get(key) ?? null;
  }

  async del(key: string | string[]) {
    if (Array.isArray(key)) {
      key.forEach((k) => this.map.delete(k));
    } else {
      this.map.delete(key);
    }
    return 1;
  }

  async exists(key: string) {
    return this.map.has(key) ? 1 : 0;
  }

  async eval(_script: string, _numKeys: number, key: string, arg: string) {
    const val = this.map.get(key);
    const count = (val ? Number(val) : 0) + 1;
    this.map.set(key, String(count));
    const ttl = Number(arg);
    if (count === 1) {
      setTimeout(() => this.map.delete(key), ttl * 1000);
    }
    return [count, ttl];
  }

  async sadd(key: string, member: string) {
    if (!this.sets.has(key)) this.sets.set(key, new Set());
    this.sets.get(key)!.add(member);
    return 1;
  }

  async sismember(key: string, member: string) {
    return this.sets.get(key)?.has(member) ? 1 : 0;
  }

  async srem(key: string, member: string) {
    return this.sets.get(key)?.delete(member) ? 1 : 0;
  }
}


/**
 * MISSING_MOCK_METHODS
 *
 * What an unimplemented method resolves to when the fallback is active.
 *
 * It used to be `Promise.resolve()` -- i.e. `undefined` -- which is the wrong
 * shape for every read the app performs and turned a Redis blip into a
 * `TypeError` far from the cause. Returning an empty array is right for the
 * scan/list family and harmless for the rest, and the warning means the gap
 * shows up in the log rather than as a crash three modules away.
 */
function fallbackResult(prop: string | symbol, logger: AppLogger): unknown {
  logger.warn({ command: String(prop) }, 'redis: no in-memory fallback for this command');
  return Promise.resolve([]);
}

/**
 * Narrowing helpers for the proxy below.
 *
 * ioredis surfaces errors as `unknown` to a strict consumer, and the two things
 * this file cares about -- the message and a `code` -- both need a check before
 * they can be read. Doing it in one place keeps the proxy readable and avoids
 * the `any` casts that were here before, which would also have silently
 * swallowed a genuinely different error shape.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** True for the two failures that mean "Redis is gone", not "that command was wrong". */
function isConnectionLost(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'ECONNREFUSED' || messageOf(error).includes('closed');
}

/** Reads a method off the in-memory mock without widening the whole object to any. */
function mockMethod(mock: object, prop: string | symbol): (...args: unknown[]) => unknown {
  return (mock as Record<string | symbol, (...args: unknown[]) => unknown>)[prop];
}

export function createRedisClient(config: AppConfig, logger: AppLogger): Redis {
  let useMock = false;
  const mock = new MemoryRedisMock();

  const client = new Redis(config.REDIS_URL, {
    connectTimeout: 2_000,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) => {
      if (attempt > MAX_RECONNECT_ATTEMPTS) {
        logger.warn('redis: connection failed, switching to in-memory fallback client');
        useMock = true;
        return null; // Give up reconnecting
      }
      return 100;
    },
  });

  client.on('connect', () => logger.info('redis: connected'));
  client.on('ready', () => {
    /**
     * Recovery. `useMock` used to be one-way: a single transient error latched
     * it on and nothing ever turned it off, so one blip during startup meant
     * the process served an in-memory stub for the rest of its life -- and
     * because the stub silently answered `undefined` for anything it did not
     * implement, the symptom surfaced somewhere else entirely (a 500 in
     * /admin/summary, reading `.length` of nothing).
     *
     * A fallback that cannot recover is an outage with extra steps.
     */
    if (useMock) logger.info('redis: back, leaving in-memory fallback');
    useMock = false;
    logger.info('redis: ready');
  });
  client.on('end', () => {
    logger.info('redis: connection closed');
    useMock = true;
  });
  client.on('error', (error: unknown) => {
    logger.warn({ err: messageOf(error) }, 'redis: connection error');
    if (isConnectionLost(error)) useMock = true;
  });

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (useMock) {
        if (prop in mock) {
          return mockMethod(mock, prop).bind(mock);
        }
      }
      const val = Reflect.get(target, prop, receiver);
      if (typeof val === 'function') {
        return function (this: unknown, ...args: unknown[]) {
          if (useMock) {
            if (prop in mock) {
              return mockMethod(mock, prop)(...args);
            }
            return fallbackResult(prop, logger);
          }
          try {
            const res = val.apply(this || target, args);
            if (res instanceof Promise) {
              return res.catch((err: unknown) => {
                if (isConnectionLost(err)) {
                  logger.warn('redis: command failed, falling back to memory mock');
                  useMock = true;
                  if (prop in mock) {
                    return mockMethod(mock, prop)(...args);
                  }
                  return fallbackResult(prop, logger);
                }
                throw err;
              });
            }
            return res;
          } catch (err: unknown) {
            if (isConnectionLost(err)) {
              useMock = true;
              if (prop in mock) {
                return mockMethod(mock, prop)(...args);
              }
              return fallbackResult(prop, logger);
            }
            throw err;
          }
        };
      }
      return val;
    },
  }) as unknown as Redis;
}
