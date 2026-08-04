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
