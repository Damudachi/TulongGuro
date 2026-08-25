import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

/**
 * What the Student ID field will accept as a student's ID.
 *
 * A student signs in with the ID printed on their slip — MES-26-0001 — and the
 * login route has a deliberate second chance for one typed the way a child
 * types it: wrong case, dashes left out, spaces instead. That is worth having.
 * An eight-year-old copying off a board produces "as 26 0001" often enough that
 * refusing it sends them to a teacher for a password reset they do not need.
 *
 * The bug is how wide "relaxed" was. It stripped every character that was not a
 * letter or a digit, so
 *
 *     MES-26-0001#@#!#@#!@#!@#
 *
 * reduced to MES2600001, matched the real account, and signed in — with the
 * correct password, which is why nothing was actually breached. But the ID
 * typed was not an ID anybody was issued: the field looked like it accepted
 * arbitrary input, the audit trail could hold a login for a username that does
 * not exist, and the leniency stops being harmless the moment anything
 * downstream trusts that string.
 *
 * So the tolerance is now case and SEPARATORS, and these tests hold both edges
 * of it: the child's mistyped ID still works, the junk-suffixed one does not.
 *
 * Harness matches ai-credential-rotation.test.js — db.js swapped through Node's
 * CJS cache before server.js is required.
 */

const require = createRequire(import.meta.url);

function makePrismaFake() {
  const models = new Map();
  const defaults = {
    findUnique: null, findFirst: null, findMany: [], count: 0,
    create: {}, createMany: { count: 0 }, update: {}, updateMany: { count: 0 },
    delete: {}, deleteMany: { count: 0 },
    aggregate: {}, groupBy: [], upsert: {},
  };
  const makeModel = () => {
    const model = {};
    for (const [method, value] of Object.entries(defaults)) {
      model[method] = vi.fn().mockResolvedValue(value);
    }
    return model;
  };
  const rawQuery = vi.fn().mockResolvedValue([]);
  const fake = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop === 'then') return undefined;
      if (prop === '$transaction') return (a) => (typeof a === 'function' ? a(fake) : Promise.all(a));
      if (prop === '$queryRaw') return rawQuery;
      if (prop.startsWith('$')) return () => Promise.resolve(undefined);
      if (!models.has(prop)) models.set(prop, makeModel());
      return models.get(prop);
    },
  });
  const reset = () => {
    for (const model of models.values()) {
      for (const [method, value] of Object.entries(defaults)) {
        model[method].mockReset().mockResolvedValue(value);
      }
    }
    rawQuery.mockReset().mockResolvedValue([]);
  };
  return { fake, reset, rawQuery };
}

const { fake: prismaFake, reset: resetPrisma, rawQuery } = makePrismaFake();

process.env.AUTH_SECRET = 'student-id-login-test-secret';
process.env.NODE_ENV = 'test';
// Rate limiting would otherwise trip partway through a file that is entirely
// login attempts, and turn a real assertion into a 429.
process.env.LOGIN_RATE_LIMIT_MAX = '1000';

const ID = 'MES-26-0001';
const STUDENT_ROW_ID = 'student-row-1';
/** What the student's password actually is. Every attempt below sends it, so a
 *  rejection is always about the ID and never about the password. */
const PASSWORD = '06152004';

let baseUrl, server, restoreClient, realFetch, bcrypt, hashed;

beforeAll(async () => {
  restoreClient = require('../db.js').__setClientForTests(prismaFake);
  const { app } = require('../server.js');
  bcrypt = require('bcryptjs');
  hashed = await bcrypt.hash(PASSWORD, 4);

  realFetch = globalThis.fetch;
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}, 60000);

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (restoreClient) restoreClient();
});

const studentRow = () => ({
  id: STUDENT_ROW_ID,
  username: ID,
  password: hashed,
  role: 'STUDENT',
  name: 'Test Learner',
  school: null,
  section: null,
});

beforeEach(() => {
  resetPrisma();
  // The exact-match lookup answers only for the ID exactly as issued. Anything
  // else has to earn its way through the relaxed path, which is what is under
  // test — so this stands in for the unique index rather than for a search.
  prismaFake.user.findFirst.mockImplementation(async ({ where }) =>
    where?.username === ID && where?.role === 'STUDENT' ? studentRow() : null
  );
  prismaFake.user.findUnique.mockImplementation(async ({ where }) =>
    where?.id === STUDENT_ROW_ID ? studentRow() : null
  );
  // The relaxed path compares IDs with separators removed. The fake reproduces
  // that comparison over a one-row table rather than parsing the SQL.
  rawQuery.mockImplementation(async (_strings, normalized) =>
    normalized === ID.replace(/[ ._-]+/g, '').toUpperCase() ? [{ id: STUDENT_ROW_ID }] : []
  );
});

const login = (username) => realFetch(`${baseUrl}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password: PASSWORD, role: 'STUDENT' }),
});

describe('an ID typed the way a child types it still signs in', () => {
  // The whole reason the relaxed path exists. If these break, the fix has
  // overshot and gone back to sending learners for password resets.
  const forgiven = [
    [ID, 'exactly as printed'],
    ['mes-26-0001', 'all lower case'],
    ['MES 26 0001', 'spaces instead of dashes'],
    ['MES260001'.replace('MES', 'MES'), 'no separators at all'],
    ['  MES-26-0001  ', 'padded by a copy-paste'],
    ['mes_26_0001', 'underscores'],
    ['MES.26.0001', 'full stops'],
    ['MES-26-0001\n', 'a trailing newline from a paste'],
  ];

  for (const [typed, description] of forgiven) {
    it(`accepts ${description}`, async () => {
      const res = await login(typed);
      expect(res.status, typed).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.user.username).toBe(ID);
    });
  }
});

describe('an ID with characters nobody was issued does not', () => {
  // The reported bug, and the shapes around it. Every one of these carries the
  // CORRECT password, so a 401 here is the ID being refused and nothing else.
  //
  // Surrounding whitespace is not in this list on purpose: it is trimmed before
  // the exact lookup, which is the ordinary handling of a paste and not a
  // widening of what counts as an ID.
  const refused = [
    ['MES-26-0001#@#!#@#!@#!@#', 'the reported one — junk appended'],
    ['#MES-26-0001', 'junk prepended'],
    ['MES-26-0001!', 'a single stray character'],
    ['MES/26/0001', 'slashes, which are not a separator anyone types for this'],
    ['MES-26-0001 OR 1=1', 'something shaped like an injection'],
    ['MES-26-0001@school.edu.ph', 'an email built around the ID'],
    ['MES%2D26%2D0001', 'percent-encoded dashes'],
  ];

  for (const [typed, description] of refused) {
    it(`refuses ${description}`, async () => {
      const res = await login(typed);
      expect(res.status, typed).toBe(401);
      const body = await res.json();
      expect(body.success).toBe(false);
      // The same reply as any other wrong ID. Which of the two it was is not
      // the login screen's business to say.
      expect(body.error).toBe('Invalid credentials');
    });
  }

  it('refuses a separator-only string rather than matching the first student', async () => {
    for (const typed of ['---', '   ', '-.-_']) {
      const res = await login(typed);
      expect(res.status, typed).toBe(401);
    }
  });

  it('does not run the relaxed lookup at all for input that is not an ID', async () => {
    rawQuery.mockClear();
    await login('MES-26-0001#@#!');
    // Refused before the query, not by it — the guard is the shape of the
    // input, so a malformed ID never reaches a scan over every student row.
    expect(rawQuery).not.toHaveBeenCalled();
  });

  it('refuses an ID far longer than any that has been issued', async () => {
    const res = await login(`${'M'.repeat(200)}-26-0001`);
    expect(res.status).toBe(401);
    expect(rawQuery).not.toHaveBeenCalled();
  });
});

describe('the relaxed path widens the name, never the proof', () => {
  it('still refuses a mistyped ID when the password is wrong', async () => {
    const res = await realFetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'mes 26 0001', password: 'not-the-password', role: 'STUDENT' }),
    });
    expect(res.status).toBe(401);
  });

  it('treats an ambiguous relaxed match as no match', async () => {
    // Two accounts differing only in punctuation. Guessing which child is
    // signing in is worse than refusing, so the route requires exactly one.
    rawQuery.mockResolvedValue([{ id: 'student-a' }, { id: 'student-b' }]);
    const res = await login('mes 26 0001');
    expect(res.status).toBe(401);
  });
});
