import type Redis from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../core/config';
import type { AppLogger } from '../../core/logger';
import { createUserDenylist, denylistKey } from './denylist';

const config = { JWT_ACCESS_TTL_SECONDS: 900 } as AppConfig;

function fakeLogger(): AppLogger {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as unknown as AppLogger;
}

/** Minimal in-memory stand-in for the three Redis commands the denylist uses. */
function fakeRedis(): Redis & { store: Map<string, number> } {
  const store = new Map<string, number>();

  return {
    store,
    set: vi.fn(async (key: string, _value: string, _mode: string, ttl: number) => {
      store.set(key, ttl);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    exists: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
  } as unknown as Redis & { store: Map<string, number> };
}

describe('denylistKey', () => {
  it('namespaces under auth and carries no brand name', () => {
    expect(denylistKey('user-1')).toBe('auth:denylist:user:user-1');
  });

  it('is distinct per user', () => {
    expect(denylistKey('a')).not.toBe(denylistKey('b'));
  });
});

describe('createUserDenylist', () => {
  it('reports a user as not denylisted by default', async () => {
    const denylist = createUserDenylist(fakeRedis(), config, fakeLogger());
    expect(await denylist.has('user-1')).toBe(false);
  });

  it('denylists a user after add', async () => {
    const denylist = createUserDenylist(fakeRedis(), config, fakeLogger());

    await denylist.add('user-1');

    expect(await denylist.has('user-1')).toBe(true);
  });

  it('expires the entry with the access-token lifetime, so it cleans itself up', async () => {
    const redis = fakeRedis();
    const denylist = createUserDenylist(redis, config, fakeLogger());

    await denylist.add('user-1');

    // Once every token issued before the block has expired, the key is pointless.
    expect(redis.store.get(denylistKey('user-1'))).toBe(900);
  });

  it('only affects the user that was added', async () => {
    const denylist = createUserDenylist(fakeRedis(), config, fakeLogger());

    await denylist.add('user-1');

    expect(await denylist.has('user-2')).toBe(false);
  });

  it('clears the entry on remove', async () => {
    const denylist = createUserDenylist(fakeRedis(), config, fakeLogger());

    await denylist.add('user-1');
    await denylist.remove('user-1');

    expect(await denylist.has('user-1')).toBe(false);
  });

  it('tolerates removing a user that was never added', async () => {
    const denylist = createUserDenylist(fakeRedis(), config, fakeLogger());
    await expect(denylist.remove('never-blocked')).resolves.toBeUndefined();
  });

  /**
   * The deliberate trade-off: a Redis outage must not take authentication down
   * with it. Worst case is the pre-denylist behaviour — a blocked user keeps
   * working until their access token expires.
   */
  describe('when Redis is unreachable', () => {
    function brokenRedis(): Redis {
      return {
        exists: vi.fn(async () => {
          throw new Error('ECONNREFUSED');
        }),
      } as unknown as Redis;
    }

    it('fails open rather than locking everyone out', async () => {
      const denylist = createUserDenylist(brokenRedis(), config, fakeLogger());
      expect(await denylist.has('user-1')).toBe(false);
    });

    it('logs at error level so the outage is alertable, not silent', async () => {
      const logger = fakeLogger();
      const denylist = createUserDenylist(brokenRedis(), config, logger);

      await denylist.has('user-1');

      expect(logger.error).toHaveBeenCalledOnce();
    });
  });
});
