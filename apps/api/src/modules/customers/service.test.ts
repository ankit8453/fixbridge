import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../core/context';
import { AppError } from '../../core/errors';
import { createStubGeoService } from '../../core/geo';
import { createAddress } from './service';

/**
 * The address cap is a service rule, not a database constraint, so it is
 * exercised here with a stubbed context rather than against Postgres.
 */
function buildContext(existingAddresses: number, maxAddresses = 5): AppContext {
  return {
    config: { MAX_ADDRESSES_PER_USER: maxAddresses, DEFAULT_CITY_ID: 1 },
    geo: createStubGeoService(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    prisma: {
      address: { count: vi.fn(async () => existingAddresses) },
      // Only reached when the cap check passes.
      $transaction: vi.fn(async () => {
        throw new Error('should not reach the database when the cap is exceeded');
      }),
    },
  } as unknown as AppContext;
}

const input = {
  label: 'home' as const,
  addressText: '212 Shastri Nagar, Wright Town',
};

describe('createAddress — address cap', () => {
  it('rejects a new address once the cap is reached', async () => {
    await expect(createAddress(buildContext(5), 'user-1', input)).rejects.toBeInstanceOf(AppError);
  });

  it('reports 409 with the configured limit, not a generic failure', async () => {
    try {
      await createAddress(buildContext(5), 'user-1', input);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;

      expect(appError.statusCode).toBe(409);
      expect(appError.code).toBe('ADDRESS_LIMIT_REACHED');
      expect(appError.messageKey).toBe('errors.customers.addressLimitReached');
      expect(appError.details).toEqual({ limit: 5 });
    }
  });

  it('rejects when the count is somehow already past the cap', async () => {
    await expect(createAddress(buildContext(9), 'user-1', input)).rejects.toBeInstanceOf(AppError);
  });

  it('honours a custom cap', async () => {
    await expect(createAddress(buildContext(2, 2), 'user-1', input)).rejects.toThrow(
      /ADDRESS_LIMIT_REACHED|max 2/,
    );
  });

  it('gets past the cap check when there is room', async () => {
    // The stub throws from $transaction, which proves the cap check let it through.
    await expect(createAddress(buildContext(4), 'user-1', input)).rejects.toThrow(
      /should not reach the database/,
    );
  });

  it('rejects client-supplied coordinates that are not on Earth', async () => {
    await expect(
      createAddress(buildContext(0), 'user-1', { ...input, lat: 91, lng: 0 }),
    ).rejects.toThrow(/coordinates/i);
  });
});
