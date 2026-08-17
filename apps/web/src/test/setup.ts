import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { clearSession } from '../lib/auth/session';

/**
 * The one global Vitest setup file (`vitest.config.ts` → `test.setupFiles`),
 * shared by every suite in this app.
 *
 *  - RTL's automatic unmount between tests (`cleanup`), so a component left
 *    mounted by one test can't leak state or DOM nodes into the next.
 *  - The auth module's in-memory + localStorage state (`clearSession`) reset
 *    between tests — both are module-level/persisted state by design (see
 *    `lib/auth/session.ts`), which means either otherwise survives across
 *    every test in a file.
 *  - `crypto.randomUUID` polyfilled for jsdom, which does not always provide
 *    it, and the device id / toast ids depend on it.
 *  - Mocks and stubbed env vars torn down, so a `vi.spyOn(...)` in one test
 *    can never bleed into the next.
 */

beforeEach(() => {
  window.localStorage.clear();
  clearSession();

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
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  document.documentElement.lang = '';
});
