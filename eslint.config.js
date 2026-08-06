import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'server/node_modules', 'server/prisma']),
  // The backend is CommonJS on Node, so `require`, `module`, `process` and
  // `Buffer` are globals there. Without this, `npm run lint` reported every
  // line of server code as an undefined-variable error and the real problems
  // were impossible to see.
  {
    files: ['server/**/*.js'],
    languageOptions: {
      globals: globals.node,
      sourceType: 'commonjs',
    },
  },
  // The unit tests and the Vitest config are the exception: Vitest transforms
  // them through Vite, so they are written as ES modules and import across the
  // CJS/ESM line freely (a test can pull in both server/grading.js and
  // src/utils/grading.js). Linting them as CommonJS reports every `import` as a
  // parse error. `.mjs` covers vitest.config.mjs, which is ESM for the same
  // reason.
  {
    files: ['server/tests/**/*.js', 'server/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
      sourceType: 'module',
      ecmaVersion: 'latest',
    },
  },
  // Bare fetch() sends no Authorization header, so a call that uses it reaches
  // the API unauthenticated and comes back 401 — which most screens render as
  // "no data" rather than an error. That failure is silent and cost real
  // debugging time, so the linter catches it now. config.js is exempt: it is
  // where apiFetch and logout legitimately call fetch directly.
  {
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/config.js'],
    rules: {
      'no-restricted-globals': ['error', {
        name: 'fetch',
        message: 'Use apiFetch from src/config.js — bare fetch() omits the auth token and silently 401s.',
      }],
    },
  },
  {
    files: ['src/**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
])
