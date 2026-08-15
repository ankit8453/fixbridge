import type Redis from 'ioredis';
import type { AppConfig } from '../../core/config';
import type { AppLogger } from '../../core/logger';

/**
 * Access tokens are stateless, so blocking a user in Postgres alone leaves their
 * existing token working until it expires — up to 15 minutes of a blocked
 * technician still accepting jobs.
 *
 * The denylist closes that window: one key per blocked user, with a TTL equal to
 * the access-token lifetime. Once every token minted before the block has
 * expired, the key expires too and cleans itself up. There is nothing to prune.
 */
export const denylistKey = (userId: string): string => `auth:denylist:user:${userId}`;

export interface UserDenylist {
  add(userId: string): Promise<void>;
  remove(userId: string): Promise<void>;
  has(userId: string): Promise<boolean>;
}

export function createUserDenylist(
  redis: Redis,
  config: AppConfig,
  logger: AppLogger,
): UserDenylist {
  return {
    async add(userId) {
      await redis.set(denylistKey(userId), '1', 'EX', config.JWT_ACCESS_TTL_SECONDS);
    },

    async remove(userId) {
      await redis.del(denylistKey(userId));
    },

    async has(userId) {
      try {
        return (await redis.exists(denylistKey(userId))) === 1;
      } catch (error) {
        /**
         * Deliberately fail OPEN.
         *
         * Failing closed would turn a Redis blip into a total authentication
         * outage for every user. Failing open risks a blocked user acting for
         * the remainder of their access token — which is exactly the window we
         * had before this existed, so the worst case is the old behaviour.
         *
         * Logged at error level precisely so it is alertable rather than silent.
         */
        logger.error({ err: error, userId }, 'denylist check failed — allowing request');
        return false;
      }
    },
  };
}
