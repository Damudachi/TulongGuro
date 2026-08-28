import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

/**
 * Who owns a school code, and when.
 *
 * school-slug.test.js proves how a code is *derived* from a name. This file is
 * about the other half, which is a policy question rather than a string one:
 * given two schools whose names reduce to the same code, which of them gets it?
 *
 * The rule used to be "whoever submits the registration form first", enforced
 * by a unique constraint on the column. That gave a code to a row nobody had
 * looked at yet, and registration is the one door in this system anybody can
 * walk up to — so an invented "San Joaquin Elementary School" could take
 * `sjes-sanj` from the real San Jose Elementary School and keep it, because
 * rejection did not release it either.
 *
 * The rule now is "whoever is approved on it first". That moves the contest
 * from the INSERT to the approval, and everything below is about the two things
 * that move with it:
 *
 *   1. A PENDING or REJECTED row must not make a code look taken.
 *   2. Approving one school must settle every other registration claiming its
 *      code — including vacating the addresses they were holding inside it,
 *      because User.email is unique platform-wide and a winner who cannot
 *      create `principal@admin.<code>.edu.ph` has been given the code and not
 *      its namespace.
 *
 * Driven over real HTTP against the real Express app, with the Prisma client
 * swapped for a fake — the same harness route-wiring.test.js documents, and for
 * the same reason: the defect this guards against is a missing call, not a
 * wrong answer, so a pure test of the predicate would not have caught it.
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
      for (const [m, v] of Object.entries(defaults)) model[m].mockReset().mockResolvedValue(v);
    }
    rawQuery.mockReset().mockResolvedValue([]);
  };
  return { fake, reset };
}

const { fake: prismaFake, reset: resetPrisma } = makePrismaFake();

process.env.AUTH_SECRET = 'school-code-ownership-test-secret';
process.env.NODE_ENV = 'test';

const CODE = 'sjes-sanj';
const WINNER = 'school-joaquin';
const LOSER = 'school-jose';

let baseUrl;
let server;
let signToken;
let restoreClient;

beforeAll(async () => {
  restoreClient = require('../db.js').__setClientForTests(prismaFake);
  const { app } = require('../server.js');
  ({ signToken } = require('../auth.js'));
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}, 60000);

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (restoreClient) restoreClient();
});

beforeEach(() => {
  resetPrisma();
  prismaFake.user.findUnique.mockResolvedValue({ sessionsValidFrom: null });
});

const operatorToken = () => signToken({ id: 'operator-1', role: 'PLATFORM', schoolId: null });

const call = (method, path, { token, body } = {}) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

/** Answer school.findFirst the way the database would, from a list of rows. */
const schoolsInTable = (rows) => {
  prismaFake.school.findFirst.mockImplementation(async ({ where = {} }) => rows.find((row) => {
    if (where.slug !== undefined && row.slug !== where.slug) return false;
    if (where.status !== undefined && row.status !== where.status) return false;
    if (where.id?.not !== undefined && row.id === where.id.not) return false;
    return true;
  }) ?? null);
  prismaFake.school.findMany.mockImplementation(async ({ where = {} }) => rows.filter((row) => {
    if (where.slug !== undefined && row.slug !== where.slug) return false;
    if (where.status !== undefined && row.status !== where.status) return false;
    if (where.id?.not !== undefined && row.id === where.id.not) return false;
    return true;
  }));
};

describe('a code is free until a school is approved on it', () => {
  it('does not count a PENDING registration as owning the code', async () => {
    // The whole point. San Joaquin is sitting unreviewed in the queue holding
    // `sjes-sanj`; San Jose types the same code into the form and must be told
    // it is available, because nobody has yet established that San Joaquin is
    // a school at all.
    schoolsInTable([{ id: WINNER, name: 'San Joaquin Elementary School', slug: CODE, status: 'PENDING' }]);

    const res = await call('GET', `/api/auth/school-code?code=${CODE}`);
    const body = await res.json();

    expect(body.available).toBe(true);
    expect(body.error).toBeNull();
  });

  it('does not count a REJECTED registration as owning the code either', async () => {
    // The permanent-hostage case: a refused — possibly invented — registration
    // must not keep a real school off its own obvious code.
    schoolsInTable([{ id: WINNER, name: 'San Joaquin Elementary School', slug: CODE, status: 'REJECTED' }]);

    const body = await (await call('GET', `/api/auth/school-code?code=${CODE}`)).json();

    expect(body.available).toBe(true);
  });

  it('counts an APPROVED school as owning it', async () => {
    schoolsInTable([{ id: WINNER, name: 'San Joaquin Elementary School', slug: CODE, status: 'APPROVED' }]);

    const body = await (await call('GET', `/api/auth/school-code?code=${CODE}`)).json();

    expect(body.available).toBe(false);
    expect(body.error).toContain(CODE);
    // Never says which school holds it — the route is unauthenticated, so
    // anything it reveals is revealed to everyone.
    expect(body.error).not.toContain('San Joaquin');
  });
});

describe('approving a school settles the code', () => {
  it('rejects the other registrations claiming it', async () => {
    prismaFake.school.findUnique.mockResolvedValue({
      id: WINNER, name: 'San Joaquin Elementary School', slug: CODE, status: 'PENDING',
    });
    schoolsInTable([
      { id: WINNER, name: 'San Joaquin Elementary School', slug: CODE, status: 'PENDING' },
      { id: LOSER, name: 'San Jose Elementary School', slug: CODE, status: 'PENDING' },
    ]);
    prismaFake.school.update.mockResolvedValue({ id: WINNER, name: 'San Joaquin Elementary School', slug: CODE, status: 'APPROVED' });

    const res = await call('POST', `/api/platform/schools/${WINNER}/approve`, { token: operatorToken() });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.rejectedForCode).toEqual([{ id: LOSER, name: 'San Jose Elementary School' }]);

    const rejection = prismaFake.school.update.mock.calls
      .find(([args]) => args.where.id === LOSER)?.[0];
    expect(rejection.data.status).toBe('REJECTED');
    // The claim is dropped, or the losing row goes straight back to being the
    // obstacle this change exists to remove.
    expect(rejection.data.slug).toBeNull();
    // The registrant reads this at login and gets no other explanation, so it
    // has to say the documents were not the problem.
    expect(rejection.data.rejectedReason).toContain(CODE);
    expect(rejection.data.rejectedReason).toMatch(/not the problem/i);
  });

  it('moves the losing school\'s addresses out of the winner\'s namespace', async () => {
    // User.email is unique platform-wide. Leaving the loser's principal on
    // `principal@admin.sjes-sanj.edu.ph` would give the winner a code whose
    // most obvious address they cannot create.
    prismaFake.school.findUnique.mockResolvedValue({
      id: WINNER, name: 'San Joaquin Elementary School', slug: CODE, status: 'PENDING',
    });
    schoolsInTable([
      { id: WINNER, name: 'San Joaquin Elementary School', slug: CODE, status: 'PENDING' },
      { id: LOSER, name: 'San Jose Elementary School', slug: CODE, status: 'PENDING' },
    ]);
    prismaFake.school.update.mockResolvedValue({ id: WINNER, name: 'San Joaquin', slug: CODE, status: 'APPROVED' });
    prismaFake.user.findMany.mockImplementation(async ({ where = {} }) => (
      where.schoolId === LOSER
        ? [{
            id: 'user-jose-principal',
            role: 'ADMIN',
            email: `principal@admin.${CODE}.edu.ph`,
            username: `principal@admin.${CODE}.edu.ph`,
          }]
        : []
    ));

    await call('POST', `/api/platform/schools/${WINNER}/approve`, { token: operatorToken() });

    const parked = prismaFake.user.update.mock.calls
      .find(([args]) => args.where.id === 'user-jose-principal')?.[0];
    expect(parked, 'the losing principal was never moved off the contested domain').toBeTruthy();
    // Parked, not deleted: the account is a real person's and the rejection is
    // often reversed. `.invalid` is RFC 2606 reserved, so it can never collide
    // with a domain accountDomain() issues.
    expect(parked.data.email).toBe(`principal@released-${LOSER.replace(/[^a-z0-9]/gi, '').slice(0, 12)}.invalid`);
    expect(parked.data.username).toBe(parked.data.email);
    expect(parked.data.email).not.toContain(CODE);
  });

  it('refuses to approve a school onto a code another approved school owns', async () => {
    // Not the registrant's mistake — the code was free when they chose it — so
    // the refusal is addressed to the operator and names the owner, which the
    // registration form deliberately never does.
    prismaFake.school.findUnique.mockResolvedValue({
      id: LOSER, name: 'San Jose Elementary School', slug: CODE, status: 'PENDING',
    });
    schoolsInTable([
      { id: WINNER, name: 'San Joaquin Elementary School', slug: CODE, status: 'APPROVED' },
      { id: LOSER, name: 'San Jose Elementary School', slug: CODE, status: 'PENDING' },
    ]);

    const res = await call('POST', `/api/platform/schools/${LOSER}/approve`, { token: operatorToken() });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('SCHOOL_CODE_OWNED');
    expect(body.error).toContain('San Joaquin Elementary School');
    // And nothing was written — an approval that cannot stand must not half-run.
    expect(prismaFake.school.update).not.toHaveBeenCalled();
  });

  it('leaves a school with no contest alone', async () => {
    prismaFake.school.findUnique.mockResolvedValue({
      id: WINNER, name: 'San Joaquin Elementary School', slug: CODE, status: 'PENDING',
    });
    schoolsInTable([{ id: WINNER, name: 'San Joaquin Elementary School', slug: CODE, status: 'PENDING' }]);
    prismaFake.school.update.mockResolvedValue({ id: WINNER, name: 'San Joaquin', slug: CODE, status: 'APPROVED' });

    const body = await (await call('POST', `/api/platform/schools/${WINNER}/approve`, { token: operatorToken() })).json();

    expect(body.success).toBe(true);
    expect(body.rejectedForCode).toEqual([]);
    expect(prismaFake.school.update).toHaveBeenCalledTimes(1);
  });
});
