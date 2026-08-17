import react from '@vitejs/plugin-react';
// From `vitest/config` rather than `vite`, so the `test` block below is typed
// without a triple-slash reference that silently stops applying on an upgrade
// (same reasoning as apps/admin/vite.config.ts).
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
    // jsdom is the default; server-only suites (route handlers, cookie flags)
    // opt into `node` per-file with a `// @vitest-environment node` comment,
    // because NextRequest/NextResponse assume Node's fetch globals and jsdom
    // partially shadows them (Headers/Request behave differently under jsdom).
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    testTimeout: 10000,
  },
});
