import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

/**
 * Admin transfer of one named learner:
 *
 *   POST /api/admin/:adminId/sections/:sectionId/students/:studentId/transfer
 *
 * The route has one job the roster-import path never had — asking what should
 * happen to the work a learner leaves behind — and the tests below pin the
 * three things that make that question trustworthy:
 *
 *   1. Asking writes NOTHING. A preview that had already moved the child would
 *      make "Cancel" a lie.
 *   2. Answering "migrate" archives nothing. Carry-over is the SectionTransfer
 *      row's job (carriedOverForClass walks it), so an extra write here would
 *      be the bug, not the feature.
 *   3. Answering "do not migrate" archives, and never deletes. These rows are
 *      a child's actual work; only the retention purge removes them for good.
 *
 * Plus the boundary that keeps a pupil inside their own school.
 *
 * Harness copied from admin-reassign.test.js: a fake Prisma client is installed
 * through db.js's swappable proxy before server.js is ever required, and both
 * modules are pulled in through `createRequire` so this file mutates the same
 * CJS instance the app resolves. See route-wiring.test.js's header for why
 * `vi.mock` is deliberately not used.
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

process.env.AUTH_SECRET = 'admin-transfer-test-secret';
process.env.NODE_ENV = 'test';

const SCHOOL = 'school-a';
const OTHER_SCHOOL = 'school-b';
const ADMIN = 'admin-1';
const STUDENT = 'student-1';
const FROM = 'section-from';
const TO = 'section-to';
const FOREIGN = 'section-foreign';   // a real section, in somebody else's school

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

/**
 * One `user.findUnique` serves three callers with different shapes — the auth
 * middleware's revocation check, requireAdminSchool, and the route's own
 * student lookup — so it dispatches on the id and always carries
 * sessionsValidFrom.
 */
const usersById = new Map();
const sectionsById = new Map();

beforeEach(() => {
  resetPrisma();
  usersById.clear();
  sectionsById.clear();

  usersById.set(ADMIN, {
    id: ADMIN, role: 'ADMIN', schoolId: SCHOOL, sessionsValidFrom: null,
    school: { id: SCHOOL, name: 'Test ES', status: 'APPROVED' },
  });
  usersById.set(STUDENT, {
    id: STUDENT, role: 'STUDENT', name: 'Dela Cruz, Juan', username: 'TES-25-0001',
    sectionId: FROM, schoolId: SCHOOL, sessionsValidFrom: null,
  });
  prismaFake.user.findUnique.mockImplementation(async (args) => {
    const id = args?.where?.id;
    return usersById.get(id) || { sessionsValidFrom: null };
  });

  sectionsById.set(FROM, {
    id: FROM, name: 'Rose', gradeLevel: 'Grade 6', schoolId: SCHOOL,
    teacher: { id: 'teacher-1', schoolId: SCHOOL },
  });
  sectionsById.set(TO, {
    id: TO, name: 'Lily', gradeLevel: 'Grade 6', schoolId: SCHOOL,
    teacher: { id: 'teacher-2', schoolId: SCHOOL },
  });
  sectionsById.set(FOREIGN, {
    id: FOREIGN, name: 'Orchid', gradeLevel: 'Grade 6', schoolId: OTHER_SCHOOL,
    teacher: { id: 'teacher-x', schoolId: OTHER_SCHOOL },
  });
  prismaFake.section.findUnique.mockImplementation(async (args) =>
    sectionsById.get(args?.where?.id) || null);

  // No classes and no activities on either side unless a test says otherwise,
  // so buildMovePreview and excusePreArrival both have nothing to chew on.
  prismaFake.class.findMany.mockResolvedValue([]);
  prismaFake.activity.findMany.mockResolvedValue([]);
  prismaFake.submission.findMany.mockResolvedValue([]);
  prismaFake.sectionTransfer.create.mockResolvedValue({ id: 'transfer-1', transferredAt: new Date() });
});

const adminToken = () => signToken({ id: ADMIN, role: 'ADMIN', schoolId: SCHOOL });

const transfer = (body) =>
  fetch(`${baseUrl}/api/admin/${ADMIN}/sections/${FROM}/students/${STUDENT}/transfer`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

/** How many REAL_WORK submissions the learner has in the section they leave. */
const withWork = (n) => prismaFake.submission.count.mockResolvedValue(n);

// ───────────────────────────────────────────────────────────────────────────
// 1. Asking
// ───────────────────────────────────────────────────────────────────────────

describe('when the learner has work in the section they are leaving', () => {
  it('asks before moving anything', async () => {
    withWork(4);

    const res = await transfer({ toSectionId: TO });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.needsChoice).toBe(true);
    expect(body.activityCount).toBe(4);
    expect(body.fromSection).toBe('Grade 6 — Rose');
    expect(body.toSection).toBe('Grade 6 — Lily');
    expect(body.preview).toBeTruthy();
  });

  /**
   * The load-bearing half of the previous test. A preview that had already
   * repointed User.sectionId would make the dialog's Cancel button a lie, and
   * an admin who closed it would have moved a child without answering the
   * question it was asking.
   */
  it('writes nothing while it is asking', async () => {
    withWork(4);

    await transfer({ toSectionId: TO });

    expect(prismaFake.user.update).not.toHaveBeenCalled();
    expect(prismaFake.submission.updateMany).not.toHaveBeenCalled();
    expect(prismaFake.submission.deleteMany).not.toHaveBeenCalled();
    expect(prismaFake.sectionTransfer.create).not.toHaveBeenCalled();
  });

  /** Nothing to decide, so nothing to ask: the first call does the move. */
  it('does not ask a learner with no submitted work', async () => {
    withWork(0);

    const body = await (await transfer({ toSectionId: TO })).json();

    expect(body.needsChoice).toBe(false);
    expect(body.migrated).toBe(true);
    expect(prismaFake.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sectionId: TO }) })
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Answering
// ───────────────────────────────────────────────────────────────────────────

describe('migrateActivities: true', () => {
  it('moves the learner and archives nothing', async () => {
    withWork(4);

    const body = await (await transfer({ toSectionId: TO, migrateActivities: true })).json();

    expect(body.success).toBe(true);
    expect(body.migrated).toBe(true);
    expect(body.archived).toBe(0);
    expect(prismaFake.submission.updateMany).not.toHaveBeenCalled();
  });

  /**
   * Carry-over is not a copy. It is this row: carriedOverForClass finds the
   * section they left by walking SectionTransfer.fromSectionId, then merges
   * any class matching on (subject, gradeLevel, schoolYear). Without the row
   * the work is unreachable from the new section however many submissions
   * exist.
   */
  it('records the move so the work can be found from the new section', async () => {
    withWork(4);

    await transfer({ toSectionId: TO, migrateActivities: true });

    expect(prismaFake.sectionTransfer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          studentId: STUDENT, fromSectionId: FROM, toSectionId: TO, actorId: ADMIN,
        }),
      })
    );
  });
});

describe('migrateActivities: false', () => {
  it('archives their work in the section they left', async () => {
    withWork(4);
    prismaFake.submission.updateMany.mockResolvedValue({ count: 4 });

    const body = await (await transfer({ toSectionId: TO, migrateActivities: false })).json();

    expect(body.success).toBe(true);
    expect(body.migrated).toBe(false);
    expect(body.archived).toBe(4);

    const [args] = prismaFake.submission.updateMany.mock.calls[0];
    expect(args.where).toMatchObject({
      studentId: STUDENT,
      archivedAt: null,
      activity: { class: { sectionId: FROM } },
    });
    expect(args.data.archivedAt).toBeInstanceOf(Date);
  });

  /**
   * The whole reason this is one `archivedAt` write rather than a bespoke
   * flag: every reader already agrees on what it means. countsAsGrade drops
   * archived rows out of every average, and carriedOverForClass filters
   * `archivedAt: null`, so the same write that clears the old gradebook is
   * what stops the work following them.
   */
  it('archives rather than deletes — the work is recoverable', async () => {
    withWork(4);
    prismaFake.submission.updateMany.mockResolvedValue({ count: 4 });

    await transfer({ toSectionId: TO, migrateActivities: false });

    const deleted = prismaFake.submission.deleteMany.mock.calls;
    // cleanUpTransferRows is allowed its delete — placeholder rows nobody
    // submitted against — but nothing may delete a learner's own submissions.
    for (const [args] of deleted) {
      expect(args.where).toMatchObject({ transferId: { not: null }, attemptCount: 0 });
    }
  });

  it('still moves the learner', async () => {
    withWork(4);
    prismaFake.submission.updateMany.mockResolvedValue({ count: 4 });

    await transfer({ toSectionId: TO, migrateActivities: false });

    expect(prismaFake.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sectionId: TO }) })
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Boundaries
// ───────────────────────────────────────────────────────────────────────────

describe('what a transfer may not do', () => {
  it('refuses a destination in another school', async () => {
    withWork(0);

    const res = await fetch(
      `${baseUrl}/api/admin/${ADMIN}/sections/${FROM}/students/${STUDENT}/transfer`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ toSectionId: FOREIGN, migrateActivities: true }),
      }
    );

    expect(res.status).toBe(404);
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });

  it('refuses a move into the section they are already in', async () => {
    withWork(0);

    const res = await transfer({ toSectionId: FROM });

    expect(res.status).toBe(400);
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });

  it('refuses with no destination chosen', async () => {
    withWork(0);

    const res = await transfer({});

    expect(res.status).toBe(400);
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });

  it('refuses a student who is not on this roster', async () => {
    withWork(0);
    usersById.set(STUDENT, { ...usersById.get(STUDENT), sectionId: 'somewhere-else' });

    const res = await transfer({ toSectionId: TO });

    expect(res.status).toBe(404);
    expect(prismaFake.user.update).not.toHaveBeenCalled();
  });
});
