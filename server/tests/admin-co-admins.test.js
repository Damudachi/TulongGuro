import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

/**
 * Co-admins: a school admin granting admin to someone else in their school.
 *
 *   GET    /api/admin/:adminId/admins
 *   POST   /api/admin/:adminId/admins                    — create a new one
 *   POST   /api/admin/:adminId/admins/promote            — an existing teacher
 *   PUT    /api/admin/:adminId/admins/:userId/demote     — back to teacher
 *   PUT    /api/admin/:adminId/admins/:userId/password
 *
 * The routes themselves are ordinary CRUD. What is pinned here is the set of
 * ways they could go wrong badly:
 *
 *   - the school being taken from the request rather than the caller's row,
 *     which would turn "add a colleague" into "add yourself somewhere else";
 *   - a school reaching zero admins, which no school account can recover from;
 *   - a role change that the target's existing token outlives, since the token
 *     is what authorizes every request for up to another twelve hours;
 *   - promoting a teacher who still holds classes an admin cannot open.
 *
 * Harness copied from admin-reassign.test.js: a fake Prisma client installed
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
  return { fake, reset };
}

const { fake: prismaFake, reset: resetPrisma } = makePrismaFake();

process.env.AUTH_SECRET = 'admin-co-admins-test-secret';
process.env.NODE_ENV = 'test';

const SCHOOL = 'school-a';
const OTHER_SCHOOL = 'school-b';
const ADMIN = 'admin-1';
const CO_ADMIN = 'admin-2';
const FOREIGN_ADMIN = 'admin-elsewhere';
const FREE_TEACHER = 'teacher-free';      // no classes, no sections
const BUSY_TEACHER = 'teacher-busy';      // still teaching

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

const usersById = new Map();

beforeEach(() => {
  resetPrisma();
  usersById.clear();
  usersById.set(ADMIN, {
    id: ADMIN, name: 'Head Admin', email: 'head@school.ph', role: 'ADMIN',
    schoolId: SCHOOL, schoolName: 'Test ES', sessionsValidFrom: null,
    school: { id: SCHOOL, name: 'Test ES', status: 'APPROVED' },
  });
  usersById.set(CO_ADMIN, {
    id: CO_ADMIN, name: 'Registrar', email: 'registrar@school.ph', role: 'ADMIN',
    schoolId: SCHOOL, sessionsValidFrom: null,
  });
  usersById.set(FOREIGN_ADMIN, {
    id: FOREIGN_ADMIN, name: 'Other Admin', email: 'other@elsewhere.ph', role: 'ADMIN',
    schoolId: OTHER_SCHOOL, sessionsValidFrom: null,
  });
  usersById.set(FREE_TEACHER, {
    id: FREE_TEACHER, name: 'Ana Reyes', email: 'ana@school.ph', role: 'TEACHER',
    schoolId: SCHOOL, sessionsValidFrom: null,
    _count: { taughtClasses: 0, ownedSections: 0 },
  });
  usersById.set(BUSY_TEACHER, {
    id: BUSY_TEACHER, name: 'Ben Cruz', email: 'ben@school.ph', role: 'TEACHER',
    schoolId: SCHOOL, sessionsValidFrom: null,
    _count: { taughtClasses: 3, ownedSections: 1 },
  });

  prismaFake.user.findUnique.mockImplementation(async (args) => {
    const id = args?.where?.id;
    return usersById.get(id) || { sessionsValidFrom: null };
  });
  // Two admins is the ordinary state; individual tests override it.
  prismaFake.user.count.mockResolvedValue(2);
  prismaFake.user.create.mockImplementation(async (args) => ({ id: 'created-1', ...args.data }));
  prismaFake.user.update.mockImplementation(async (args) => ({ id: args.where.id, ...args.data }));
});

const adminToken = () => signToken({ id: ADMIN, role: 'ADMIN', schoolId: SCHOOL });

const call = (method, path, body) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${adminToken()}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

// ───────────────────────────────────────────────────────────────────────────
// 1. The tenant boundary
// ───────────────────────────────────────────────────────────────────────────
describe('a new admin lands in the creating admin\'s school', () => {
  it('ignores a schoolId supplied in the request body', async () => {
    const res = await call('POST', `/api/admin/${ADMIN}/admins`, {
      name: 'Principal', email: 'Principal@School.PH', password: 'temp-pass-1',
      schoolId: OTHER_SCHOOL,          // the attack: pick somebody else's school
      role: 'ADMIN',
    });
    expect(res.status).toBe(200);
    const written = prismaFake.user.create.mock.calls[0][0].data;
    expect(written.schoolId).toBe(SCHOOL);
    expect(written.role).toBe('ADMIN');
  });

  it('normalizes the email and uses it as the username, as the teacher route does', async () => {
    await call('POST', `/api/admin/${ADMIN}/admins`, {
      name: '  Principal  ', email: '  Principal@School.PH  ', password: 'temp-pass-1',
    });
    const written = prismaFake.user.create.mock.calls[0][0].data;
    expect(written.email).toBe('principal@school.ph');
    expect(written.username).toBe('principal@school.ph');
    expect(written.name).toBe('Principal');
  });

  it('never returns the password hash', async () => {
    const res = await call('POST', `/api/admin/${ADMIN}/admins`, {
      name: 'Principal', email: 'principal@school.ph', password: 'temp-pass-1',
    });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.admin.password).toBeUndefined();
  });

  it('refuses to touch an admin belonging to another school', async () => {
    const res = await call('PUT', `/api/admin/${ADMIN}/admins/${FOREIGN_ADMIN}/demote`);
    expect(res.status).toBe(404);
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. A school can never reach zero admins
// ───────────────────────────────────────────────────────────────────────────
describe('the last admin', () => {
  it('cannot be demoted', async () => {
    prismaFake.user.count.mockResolvedValue(1);
    // A sole admin has nobody else to demote, so this is the shape that would
    // strand a school: two admins, one already gone, the other demoting the
    // remaining one on a stale list.
    const res = await call('PUT', `/api/admin/${ADMIN}/admins/${CO_ADMIN}/demote`);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/at least one admin/i);
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });

  it('is counted at the moment of the demotion, not assumed', async () => {
    prismaFake.user.count.mockResolvedValue(2);
    const res = await call('PUT', `/api/admin/${ADMIN}/admins/${CO_ADMIN}/demote`);
    expect(res.status).toBe(200);
    expect(prismaFake.user.count).toHaveBeenCalledWith({
      where: { schoolId: SCHOOL, role: 'ADMIN' },
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Nobody may act on their own account here
// ───────────────────────────────────────────────────────────────────────────
describe('self-service is refused', () => {
  it('an admin cannot demote themselves', async () => {
    const res = await call('PUT', `/api/admin/${ADMIN}/admins/${ADMIN}/demote`);
    expect(res.status).toBe(400);
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });

  it('an admin cannot reset their own password from here', async () => {
    // /api/auth/change-password is the route for that, and it asks for the
    // current password first.
    const res = await call('PUT', `/api/admin/${ADMIN}/admins/${ADMIN}/password`, { password: 'new-pass-1' });
    expect(res.status).toBe(400);
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. A role change has to end the target's session
// ───────────────────────────────────────────────────────────────────────────
describe('role changes take effect immediately', () => {
  it('demotion sets TEACHER and revokes existing sessions', async () => {
    const res = await call('PUT', `/api/admin/${ADMIN}/admins/${CO_ADMIN}/demote`);
    expect(res.status).toBe(200);
    const args = prismaFake.user.update.mock.calls[0][0];
    expect(args.where.id).toBe(CO_ADMIN);
    expect(args.data.role).toBe('TEACHER');
    // Without this the demoted admin keeps the admin console until their token
    // expires — the token, not the row, is what authorizes each request.
    expect(args.data.sessionsValidFrom).toBeInstanceOf(Date);
  });

  it('promotion sets ADMIN and revokes existing sessions', async () => {
    const res = await call('POST', `/api/admin/${ADMIN}/admins/promote`, { teacherId: FREE_TEACHER });
    expect(res.status).toBe(200);
    const args = prismaFake.user.update.mock.calls[0][0];
    expect(args.where.id).toBe(FREE_TEACHER);
    expect(args.data.role).toBe('ADMIN');
    expect(args.data.sessionsValidFrom).toBeInstanceOf(Date);
  });

  it('a password reset revokes existing sessions too', async () => {
    const res = await call('PUT', `/api/admin/${ADMIN}/admins/${CO_ADMIN}/password`, { password: 'new-pass-1' });
    expect(res.status).toBe(200);
    const args = prismaFake.user.update.mock.calls[0][0];
    expect(args.data.sessionsValidFrom).toBeInstanceOf(Date);
    expect(args.data.password).not.toBe('new-pass-1');   // hashed, not stored raw
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. Promotion does not strand classes
// ───────────────────────────────────────────────────────────────────────────
describe('promoting a teacher', () => {
  it('is refused while they still hold classes or sections', async () => {
    const res = await call('POST', `/api/admin/${ADMIN}/admins/promote`, { teacherId: BUSY_TEACHER });
    expect(res.status).toBe(400);
    const { error } = await res.json();
    // The counts are named because "reassign these first" is unactionable
    // without knowing what "these" are.
    expect(error).toMatch(/3 class\(es\)/);
    expect(error).toMatch(/1 section\(s\)/);
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });

  it('is refused for someone who is not a teacher at this school', async () => {
    const res = await call('POST', `/api/admin/${ADMIN}/admins/promote`, { teacherId: FOREIGN_ADMIN });
    expect(res.status).toBe(404);
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 6. The cap
// ───────────────────────────────────────────────────────────────────────────
describe('the per-school admin cap', () => {
  it('blocks creating past it', async () => {
    prismaFake.user.count.mockResolvedValue(5);
    const res = await call('POST', `/api/admin/${ADMIN}/admins`, {
      name: 'Sixth', email: 'sixth@school.ph', password: 'temp-pass-1',
    });
    expect(res.status).toBe(400);
    expect(prismaFake.user.create).not.toHaveBeenCalled();
  });

  it('blocks promoting past it', async () => {
    prismaFake.user.count.mockResolvedValue(5);
    const res = await call('POST', `/api/admin/${ADMIN}/admins/promote`, { teacherId: FREE_TEACHER });
    expect(res.status).toBe(400);
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 7. The record of who granted what
// ───────────────────────────────────────────────────────────────────────────
describe('access changes are recorded', () => {
  it('writes an audit row naming both parties', async () => {
    await call('POST', `/api/admin/${ADMIN}/admins`, {
      name: 'Principal', email: 'principal@school.ph', password: 'temp-pass-1',
    });
    const row = prismaFake.adminAuditLog.create.mock.calls[0][0].data;
    expect(row).toMatchObject({
      schoolId: SCHOOL,
      event: 'ADMIN_CREATED',
      actorId: ADMIN,
      actorName: 'Head Admin',
      targetEmail: 'principal@school.ph',
    });
  });

  it('records a demotion', async () => {
    await call('PUT', `/api/admin/${ADMIN}/admins/${CO_ADMIN}/demote`);
    const row = prismaFake.adminAuditLog.create.mock.calls[0][0].data;
    expect(row.event).toBe('ADMIN_DEMOTED');
    expect(row.targetId).toBe(CO_ADMIN);
  });

  it('does not fail the action when the audit write throws', async () => {
    // Losing the note is bad; refusing a legitimate grant because the note
    // could not be written is worse.
    prismaFake.adminAuditLog.create.mockRejectedValue(new Error('table missing'));
    const res = await call('POST', `/api/admin/${ADMIN}/admins`, {
      name: 'Principal', email: 'principal@school.ph', password: 'temp-pass-1',
    });
    expect(res.status).toBe(200);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 8. Reading the list
// ───────────────────────────────────────────────────────────────────────────
describe('GET /admins', () => {
  it('lists only ADMIN rows of the caller\'s school, without password hashes', async () => {
    prismaFake.user.findMany.mockResolvedValue([
      { id: ADMIN, name: 'Head Admin', email: 'head@school.ph', createdAt: new Date() },
    ]);
    const res = await call('GET', `/api/admin/${ADMIN}/admins`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.admins).toHaveLength(1);
    expect(body.maxAdmins).toBeGreaterThan(1);
    expect(prismaFake.user.findMany.mock.calls[0][0].where).toEqual({ schoolId: SCHOOL, role: 'ADMIN' });
    expect(prismaFake.user.findMany.mock.calls[0][0].select.password).toBeUndefined();
  });
});
