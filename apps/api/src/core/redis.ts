import Redis from 'ioredis';
import type { AppConfig } from './config';
import type { AppLogger } from './logger';

/** Give up reconnecting after this many attempts so a dead Redis cannot pin the process open. */
const MAX_RECONNECT_ATTEMPTS = 3;

class MemoryRedisMock {
  private map = new Map<string, string>();
  private sets = new Map<string, Set<string>>();

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
  client.on('ready', () => logger.info('redis: ready'));
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
            return Promise.resolve();
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
                  return Promise.resolve();
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
              return Promise.resolve();
            }
            throw err;
          }
        };
      }
      return val;
    },
  }) as unknown as Redis;
}
