import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import nextPlugin from '@next/eslint-plugin-next';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/*.d.ts',
      'apps/api/prisma/migrations/**',
      'apps/web/.next/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,js,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      eqeqeq: ['error', 'smart'],
      'no-implicit-coercion': 'error',
      'prefer-const': 'error',
      'object-shorthand': ['error', 'always'],
    },
  },
  {
    /**
     * The web app runs the same source in two places: client components in the
     * browser, server components/route handlers/middleware in Node (or the edge
     * runtime, which is Node-shaped enough for lint purposes). Restricting
     * globals to one or the other would make half of every file look like it
     * references undefined identifiers, so both sets are allowed here — the
     * TypeScript compiler is what actually catches a browser-only API reached
     * for from server code (`lib.dom` is intentionally not in next.config's
     * server tsconfig lib list).
     */
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  },
  {
    /**
     * `eslint-config-next` itself is NOT installed (see next.config.ts's
     * `eslint.ignoreDuringBuilds` comment for why: one root flat config is
     * the single lint gate for every workspace). But `next/image`,
     * `next/script` and friends have real, Next-specific misuse footguns
     * (an `<img>` where `next/image` would get responsive sizing and lazy
     * loading for free, a script tag that blocks hydration) that the
     * generic TypeScript rules above cannot see — so just the rules plugin
     * is added, scoped to apps/web, rather than the full opinionated config.
     */
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      // This is an App-Router-only app with no `pages/` directory, ever —
      // the rule's own Pages-Router detection logs a harmless "Pages
      // directory cannot be found" note on every run because it looks for
      // one relative to the ESLint root (the monorepo root, not apps/web).
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
  {
    // Tests may reach for looser typing when building fixtures/doubles.
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  prettier,
);
