/**
 * db.js — the one Prisma client, and the only seam that can replace it.
 *
 * server.js used to do `const prisma = new PrismaClient()` at module load,
 * which meant importing the route table opened a connection to whatever
 * DATABASE_URL pointed at. There is no staging database, so that URL is
 * production — and that is the reason the route-level QA steps (HANDOFF.md P3
 * and P8) were written as manual REST-client instructions instead of tests.
 *
 * Mocking `@prisma/client` does not solve it: server.js is CommonJS, and
 * Vitest cannot rewrite a `require()` inside a CJS file, so `vi.mock` is
 * silently ignored and the real client is used anyway. The seam has to be a
 * real one.
 *
 * What is exported is a Proxy that forwards to whichever client is current, so
 * every `prisma.*` call site in server.js keeps working untouched while a test
 * can swap the object underneath it before the routes ever run.
 */

const { PrismaClient } = require('@prisma/client');

let client = new PrismaClient();

/**
 * Point the application at a different client. Tests only.
 *
 * Refuses in production rather than trusting that no code path reaches it: a
 * function that can silently detach the whole application from its database is
 * worth making impossible to call by accident. Returns a restore function.
 */
function __setClientForTests(replacement) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('__setClientForTests must never be called in production.');
  }
  const previous = client;
  client = replacement;
  return () => { client = previous; };
}

/**
 * Forwards every property to the live client. Functions are bound, because
 * `$transaction`, `$connect` and friends need their `this`; model namespaces
 * (`prisma.user`, `prisma.submission`) are plain objects and pass straight
 * through.
 *
 * The seam is served from the get trap rather than assigned onto the export —
 * assigning would hit the set trap and write the helper onto the Prisma client.
 */
module.exports = new Proxy({}, {
  get(_target, prop) {
    if (prop === '__setClientForTests') return __setClientForTests;
    const value = client[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
  set(_target, prop, value) {
    client[prop] = value;
    return true;
  },
  has(_target, prop) {
    return prop === '__setClientForTests' || prop in client;
  },
});
