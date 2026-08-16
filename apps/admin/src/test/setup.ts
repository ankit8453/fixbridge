import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { clearSession } from '../lib/api';

/**
 * Deterministic by construction.
 *
 * `fetch` is replaced outright rather than intercepted at a lower level: this
 * suite is about what the console *sends* — which endpoint, with which body —
 * and a real network would make that a test of the API instead. Anything that
 * escapes the route table below fails loudly rather than hanging.
 */
beforeEach(() => {
  window.localStorage.clear();
  clearSession();

  // jsdom does not always provide randomUUID, and the device id depends on it.
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        ...globalThis.crypto,
        randomUUID: () => '00000000-0000-4000-8000-000000000000',
      },
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});
