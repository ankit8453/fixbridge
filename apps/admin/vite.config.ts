import react from '@vitejs/plugin-react';
// From `vitest/config` rather than `vite`, so the `test` block below is typed
// without a triple-slash reference that silently stops applying on an upgrade.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    // 3000 belongs to the API. Colliding with it would make the console's own
    // dev server shadow the thing it talks to.
    port: 5173,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // The suite mocks `fetch` outright; anything that escapes the mock is a bug
    // in the test, not a slow network, so there is no reason for a long timeout.
    testTimeout: 10000,
  },
});
