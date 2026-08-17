import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import path from 'node:path';

/**
 * Dev server fixed to :3000 — see .env.example and README for why: the API
 * moved to :3001 in this phase specifically so the app people actually type
 * a URL into keeps the port they expect.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
    // `@fixbridge/shared` is an npm-workspace symlink into packages/shared,
    // and its build output is CommonJS (apps/api requires it that way — see
    // that package's tsconfig, unchanged by this app). Resolving the
    // symlink to its real path (Vite's default) moves the file outside
    // node_modules from Vite's point of view, which skips the CJS→ESM
    // interop Rollup normally applies to node_modules deps and breaks named
    // imports (`SUPPORTED_LOCALES` etc.) in the production build only —
    // esbuild's dev pre-bundling is lenient enough to paper over it, which
    // is why this only surfaces in `vite build`, not `vite dev`.
    // `preserveSymlinks` keeps the node_modules path, so it's treated as a
    // dependency again.
    preserveSymlinks: true,
  },
  server: {
    port: 3000,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
