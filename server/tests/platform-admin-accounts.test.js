import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

/**
 * The platform operator's admin-account routes.
 *
 *   GET /api/platform/schools/:schoolId/admins
 *   PUT /api/platform/schools/:schoolId/admins/:userId/password
 *   PUT /api/platform/schools/:schoolId/admins/:userId/demote
 *
 * These exist because schools no longer have a super admin of their own. Their
 * admins are peers and can remove each other, so the only way back from a
 * school locking itself out is from outside — which is this.
 *
 * That makes them the most dangerous routes on the platform: whoever can set an
 * admin's password can sign in as them at any school. What is pinned here is
 * the set of ways that could go wrong:
 *
 *   - reachable without an operator session, which would hand every school's
 *     console to anyone who found the URL;
 *   - reachable with the *old shared key*, which would quietly undo the move to
 *     named accounts and leave the audit trail anonymous again;
 *   - reachable by a school account, which would break tenancy outright;
 *   - acting on a user who is not an admin, or is an admin somewhere else —
 *     the schoolId in the path has to be checked, not decorative;
 *   - leaving a school with zero admins, which nobody inside it can undo;
 *   - a password change or demotion that the target's existing token outlives,
 *     since the token is what authorizes every request until it expires.
 *
 * Harness copied from admin-co-admins.test.js: a fake Prisma client installed
 * through db.js's swappable proxy before server.js is required.
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
  const fake = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop === 'then') return undefined;
      if (prop === '$transaction') return (a) => (typeof a === 'function' ? a(fake) : Promise.all(a));
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
  };
  return { fake, reset };
}

const SCHOOL = 'school-a';
const OTHER_SCHOOL = 'school-b';
const ADMIN = 'admin-1';
const CO_ADMIN = 'admin-2';
const TEACHER = 'teacher-1';
const OPERATOR = 'operator-1';
const KEY = 'test-platform-key';

/** The signed-in operator. Every route loads this row to name the actor in the
 *  audit trail, so it has to be findable in every test that expects a 200. */
const OPERATOR_ROW = {
  id: OPERATOR, name: 'Ana Operator', email: 'ana@tulongguro.com', role: 'PLATFORM',
};

let prismaFake;
// Kept out of the fake itself: its Proxy get-trap answers every string
// property with a fresh model, so a reset assigned onto it is unreachable.
let resetFake;
let restore;
let signToken;
let server;
let baseUrl;

beforeAll(async () => {
  process.env.PLATFORM_ADMIN_KEY = KEY;
  process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'test-secret-for-platform-admin-accounts';
  const { fake, reset } = makePrismaFake();
  prismaFake = fake;
  resetFake = reset;
  restore = require('../db.js').__setClientForTests(fake);
  const { app } = require('../server.js');
  ({ signToken } = require('../auth.js'));
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}, 60000);

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (restore) restore();
});

beforeEach(() => resetFake());

/**
 * Answer `user.findUnique` by id.
 *
 * Needed because each request looks a user up more than once — the revocation
 * check, then the operator's own row, then the target — and chaining
 * `mockResolvedValueOnce` would make every test depend on that call order.
 * The operator is always present; a test adds whoever else it is about.
 */
function stubUsers(extra = {}) {
  const rows = { [OPERATOR]: OPERATOR_ROW, ...extra };
  prismaFake.user.findUnique.mockImplementation(({ where }) =>
    Promise.resolve(rows[where?.id] ?? null));
}

const operatorToken = () => signToken({ id: OPERATOR, role: 'PLATFORM', schoolId: null });

/** A request carrying an operator session — the only credential these take. */
const asOperator = (method, path, body) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${operatorToken()}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

const EVERY_ROUTE = [
  ['GET', `/api/platform/schools/${SCHOOL}/admins`, undefined],
  ['PUT', `/api/platform/schools/${SCHOOL}/admins/${ADMIN}/password`, { password: 'new-pass-1' }],
  ['PUT', `/api/platform/schools/${SCHOOL}/admins/${ADMIN}/demote`, undefined],
];

describe('only an operator session gets in', () => {
  it('refuses every route with no credential at all', async () => {
    for (const [method, path, body] of EVERY_ROUTE) {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        ...(body !== undefined
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
      });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });

  it('refuses the old shared platform key', async () => {
    // The whole point of moving to accounts. If the key still worked here, the
    // audit trail would go back to being anonymous the moment anyone used it.
    for (const [method, path, body] of EVERY_ROUTE) {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          'x-platform-key': KEY,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });

  it('refuses a school admin holding a perfectly valid session', async () => {
    // Tenancy in the other direction: a school account must not reach the
    // platform, however legitimate its own token is.
    const schoolAdmin = signToken({ id: ADMIN, role: 'ADMIN', schoolId: SCHOOL });
    stubUsers({ [ADMIN]: { id: ADMIN, role: 'ADMIN', schoolId: SCHOOL } });
    for (const [method, path, body] of EVERY_ROUTE) {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${schoolAdmin}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });
});

describe('listing a school\'s admins', () => {
  it('returns them without the password hash', async () => {
    stubUsers();
    prismaFake.school.findUnique.mockResolvedValue({
      id: SCHOOL, name: 'Mabalacat ES', slug: 'mes-maba', status: 'APPROVED', ownerId: ADMIN,
    });
    prismaFake.user.findMany.mockResolvedValue([
      { id: ADMIN, name: 'Head Admin', email: 'head@admin.mes-maba.edu.ph', createdAt: new Date() },
      { id: CO_ADMIN, name: 'Second Admin', email: 'two@admin.mes-maba.edu.ph', createdAt: new Date() },
    ]);

    const res = await asOperator('GET', `/api/platform/schools/${SCHOOL}/admins`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.admins).toHaveLength(2);
    expect(body.admins[0]).not.toHaveProperty('password');
    // A label for the operator, never consulted by the authorization code.
    expect(body.admins[0].registeredSchool).toBe(true);
    expect(body.admins[1].registeredSchool).toBe(false);
  });

  it('404s for a school that does not exist', async () => {
    stubUsers();
    prismaFake.school.findUnique.mockResolvedValue(null);
    const res = await asOperator('GET', '/api/platform/schools/nope/admins');
    expect(res.status).toBe(404);
  });
});

describe('setting an admin password', () => {
  const approvedSchool = { id: SCHOOL, name: 'Mabalacat ES', status: 'APPROVED' };

  it('hashes it and ends every session that account has open', async () => {
    stubUsers({ [ADMIN]: { id: ADMIN, role: 'ADMIN', schoolId: SCHOOL, name: 'Head' } });
    prismaFake.school.findUnique.mockResolvedValue(approvedSchool);

    const res = await asOperator(
      'PUT', `/api/platform/schools/${SCHOOL}/admins/${ADMIN}/password`, { password: 'brand-new-pass' },
    );
    expect(res.status).toBe(200);

    const [call] = prismaFake.user.update.mock.calls;
    expect(call[0].where).toEqual({ id: ADMIN });
    // Never stored as typed.
    expect(call[0].data.password).not.toBe('brand-new-pass');
    expect(call[0].data.password).toMatch(/^\$2[aby]\$/);
    // The whole point of a reset is that the old credential stops working, and
    // a stateless token outlives the password unless this is set.
    expect(call[0].data.sessionsValidFrom).toBeInstanceOf(Date);
  });

  it('records which operator did it', async () => {
    // The reason named accounts exist. Before this the audit row said only
    // "TulongGuro platform operator", which cannot answer "who reset this".
    stubUsers({ [ADMIN]: { id: ADMIN, role: 'ADMIN', schoolId: SCHOOL, name: 'Head' } });
    prismaFake.school.findUnique.mockResolvedValue(approvedSchool);

    await asOperator(
      'PUT', `/api/platform/schools/${SCHOOL}/admins/${ADMIN}/password`, { password: 'brand-new-pass' },
    );
    expect(prismaFake.adminAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        event: 'ADMIN_PASSWORD_RESET',
        actorId: OPERATOR,
        actorName: OPERATOR_ROW.name,
      }),
    }));
  });

  it('refuses a password shorter than six characters', async () => {
    stubUsers({ [ADMIN]: { id: ADMIN, role: 'ADMIN', schoolId: SCHOOL } });
    prismaFake.school.findUnique.mockResolvedValue(approvedSchool);

    const res = await asOperator(
      'PUT', `/api/platform/schools/${SCHOOL}/admins/${ADMIN}/password`, { password: 'abc' },
    );
    expect(res.status).toBe(400);
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });

  it('refuses a target who is not an admin', async () => {
    stubUsers({ [TEACHER]: { id: TEACHER, role: 'TEACHER', schoolId: SCHOOL } });
    prismaFake.school.findUnique.mockResolvedValue(approvedSchool);

    const res = await asOperator(
      'PUT', `/api/platform/schools/${SCHOOL}/admins/${TEACHER}/password`, { password: 'brand-new-pass' },
    );
    expect(res.status).toBe(404);
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });

  it('refuses an admin who belongs to a different school', async () => {
    // The schoolId in the path is a check, not decoration: without it a stale
    // or mistyped id would quietly act on somebody at another school.
    stubUsers({ [ADMIN]: { id: ADMIN, role: 'ADMIN', schoolId: OTHER_SCHOOL } });
    prismaFake.school.findUnique.mockResolvedValue(approvedSchool);

    const res = await asOperator(
      'PUT', `/api/platform/schools/${SCHOOL}/admins/${ADMIN}/password`, { password: 'brand-new-pass' },
    );
    expect(res.status).toBe(404);
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });
});

describe('removing admin access', () => {
  const approvedSchool = { id: SCHOOL, name: 'Mabalacat ES', status: 'APPROVED' };

  it('demotes to teacher rather than deleting, and ends their sessions', async () => {
    // Deleting the row would take the account's classes, sections and grading
    // history with it. Demotion removes the console and keeps the person.
    stubUsers({ [CO_ADMIN]: { id: CO_ADMIN, role: 'ADMIN', schoolId: SCHOOL, name: 'Second' } });
    prismaFake.school.findUnique.mockResolvedValue(approvedSchool);
    prismaFake.user.count.mockResolvedValue(2);

    const res = await asOperator('PUT', `/api/platform/schools/${SCHOOL}/admins/${CO_ADMIN}/demote`);
    expect(res.status).toBe(200);
    expect(prismaFake.user.delete).not.toHaveBeenCalled();

    const [call] = prismaFake.user.update.mock.calls;
    expect(call[0].data.role).toBe('TEACHER');
    expect(call[0].data.sessionsValidFrom).toBeInstanceOf(Date);
  });

  it('refuses to remove the last admin of a school', async () => {
    // A school with no admin cannot add teachers, publish anything, or recover
    // itself — and an operator working down a list would not see it coming.
    stubUsers({ [ADMIN]: { id: ADMIN, role: 'ADMIN', schoolId: SCHOOL, name: 'Head' } });
    prismaFake.school.findUnique.mockResolvedValue(approvedSchool);
    prismaFake.user.count.mockResolvedValue(1);

    const res = await asOperator('PUT', `/api/platform/schools/${SCHOOL}/admins/${ADMIN}/demote`);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no admin/i);
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });
});

describe('operator sign-in', () => {
  it('refuses an operator posting to the school login form', async () => {
    // /api/auth/login takes the role from the request body, so without an
    // explicit refusal `role: 'PLATFORM'` there would mint a platform token
    // from the form every teacher and pupil can see.
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: OPERATOR_ROW.email, password: 'whatever', role: 'PLATFORM' }),
    });
    expect(res.status).toBe(401);
    // Refused before any lookup, so it cannot be used to probe for operators.
    expect(prismaFake.user.findFirst).not.toHaveBeenCalled();
  });

  it('gives the same answer for a wrong password and an address that is nobody', async () => {
    // Otherwise the response distinguishes the two and the login form becomes a
    // way to enumerate the team.
    prismaFake.user.findFirst.mockResolvedValue(null);
    const res = await fetch(`${baseUrl}/api/platform/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'whatever' }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Invalid credentials');
  });
});
