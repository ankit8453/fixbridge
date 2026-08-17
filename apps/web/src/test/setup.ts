import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { clearSession } from '../lib/auth/session';

/**
 * The one global Vitest setup file (`vitest.config.ts` → `test.setupFiles`),
 * shared by every suite in this app regardless of which surface owns it.
 * Kept deliberately generic — nothing surface-specific belongs here, only
 * the handful of things every suite needs regardless of what it tests:
 *
 *  - RTL's automatic unmount between tests (`cleanup`), so a component left
 *    mounted by one test can't leak state or DOM nodes into the next.
 *  - The auth module's in-memory state (`clearSession`) reset between tests
 *    — it is a module-level singleton by design (see lib/auth/session.ts),
 *    which means it otherwise survives across every test in a file.
 *  - `crypto.randomUUID` polyfilled for jsdom, which does not always provide
 *    it, and the device id depends on it.
 *  - Mocks and stubbed env vars torn down, so a `vi.stubEnv('NODE_ENV', ...)`
 *    or `vi.spyOn(...)` in one test (see session-cookie-flags.test.ts) can
 *    never bleed into the next.
 *
 * Guarded where a check reads `window`/`document`: route-handler suites opt
 * into `// @vitest-environment node` (see vitest.config.ts), which has
 * neither.
 */

beforeEach(() => {
  if (typeof window !== 'undefined') window.localStorage.clear();
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
  if (typeof document !== 'undefined') document.documentElement.lang = '';
});
