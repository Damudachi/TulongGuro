import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

/**
 * Removing a teacher who has already taught.
 *
 * DELETE /api/admin/:adminId/teachers/:teacherId used to refuse outright the
 * moment a teacher owned a class: "This teacher still has classes. Reassign or
 * delete them first." The instinct was right — a Class carries every activity,
 * submission, score and comment its pupils produced, and a Section carries the
 * pupils' accounts, so deleting the row takes all of it — but it left an admin
 * with no way to remove a teacher who had actually done any work, short of
 * reassigning a year's classes one at a time from another screen.
 *
 * So the refusal became a question: `?reassignTo=<teacherId>` hands the classes
 * (with their whole history) and the block sections (with their rosters) to a
 * named colleague, then removes the account, in one transaction.
 *
 * What is pinned here is the set of ways that could go wrong badly:
 *
 *   - a plain delete quietly destroying student work, which is the failure the
 *     original guard existed to prevent and must survive the new mode;
 *   - work being handed to somebody who is not a teacher, is not in this
 *     school, or is the account being deleted;
 *   - a successor silently ending up with two shells for the same section,
 *     subject and year — there is no database constraint behind that, so a bulk
 *     move would create it rather than throw;
 *   - the departing teacher's AI grading examples following them to a colleague,
 *     which would make the checker imitate a teacher who has left;
 *   - their badges cascading away and stripping Activity.badgeId off work the
 *     successor has just inherited.
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

process.env.AUTH_SECRET = 'teacher-handover-test-secret';
process.env.NODE_ENV = 'test';

const SCHOOL = 'school-a';
const OTHER_SCHOOL = 'school-b';
const ADMIN = 'admin-1';
const LEAVING = 'teacher-leaving';
const SUCCESSOR = 'teacher-successor';
const FOREIGN_TEACHER = 'teacher-elsewhere';
const A_STUDENT = 'student-1';

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

/** Counts the route asks for, keyed by which question is being asked. */
let realClassCount = 0;
let realStudentCount = 0;
let sectionsOwned = [];
let foreignClass = null;
/** Shells that would move, and shells the successor already holds. */
let movingShells = [];
let successorShells = [];

beforeEach(() => {
  resetPrisma();
  usersById.clear();
  usersById.set(ADMIN, {
    id: ADMIN, name: 'Head Admin', role: 'ADMIN', schoolId: SCHOOL, sessionsValidFrom: null,
    school: { id: SCHOOL, name: 'Test ES', status: 'APPROVED', ownerId: ADMIN },
  });
  usersById.set(LEAVING, {
    id: LEAVING, name: 'Ana Reyes', email: 'ana@teacher.edu.ph', role: 'TEACHER',
    schoolId: SCHOOL, sessionsValidFrom: null, _count: { taughtClasses: 2 },
  });
  usersById.set(SUCCESSOR, {
    id: SUCCESSOR, name: 'Ben Cruz', email: 'ben@teacher.edu.ph', role: 'TEACHER',
    schoolId: SCHOOL, sessionsValidFrom: null, _count: { taughtClasses: 1 },
  });
  usersById.set(FOREIGN_TEACHER, {
    id: FOREIGN_TEACHER, name: 'Cara Lim', role: 'TEACHER',
    schoolId: OTHER_SCHOOL, sessionsValidFrom: null, _count: { taughtClasses: 0 },
  });
  usersById.set(A_STUDENT, {
    id: A_STUDENT, name: 'A Learner', role: 'STUDENT', schoolId: SCHOOL, sessionsValidFrom: null,
  });

  // The default scenario: a teacher with two real classes and one section.
  realClassCount = 2;
  realStudentCount = 0;
  sectionsOwned = [{ id: 'section-1', name: 'Sampaguita' }];
  foreignClass = null;
  movingShells = [
    { id: 'class-1', name: 'English 6', sectionId: 'section-1', schoolYear: '2026-2027', subject: 'English', gradeLevel: 'Grade 6' },
    { id: 'class-2', name: 'Filipino 6', sectionId: 'section-1', schoolYear: '2026-2027', subject: 'Filipino', gradeLevel: 'Grade 6' },
  ];
  successorShells = [];

  prismaFake.user.findUnique.mockImplementation(async (args) =>
    usersById.get(args?.where?.id) || null);
  // Two different questions reach this method — "real students in their
  // sections" (with the DEMO- exclusion) and the hand-over head count (without
  // it) — and the fixtures never seed a demo learner, so both answer the same.
  prismaFake.user.count.mockImplementation(async () => realStudentCount);
  prismaFake.class.count.mockImplementation(async () => realClassCount);
  prismaFake.section.findMany.mockImplementation(async () => sectionsOwned);
  prismaFake.class.findFirst.mockImplementation(async () => foreignClass);
  prismaFake.class.findMany.mockImplementation(async (args) => {
    if (args?.where?.teacherId === SUCCESSOR) return successorShells;
    if (args?.where?.name?.contains === '[DEMO]') return [];   // the teardown's demo sweep
    return movingShells;
  });
  prismaFake.user.delete.mockResolvedValue({ id: LEAVING });
});

const token = () => signToken({ id: ADMIN, role: 'ADMIN', schoolId: SCHOOL });

const removeTeacher = (teacherId = LEAVING, reassignTo = null) =>
  fetch(
    `${baseUrl}/api/admin/${ADMIN}/teachers/${teacherId}` + (reassignTo ? `?reassignTo=${reassignTo}` : ''),
    { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } }
  );

// ───────────────────────────────────────────────────────────────────────────
// 1. A plain delete still refuses to destroy student work
// ───────────────────────────────────────────────────────────────────────────
describe('without a successor, the guards still hold', () => {
  it('refuses a teacher who still has classes, and offers the hand-over', async () => {
    const res = await removeTeacher();
    expect(res.status).toBe(400);
    const d = await res.json();
    expect(d.success).toBe(false);
    expect(d.code).toBe('HANDOVER_REQUIRED');
    expect(d.error).toMatch(/still has 2 classes/);
  });

  it('deletes nothing when it refuses', async () => {
    await removeTeacher();
    expect(prismaFake.user.delete).not.toHaveBeenCalled();
    expect(prismaFake.class.deleteMany).not.toHaveBeenCalled();
    expect(prismaFake.section.deleteMany).not.toHaveBeenCalled();
    expect(prismaFake.gradingExample.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses when their sections still hold real learners', async () => {
    realClassCount = 0;
    realStudentCount = 24;
    const d = await (await removeTeacher()).json();
    expect(d.code).toBe('HANDOVER_REQUIRED');
    expect(d.error).toMatch(/24 student account/);
    expect(prismaFake.user.delete).not.toHaveBeenCalled();
  });

  it("refuses when somebody else's class still uses their section", async () => {
    realClassCount = 0;
    realStudentCount = 0;
    foreignClass = {
      id: 'class-9', name: 'Science 6',
      teacher: { name: 'Ben Cruz' }, section: { name: 'Sampaguita' },
    };
    const d = await (await removeTeacher()).json();
    expect(d.code).toBe('HANDOVER_REQUIRED');
    expect(d.error).toMatch(/Science 6/);
    expect(d.error).toMatch(/Ben Cruz/);
    expect(prismaFake.user.delete).not.toHaveBeenCalled();
  });

  it('still removes a teacher who owns nothing real', async () => {
    realClassCount = 0;
    realStudentCount = 0;
    sectionsOwned = [];
    const res = await removeTeacher();
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.success).toBe(true);
    expect(d.handedOver).toBeNull();
    expect(prismaFake.user.delete).toHaveBeenCalledWith({ where: { id: LEAVING } });
    // Their own library goes with them on this path — there is nobody to give it to.
    expect(prismaFake.rubricTemplate.deleteMany).toHaveBeenCalled();
    expect(prismaFake.gradingExample.deleteMany).toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Handing the work over
// ───────────────────────────────────────────────────────────────────────────
describe('with a successor, the work moves and the account goes', () => {
  it('removes the teacher and reports what travelled', async () => {
    realStudentCount = 24;
    const res = await removeTeacher(LEAVING, SUCCESSOR);
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.success).toBe(true);
    expect(d.handedOver).toEqual({
      to: { id: SUCCESSOR, name: 'Ben Cruz' },
      classes: 2,
      sections: 1,
      students: 24,
    });
    expect(prismaFake.user.delete).toHaveBeenCalledWith({ where: { id: LEAVING } });
  });

  it('moves the classes and sections rather than deleting them', async () => {
    await removeTeacher(LEAVING, SUCCESSOR);
    expect(prismaFake.class.updateMany).toHaveBeenCalledWith({
      where: { teacherId: LEAVING }, data: { teacherId: SUCCESSOR },
    });
    expect(prismaFake.section.updateMany).toHaveBeenCalledWith({
      where: { teacherId: LEAVING }, data: { teacherId: SUCCESSOR },
    });
    // The failure this whole route exists to prevent: no pupil account and no
    // submission may be deleted on the hand-over path.
    expect(prismaFake.user.deleteMany).not.toHaveBeenCalled();
    expect(prismaFake.submission.deleteMany).not.toHaveBeenCalled();
    expect(prismaFake.section.deleteMany).not.toHaveBeenCalled();
  });

  it('moves the rubric library and their own badges with the classes', async () => {
    await removeTeacher(LEAVING, SUCCESSOR);
    expect(prismaFake.rubricTemplate.updateMany).toHaveBeenCalledWith({
      where: { teacherId: LEAVING }, data: { teacherId: SUCCESSOR },
    });
    // TeacherBadge cascades with its teacher and Activity.badgeId is ON DELETE
    // SET NULL, so leaving these behind would strip the custom badge off work
    // the successor has just inherited.
    expect(prismaFake.teacherBadge.updateMany).toHaveBeenCalledWith({
      where: { teacherId: LEAVING }, data: { teacherId: SUCCESSOR },
    });
    expect(prismaFake.rubricTemplate.deleteMany).not.toHaveBeenCalled();
  });

  it('never hands on the AI grading examples', async () => {
    await removeTeacher(LEAVING, SUCCESSOR);
    // They record how THIS teacher edited AI feedback and are used to calibrate
    // their own checking. Transferring them would make the AI copy someone who
    // is no longer at the school.
    expect(prismaFake.gradingExample.deleteMany).toHaveBeenCalledWith({ where: { teacherId: LEAVING } });
    expect(prismaFake.gradingExample.updateMany).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Who may receive it
// ───────────────────────────────────────────────────────────────────────────
describe('the successor has to be a teacher in this school', () => {
  const refused = async (id) => {
    const res = await removeTeacher(LEAVING, id);
    expect(res.status).toBe(400);
    expect(prismaFake.user.delete).not.toHaveBeenCalled();
    return (await res.json()).error;
  };

  it('refuses a teacher from another school', async () => {
    expect(await refused(FOREIGN_TEACHER)).toMatch(/your own school/i);
  });

  it('refuses a student', async () => {
    expect(await refused(A_STUDENT)).toMatch(/your own school/i);
  });

  it('refuses an admin', async () => {
    expect(await refused(ADMIN)).toMatch(/your own school/i);
  });

  it('refuses an id that matches nobody', async () => {
    expect(await refused('nobody-at-all')).toMatch(/your own school/i);
  });

  it('refuses handing the work to the account being removed', async () => {
    expect(await refused(LEAVING)).toMatch(/cannot be handed to the account being removed/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. The duplicate-shell collision
// ───────────────────────────────────────────────────────────────────────────
describe('a move that would give the successor two shells for one class', () => {
  it('is refused, naming the class that cannot move', async () => {
    // Ben already teaches this section's English for the same year. There is no
    // unique constraint behind this, so a bulk move would create the duplicate
    // silently and the gradebook would show the section twice for one subject.
    successorShells = [{
      id: 'class-77', name: 'English 6 (Ben)', sectionId: 'section-1',
      schoolYear: '2026-2027', subject: 'English', gradeLevel: 'Grade 6',
    }];
    const res = await removeTeacher(LEAVING, SUCCESSOR);
    expect(res.status).toBe(400);
    const d = await res.json();
    expect(d.error).toMatch(/English 6/);
    expect(d.error).toMatch(/Ben Cruz/);
    expect(prismaFake.user.delete).not.toHaveBeenCalled();
    expect(prismaFake.class.updateMany).not.toHaveBeenCalled();
  });

  it('allows a move where only the subject differs', async () => {
    // Same section and year, different subject — two teachers splitting a
    // section between them is ordinary, not a collision.
    successorShells = [{
      id: 'class-77', name: 'Science 6', sectionId: 'section-1',
      schoolYear: '2026-2027', subject: 'Science', gradeLevel: 'Grade 6',
    }];
    expect((await removeTeacher(LEAVING, SUCCESSOR)).status).toBe(200);
  });

  it('allows a move where only the school year differs', async () => {
    successorShells = [{
      id: 'class-77', name: 'English 6 (last year)', sectionId: 'section-1',
      schoolYear: '2025-2026', subject: 'English', gradeLevel: 'Grade 6',
    }];
    expect((await removeTeacher(LEAVING, SUCCESSOR)).status).toBe(200);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. The tenant boundary
// ───────────────────────────────────────────────────────────────────────────
describe('the tenant boundary', () => {
  it('refuses to remove a teacher from another school', async () => {
    const res = await removeTeacher(FOREIGN_TEACHER, SUCCESSOR);
    expect(res.status).toBe(404);
    expect(prismaFake.user.delete).not.toHaveBeenCalled();
  });
});
