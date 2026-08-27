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
 *   - promoting a teacher who still holds classes an admin cannot open;
 *   - the two guards that survived the removal of the per-school super admin:
 *     an admin acting on their own account, and a school reaching zero admins.
 *     Admins are peers now, so those two are the whole of what stops a school
 *     locking itself out from the inside;
 *   - a staff account landing on the wrong email domain, which is what now
 *     tells a teacher account from an admin one by looking at it.
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
/** The account that registered SCHOOL: its super admin, and the only one these routes obey. */
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
    id: ADMIN, name: 'Head Admin', email: 'head@admin.com', role: 'ADMIN',
    schoolId: SCHOOL, schoolName: 'Test ES', sessionsValidFrom: null,
    // ownerId is what makes this admin the super admin. requireAdminSchool
    // includes the school on the caller's row, so this is the copy the gate
    // actually reads — without it every route below 403s.
    school: { id: SCHOOL, name: 'Test ES', status: 'APPROVED', ownerId: ADMIN },
  });
  usersById.set(CO_ADMIN, {
    id: CO_ADMIN, name: 'Registrar', email: 'registrar@admin.com', role: 'ADMIN',
    schoolId: SCHOOL, sessionsValidFrom: null,
    school: { id: SCHOOL, name: 'Test ES', status: 'APPROVED', ownerId: ADMIN },
  });
  usersById.set(FOREIGN_ADMIN, {
    id: FOREIGN_ADMIN, name: 'Other Admin', email: 'other@admin.com', role: 'ADMIN',
    schoolId: OTHER_SCHOOL, sessionsValidFrom: null,
  });
  usersById.set(FREE_TEACHER, {
    id: FREE_TEACHER, name: 'Ana Reyes', email: 'ana.reyes@teacher.edu.ph', role: 'TEACHER',
    schoolId: SCHOOL, sessionsValidFrom: null,
    _count: { taughtClasses: 0, ownedSections: 0 },
  });
  usersById.set(BUSY_TEACHER, {
    id: BUSY_TEACHER, name: 'Ben Cruz', email: 'ben.cruz@teacher.edu.ph', role: 'TEACHER',
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
      name: 'Principal', email: 'Principal@Admin.COM', password: 'temp-pass-1',
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
      name: '  Principal  ', email: '  Principal@Admin.COM  ', password: 'temp-pass-1',
    });
    const written = prismaFake.user.create.mock.calls[0][0].data;
    expect(written.email).toBe('principal@admin.com');
    expect(written.username).toBe('principal@admin.com');
    expect(written.name).toBe('Principal');
  });

  it('never returns the password hash', async () => {
    const res = await call('POST', `/api/admin/${ADMIN}/admins`, {
      name: 'Principal', email: 'principal@admin.com', password: 'temp-pass-1',
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
    const res = await call('POST', `/api/admin/${ADMIN}/admins/promote`, {
      teacherId: FREE_TEACHER, adminEmail: 'ana.reyes@admin.com',
    });
    expect(res.status).toBe(200);
    const args = prismaFake.user.update.mock.calls[0][0];
    expect(args.where.id).toBe(FREE_TEACHER);
    expect(args.data.role).toBe('ADMIN');
    expect(args.data.sessionsValidFrom).toBeInstanceOf(Date);
    // The login moves with the role, so the old credential stops existing —
    // which is the second reason the session has to end here, beyond the role.
    expect(args.data.email).toBe('ana.reyes@admin.com');
    expect(args.data.username).toBe('ana.reyes@admin.com');
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
      name: 'Sixth', email: 'sixth@admin.com', password: 'temp-pass-1',
    });
    expect(res.status).toBe(400);
    expect(prismaFake.user.create).not.toHaveBeenCalled();
  });

  it('blocks promoting past it', async () => {
    prismaFake.user.count.mockResolvedValue(5);
    const res = await call('POST', `/api/admin/${ADMIN}/admins/promote`, {
      teacherId: FREE_TEACHER, adminEmail: 'ana.reyes@admin.com',
    });
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
      name: 'Principal', email: 'principal@admin.com', password: 'temp-pass-1',
    });
    const row = prismaFake.adminAuditLog.create.mock.calls[0][0].data;
    expect(row).toMatchObject({
      schoolId: SCHOOL,
      event: 'ADMIN_CREATED',
      actorId: ADMIN,
      actorName: 'Head Admin',
      targetEmail: 'principal@admin.com',
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
      name: 'Principal', email: 'principal@admin.com', password: 'temp-pass-1',
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
      { id: ADMIN, name: 'Head Admin', email: 'head@admin.com', createdAt: new Date() },
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

// ───────────────────────────────────────────────────────────────────────────
// 9. The history must not be able to take the list down with it
// ───────────────────────────────────────────────────────────────────────────
describe('when the access history cannot be read', () => {
  it('still returns the admin list', async () => {
    // How this was found: the first deploy of this feature ran against a
    // database where AdminAuditLog did not exist yet. The audit query threw,
    // the whole route 500d, and the page rendered "0 of 5 admins" to an admin
    // looking at their own account.
    prismaFake.adminAuditLog.findMany.mockRejectedValue(new Error('relation "AdminAuditLog" does not exist'));
    prismaFake.user.findMany.mockResolvedValue([
      { id: ADMIN, name: 'Head Admin', email: 'head@admin.com', createdAt: new Date() },
      { id: CO_ADMIN, name: 'Registrar', email: 'registrar@admin.com', createdAt: new Date() },
    ]);
    const res = await call('GET', `/api/admin/${ADMIN}/admins`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.admins).toHaveLength(2);
    expect(body.history).toEqual([]);
    // Flagged, so the page can say "unavailable" rather than claim the school
    // has never changed an admin.
    expect(body.historyUnavailable).toBe(true);
  });

  it('reports history as available when it simply is empty', async () => {
    prismaFake.adminAuditLog.findMany.mockResolvedValue([]);
    const res = await call('GET', `/api/admin/${ADMIN}/admins`);
    expect((await res.json()).historyUnavailable).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 10. Renaming yourself, and only yourself
// ───────────────────────────────────────────────────────────────────────────
describe('PUT /api/users/:userId/name', () => {
  const nameCall = (userId, body, token) =>
    fetch(`${baseUrl}/api/users/${userId}/name`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token || adminToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('updates the caller\'s own row', async () => {
    prismaFake.user.update.mockResolvedValue({ id: ADMIN, name: 'Maria Santos-Cruz' });
    const res = await nameCall(ADMIN, { name: '  Maria Santos-Cruz  ' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, name: 'Maria Santos-Cruz' });
    expect(prismaFake.user.update.mock.calls[0][0].where).toEqual({ id: ADMIN });
  });

  it('writes to the session id, never to an id from the path', async () => {
    // The path is already refused by authorizePath, so this asserts the second
    // line of defence: even reached directly, the handler has no target but the
    // caller. That is what makes "cannot rename another admin" structural
    // rather than a check someone could later get wrong.
    prismaFake.user.update.mockResolvedValue({ id: ADMIN, name: 'Whoever' });
    await nameCall(ADMIN, { name: 'Whoever' });
    const where = prismaFake.user.update.mock.calls[0][0].where;
    expect(where).toEqual({ id: ADMIN });
    expect(where.id).not.toBe(CO_ADMIN);
  });

  it('refuses a path naming another admin', async () => {
    const res = await nameCall(CO_ADMIN, { name: 'Renamed By Someone Else' });
    expect(res.status).toBe(403);
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });

  it('rejects an empty or whitespace-only name', async () => {
    const res = await nameCall(ADMIN, { name: '   ' });
    expect(res.status).toBe(400);
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });

  it('rejects a name past the length cap', async () => {
    const res = await nameCall(ADMIN, { name: 'x'.repeat(81) });
    expect(res.status).toBe(400);
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });

  it('is closed to teachers and students', async () => {
    // Their names identify them in rosters, gradebooks and released grades,
    // which other people depend on; an admin corrects those instead.
    for (const role of ['TEACHER', 'STUDENT']) {
      const token = signToken({ id: 'someone-1', role, schoolId: SCHOOL });
      const res = await nameCall('someone-1', { name: 'New Name' }, token);
      expect(res.status).toBe(403);
    }
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 11. Only the super admin may change who can reach the school
// ───────────────────────────────────────────────────────────────────────────
//
// The asymmetry these routes used to have is the whole reason for this block:
// with "any admin may add and remove any admin", a co-admin added for one term
// could remove the head teacher who added them, and the school had no way back
// — the remaining admin is a perfectly legitimate admin, so nothing looks wrong
// from outside.
describe('every admin of a school is a peer', () => {
  /**
   * A co-admin — an ordinary admin of the same school who did not register it.
   *
   * These four routes used to be the registrant's alone, behind a super-admin
   * gate. That tier is gone: a school's admins are peers, and the authority
   * that used to sit with whoever filled in the registration form now sits with
   * the platform operator, outside the school entirely.
   *
   * What is pinned here is that removing the tier did not also remove the two
   * guards that stop a school locking itself out.
   */
  const coAdminToken = () => signToken({ id: CO_ADMIN, role: 'ADMIN', schoolId: SCHOOL });

  const asCoAdmin = (method, path, body) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${coAdminToken()}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  it('lets a co-admin demote the admin who registered the school', async () => {
    // The case the old tier existed to forbid, now allowed on purpose: a school
    // whose registrant has left must be able to take their access away without
    // a support ticket.
    prismaFake.user.findUnique
      .mockResolvedValueOnce({ id: CO_ADMIN, role: 'ADMIN', schoolId: SCHOOL, school: { id: SCHOOL } })
      .mockResolvedValueOnce({ id: ADMIN, role: 'ADMIN', schoolId: SCHOOL });
    prismaFake.user.count.mockResolvedValue(2);

    const res = await asCoAdmin('PUT', `/api/admin/${CO_ADMIN}/admins/${ADMIN}/demote`);
    expect(res.status).toBe(200);
    expect(prismaFake.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: ADMIN },
      data: expect.objectContaining({ role: 'TEACHER' }),
    }));
  });

  it('still refuses to leave a school with no admin', async () => {
    // The guard that replaced the tier as the thing standing between a school
    // and being locked out of itself.
    prismaFake.user.findUnique
      .mockResolvedValueOnce({ id: CO_ADMIN, role: 'ADMIN', schoolId: SCHOOL, school: { id: SCHOOL } })
      .mockResolvedValueOnce({ id: ADMIN, role: 'ADMIN', schoolId: SCHOOL });
    prismaFake.user.count.mockResolvedValue(1);

    const res = await asCoAdmin('PUT', `/api/admin/${CO_ADMIN}/admins/${ADMIN}/demote`);
    expect(res.status).toBe(400);
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });

  it('still refuses an admin acting on their own account', async () => {
    // The other half of that guarantee. Without it, peer admins would be able
    // to demote themselves one after another until nobody was left.
    prismaFake.user.findUnique
      .mockResolvedValue({ id: CO_ADMIN, role: 'ADMIN', schoolId: SCHOOL, school: { id: SCHOOL } });

    for (const [method, path, body] of [
      ['PUT', `/api/admin/${CO_ADMIN}/admins/${CO_ADMIN}/demote`, undefined],
      ['PUT', `/api/admin/${CO_ADMIN}/admins/${CO_ADMIN}/password`, { password: 'new-pass-1' }],
    ]) {
      const res = await asCoAdmin(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(400);
    }
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });

  it('no longer reports a super admin on the list', async () => {
    prismaFake.user.findUnique.mockResolvedValue({
      id: CO_ADMIN, role: 'ADMIN', schoolId: SCHOOL, school: { id: SCHOOL },
    });
    prismaFake.user.findMany.mockResolvedValue([
      { id: ADMIN, name: 'Head Admin', email: 'head@admin.com', createdAt: new Date() },
    ]);
    prismaFake.adminAuditLog.findMany.mockResolvedValue([]);

    const res = await asCoAdmin('GET', `/api/admin/${CO_ADMIN}/admins`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    // The two fields the console used to hide its controls behind. Their
    // absence is what tells the client every admin may now use them.
    expect(body.superAdminId).toBeUndefined();
    expect(body.isSuperAdmin).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 12. The domain carries the role
// ───────────────────────────────────────────────────────────────────────────
//
// An admin creating accounts in bulk types one field by hand, and until now
// nothing checked it: a head teacher created as a TEACHER and a class adviser
// created as an ADMIN both went through, and the mistake surfaced weeks later
// as "why can't I see the admin console".
describe('staff email domains', () => {
  it('refuses an admin account that is not on @admin.com', async () => {
    for (const email of ['principal@teacher.edu.ph', 'principal@deped.gov.ph', 'principal@gmail.com']) {
      const res = await call('POST', `/api/admin/${ADMIN}/admins`, {
        name: 'Principal', email, password: 'temp-pass-1',
      });
      expect(res.status, email).toBe(400);
      expect((await res.json()).error).toMatch(/@admin\.com/);
    }
    expect(prismaFake.user.create).not.toHaveBeenCalled();
  });

  it('refuses a teacher account that is not on @teacher.edu.ph', async () => {
    for (const email of ['ana@admin.com', 'ana@deped.gov.ph', 'ana@gmail.com']) {
      const res = await call('POST', `/api/admin/${ADMIN}/teachers`, {
        name: 'Ana Reyes', email, password: 'temp-pass-1',
      });
      expect(res.status, email).toBe(400);
      expect((await res.json()).error).toMatch(/@teacher\.edu\.ph/);
    }
    expect(prismaFake.user.create).not.toHaveBeenCalled();
  });

  it('refuses an address that is not an address at all', async () => {
    for (const email of ['principal', 'principal@', '@admin.com', 'a@b@admin.com']) {
      const res = await call('POST', `/api/admin/${ADMIN}/admins`, {
        name: 'Principal', email, password: 'temp-pass-1',
      });
      expect(res.status, email).toBe(400);
    }
    expect(prismaFake.user.create).not.toHaveBeenCalled();
  });

  it('creates a teacher on the teacher domain', async () => {
    const res = await call('POST', `/api/admin/${ADMIN}/teachers`, {
      name: 'Ana Reyes', email: '  Ana.Reyes@Teacher.EDU.PH ', password: 'temp-pass-1',
    });
    expect(res.status).toBe(200);
    const written = prismaFake.user.create.mock.calls[0][0].data;
    expect(written.email).toBe('ana.reyes@teacher.edu.ph');
    expect(written.username).toBe('ana.reyes@teacher.edu.ph');
    expect(written.role).toBe('TEACHER');
  });

  it('will not promote a teacher without an admin address to move them to', async () => {
    // The one place the rule and an existing feature collide: a teacher is on
    // @teacher.edu.ph and is about to become an ADMIN, who must be on
    // @admin.com. Letting them keep the teacher address would make "an admin's
    // address ends in @admin.com" quietly untrue.
    const res = await call('POST', `/api/admin/${ADMIN}/admins/promote`, { teacherId: FREE_TEACHER });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('ADMIN_EMAIL_REQUIRED');
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });

  it('will not promote onto an address that is not on the admin domain', async () => {
    const res = await call('POST', `/api/admin/${ADMIN}/admins/promote`, {
      teacherId: FREE_TEACHER, adminEmail: 'ana.reyes@teacher.edu.ph',
    });
    expect(res.status).toBe(400);
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });

  it('will not promote onto an address somebody else already holds', async () => {
    prismaFake.user.findFirst.mockImplementation(async (args) => (
      args?.orderBy ? null : { id: 'someone-else', email: 'taken@admin.com' }
    ));
    const res = await call('POST', `/api/admin/${ADMIN}/admins/promote`, {
      teacherId: FREE_TEACHER, adminEmail: 'taken@admin.com',
    });
    expect(res.status).toBe(400);
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });

  it('leaves the address alone when the account is already on the admin domain', async () => {
    // An account created before the rule, or one demoted and promoted again.
    usersById.set(FREE_TEACHER, {
      ...usersById.get(FREE_TEACHER), email: 'ana.reyes@admin.com',
    });
    const res = await call('POST', `/api/admin/${ADMIN}/admins/promote`, { teacherId: FREE_TEACHER });
    expect(res.status).toBe(200);
    const args = prismaFake.user.update.mock.calls[0][0];
    expect(args.data.role).toBe('ADMIN');
    expect(args.data.email).toBeUndefined();
    expect(args.data.username).toBeUndefined();
  });
});
