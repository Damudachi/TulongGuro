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
 *   - reachable without PLATFORM_ADMIN_KEY, which would hand every school's
 *     console to anyone who found the URL;
 *   - acting on a user who is not an admin, or is an admin somewhere else —
 *     the schoolId in the path has to be checked, not decorative;
 *   - leaving a school with zero admins, which nobody inside it can undo;
 *   - a password change or demotion that the target's existing token outlives,
 *     since the token is what authorizes every request for up to a week.
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
const KEY = 'test-platform-key';

let prismaFake;
// Kept out of the fake itself: its Proxy get-trap answers every string
// property with a fresh model, so a reset assigned onto it is unreachable.
let resetFake;
let restore;
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
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}, 60000);

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (restore) restore();
});

beforeEach(() => resetFake());

/** A request carrying the platform key, the only credential these routes take. */
const asOperator = (method, path, body) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'x-platform-key': KEY,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

describe('the platform key is the only way in', () => {
  it('refuses every route without a key', async () => {
    const attempts = [
      ['GET', `/api/platform/schools/${SCHOOL}/admins`, undefined],
      ['PUT', `/api/platform/schools/${SCHOOL}/admins/${ADMIN}/password`, { password: 'new-pass-1' }],
      ['PUT', `/api/platform/schools/${SCHOOL}/admins/${ADMIN}/demote`, undefined],
    ];
    for (const [method, path, body] of attempts) {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        ...(body !== undefined
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
      });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
    // Nothing was read or written on the way to the refusal.
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });

  it('refuses a wrong key', async () => {
    const res = await fetch(`${baseUrl}/api/platform/schools/${SCHOOL}/admins`, {
      headers: { 'x-platform-key': 'not-the-key' },
    });
    expect(res.status).toBe(401);
  });
});

describe('listing a school\'s admins', () => {
  it('returns them without the password hash', async () => {
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
    prismaFake.school.findUnique.mockResolvedValue(null);
    const res = await asOperator('GET', '/api/platform/schools/nope/admins');
    expect(res.status).toBe(404);
  });
});

describe('setting an admin password', () => {
  const approvedSchool = { id: SCHOOL, name: 'Mabalacat ES', status: 'APPROVED' };

  it('hashes it and ends every session that account has open', async () => {
    prismaFake.school.findUnique.mockResolvedValue(approvedSchool);
    prismaFake.user.findUnique.mockResolvedValue({ id: ADMIN, role: 'ADMIN', schoolId: SCHOOL, name: 'Head' });

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

  it('refuses a password shorter than six characters', async () => {
    prismaFake.school.findUnique.mockResolvedValue(approvedSchool);
    prismaFake.user.findUnique.mockResolvedValue({ id: ADMIN, role: 'ADMIN', schoolId: SCHOOL });

    const res = await asOperator(
      'PUT', `/api/platform/schools/${SCHOOL}/admins/${ADMIN}/password`, { password: 'abc' },
    );
    expect(res.status).toBe(400);
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });

  it('refuses a target who is not an admin', async () => {
    prismaFake.school.findUnique.mockResolvedValue(approvedSchool);
    prismaFake.user.findUnique.mockResolvedValue({ id: TEACHER, role: 'TEACHER', schoolId: SCHOOL });

    const res = await asOperator(
      'PUT', `/api/platform/schools/${SCHOOL}/admins/${TEACHER}/password`, { password: 'brand-new-pass' },
    );
    expect(res.status).toBe(404);
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });

  it('refuses an admin who belongs to a different school', async () => {
    // The schoolId in the path is a check, not decoration: without it a stale
    // or mistyped id would quietly act on somebody at another school.
    prismaFake.school.findUnique.mockResolvedValue(approvedSchool);
    prismaFake.user.findUnique.mockResolvedValue({ id: ADMIN, role: 'ADMIN', schoolId: OTHER_SCHOOL });

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
    prismaFake.school.findUnique.mockResolvedValue(approvedSchool);
    prismaFake.user.findUnique.mockResolvedValue({ id: CO_ADMIN, role: 'ADMIN', schoolId: SCHOOL, name: 'Second' });
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
    prismaFake.school.findUnique.mockResolvedValue(approvedSchool);
    prismaFake.user.findUnique.mockResolvedValue({ id: ADMIN, role: 'ADMIN', schoolId: SCHOOL, name: 'Head' });
    prismaFake.user.count.mockResolvedValue(1);

    const res = await asOperator('PUT', `/api/platform/schools/${SCHOOL}/admins/${ADMIN}/demote`);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no admin/i);
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });
});
