import react from '@vitejs/plugin-react';
// From `vitest/config` rather than `vite`, so the `test` block below is typed
// without a triple-slash reference that silently stops applying on an upgrade.
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirrors the `@/*` path alias in tsconfig.json. Vite does not read
    // tsconfig paths on its own, so it is repeated here — the two must stay in
    // sync, which is why both point at the same `src` directory rather than
    // listing individual subpaths.
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    testTimeout: 10000,
    exclude: ['**/node_modules/**'],
  },
});
