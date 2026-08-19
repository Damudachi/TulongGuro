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
      }, {
        // The browser paints these itself, outside the page: on the deployed
        // build every one of them was headed "tulong-guro.vercel.app says",
        // in OS chrome, with no way to style or translate it. All ~130 sites
        // were moved to src/utils/dialog.js; this is what stops the next one
        // coming back.
        name: 'alert',
        message: 'Use showAlert from src/utils/dialog.js — alert() is painted by the browser and titled with the deployment hostname.',
      }, {
        name: 'confirm',
        message: 'Use showConfirm from src/utils/dialog.js (await it) — confirm() is painted by the browser and titled with the deployment hostname.',
      }, {
        name: 'prompt',
        message: 'Use showPrompt from src/utils/dialog.js (await it) — prompt() is painted by the browser and titled with the deployment hostname.',
      }],
    },
  },
  // The service worker runs in neither Node nor a window: `self`, `caches`,
  // `clients` and `skipWaiting` are its globals. It used to declare them with
  // an `/* eslint-env serviceworker */` comment, which ESLint 10 removed
  // support for — so `npm run lint` had been failing outright since the PWA
  // commit. Declaring the environment here is the replacement, and it has to
  // be a config block rather than a comment because public/ matched no
  // `files:` entry at all: with the comment simply deleted, every one of those
  // globals would have linted as undefined instead.
  {
    files: ['public/sw.js'],
    languageOptions: {
      globals: globals.serviceworker,
      sourceType: 'script',
    },
    extends: [js.configs.recommended],
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
