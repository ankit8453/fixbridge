import Redis from 'ioredis';
import type { AppConfig } from './config';
import type { AppLogger } from './logger';

/** Give up reconnecting after this many attempts so a dead Redis cannot pin the process open. */
const MAX_RECONNECT_ATTEMPTS = 3;

class MemoryRedisMock {
  private map = new Map<string, string>();
  private sets = new Map<string, Set<string>>();

  on() { return this; }
  once() { return this; }
  quit() { return Promise.resolve('OK'); }
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
  client.on('error', (error: any) => {
    logger.warn({ err: error.message }, 'redis: connection error');
    if (error.code === 'ECONNREFUSED' || error.message.includes('closed')) {
      useMock = true;
    }
  });

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (useMock) {
        if (prop in mock) {
          return (mock as any)[prop].bind(mock);
        }
      }
      const val = Reflect.get(target, prop, receiver);
      if (typeof val === 'function') {
        return function (this: any, ...args: any[]) {
          if (useMock) {
            if (prop in mock) {
              return (mock as any)[prop](...args);
            }
            return Promise.resolve();
          }
          try {
            const res = val.apply(this || target, args);
            if (res instanceof Promise) {
              return res.catch((err) => {
                if (err.message.includes('closed') || err.code === 'ECONNREFUSED') {
                  logger.warn('redis: command failed, falling back to memory mock');
                  useMock = true;
                  if (prop in mock) {
                    return (mock as any)[prop](...args);
                  }
                  return Promise.resolve();
                }
                throw err;
              });
            }
            return res;
          } catch (err: any) {
            if (err.message.includes('closed') || err.code === 'ECONNREFUSED') {
              useMock = true;
              if (prop in mock) {
                return (mock as any)[prop](...args);
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
