import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the pure logic that decides a grade, a credential or a
 * deadline — the places where a wrong answer is silent and ends up on a report
 * card rather than throwing.
 *
 * Lives in server/ rather than at the repo root so that `npm run verify` — the
 * command render.yaml runs before it will touch the database — actually covers
 * it. A suite the deploy gate cannot reach is a suite that stops being run.
 *
 * Covers both sides of the app: server/ is CommonJS, src/ is ESM, and Vitest
 * transforms test files through Vite, so a test can `import` from either
 * without a second runner or a per-side config.
 *
 * Deliberately narrow. Anything needing a database, a live model or a rendered
 * component stays out — scripts/verify-*.js and manual QA cover those.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
  },
});
