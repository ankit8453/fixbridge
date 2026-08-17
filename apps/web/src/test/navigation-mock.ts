import { vi } from 'vitest';

/**
 * The mutable state behind the global `next/navigation` mock in `setup.ts`.
 *
 * Kept as one shared, mutable object (not a factory per test) because
 * `vi.mock` in `setup.ts` closes over this module once; a test that needs a
 * different locale, path or query string mutates these fields directly rather
 * than re-mocking, e.g. `mockNav.params = { locale: 'en', providerId: 'p1' }`.
 */
export const mockNav = {
  params: { locale: 'hi' } as Record<string, string>,
  pathname: '/hi',
  search: '',
  router: {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  },
};
