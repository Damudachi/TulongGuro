import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

/**
 * Admin dashboard: what reassignment leaves behind.
 *
 * Two routes let an admin move ownership around:
 *
 *   PUT /api/admin/:adminId/classes/:classId    — the course shell's teacher
 *   PUT /api/admin/:adminId/sections/:sectionId — the section's adviser (+ name)
 *
 * Neither is wrong on its own. What neither accounts for is that `Class` and
 * `Section` carry *separate* owners, so moving one apart from the other
 * produces a shape the rest of the admin surface was written before: a course
 * shell taught by one teacher, sitting in a section advised by another.
 *
 * The tests below pin the behaviour that shape has to have. All three were red
 * when written; the last group covers the AI-side reset that the same "two
 * things that must be changed together" mistake had hit independently.
 *
 * Harness copied from route-wiring.test.js: a fake Prisma client is installed
 * through db.js's swappable proxy before server.js is ever required, and both
 * modules are pulled in through `createRequire` so this file mutates the same
 * CJS instance the app resolves. See that file's header for why `vi.mock` is
 * deliberately not used.
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

process.env.AUTH_SECRET = 'admin-reassign-test-secret';
process.env.NODE_ENV = 'test';

const SCHOOL = 'school-a';
const ADMIN = 'admin-1';
const LEAVING = 'teacher-leaving';   // the shell was reassigned away from them
const KEEPING = 'teacher-keeping';   // they now teach it
const SECTION = 'section-1';         // still advised by LEAVING

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
 * lookup — so it dispatches on the id and always carries sessionsValidFrom.
 */
const usersById = new Map();
beforeEach(() => {
  resetPrisma();
  usersById.clear();
  usersById.set(ADMIN, {
    id: ADMIN, role: 'ADMIN', schoolId: SCHOOL, sessionsValidFrom: null,
    school: { id: SCHOOL, name: 'Test ES', status: 'APPROVED' },
  });
  prismaFake.user.findUnique.mockImplementation(async (args) => {
    const id = args?.where?.id;
    return usersById.get(id) || { sessionsValidFrom: null };
  });
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
// 1. Removing a teacher whose section another teacher's class still uses
// ───────────────────────────────────────────────────────────────────────────

describe('DELETE /api/admin/:adminId/teachers/:teacherId — after a shell was reassigned', () => {
  /**
   * The sequence a school actually runs when a teacher leaves mid-year:
   *
   *   1. Admin reassigns their course shell to a colleague (the feature above).
   *      `Class.teacherId` moves; `Class.sectionId` does not, so the shell now
   *      sits in a section the departing teacher still advises.
   *   2. Admin removes the departing teacher.
   *
   * At step 2 the route's own guard passes — they have no classes left (the
   * shell moved) and their section's roster moved with it — so it proceeds to
   * `section.deleteMany({ teacherId })`. That row is still the parent of the
   * colleague's class, and `Class_sectionId_fkey` is ON DELETE RESTRICT
   * (0_init/migration.sql:280), so the delete throws.
   *
   * The throw is not the problem. The problem is where it lands: the teardown
   * is a bare sequence of deleteMany calls with no `$transaction` around it, so
   * by the time the constraint fires their rubric templates and grading
   * examples are already gone and there is no rollback. The admin sees a 500
   * and a teacher who still exists, minus their rubric library.
   *
   * The route should notice the foreign class and refuse before deleting
   * anything, the way it already refuses over students and over classes of the
   * teacher's own.
   */
  const setUpDepartingTeacher = () => {
    usersById.set(LEAVING, {
      id: LEAVING, role: 'TEACHER', schoolId: SCHOOL, name: 'Departing',
      sessionsValidFrom: null, _count: { taughtClasses: 0 },
    });
    prismaFake.class.count.mockResolvedValue(0);     // realClasses — the shell moved away
    prismaFake.user.count.mockResolvedValue(0);      // realStudents — roster moved too
    prismaFake.class.findMany.mockResolvedValue([]);
    prismaFake.section.findMany.mockResolvedValue([{ id: SECTION, name: 'Grade 6 - Rose' }]);
    // The reassigned shell: still parented by LEAVING's section, taught by KEEPING.
    prismaFake.class.findFirst.mockResolvedValue({
      id: 'class-1', name: 'English 6', teacherId: KEEPING, sectionId: SECTION,
      teacher: { name: 'Keeping' }, section: { name: 'Grade 6 - Rose' },
    });
    // The database refusing to orphan it, if the route gets that far.
    prismaFake.section.deleteMany.mockRejectedValue(
      Object.assign(new Error('Foreign key constraint failed on the field: `Class_sectionId_fkey`'), { code: 'P2003' })
    );
  };

  it('refuses when another teacher\'s class still uses one of their sections', async () => {
    setUpDepartingTeacher();

    const res = await call('DELETE', `/api/admin/${ADMIN}/teachers/${LEAVING}`);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('destroys nothing when it cannot finish', async () => {
    setUpDepartingTeacher();

    await call('DELETE', `/api/admin/${ADMIN}/teachers/${LEAVING}`);

    // The assertion that protects the teacher's work: a refused removal must
    // not have already emptied their rubric library on the way to the refusal.
    expect(prismaFake.rubricTemplate.deleteMany).not.toHaveBeenCalled();
    expect(prismaFake.gradingExample.deleteMany).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Renaming a section onto a name the same school year already uses
// ───────────────────────────────────────────────────────────────────────────

describe('PUT /api/admin/:adminId/sections/:sectionId — renaming', () => {
  /**
   * HANDOFF §8.1: `POST /api/teacher/sections` reuses an existing section by
   * (name, school, school year) — `findFirst`, with no orderBy. That is the fix
   * for block names being recycled between years, and it depends on the name
   * being unique inside a year.
   *
   * The admin rename path enforces nothing. Renaming "Grade 6 - Rose" to
   * "Grade 6 - Sampaguita" while a Sampaguita already exists for the same year
   * leaves two rows the reuse query cannot tell apart, and `findFirst` then
   * picks between them arbitrarily — so the next teacher to add a learner to
   * Sampaguita enrols them onto whichever row the planner happened to return.
   *
   * The create path already knows this rule. The rename path should ask the
   * same question.
   */
  it('refuses a name the same school year already uses', async () => {
    prismaFake.section.findUnique.mockResolvedValue({
      id: SECTION, name: 'Grade 6 - Rose', gradeLevel: 'Grade 6',
      schoolYear: '2026-2027', schoolId: SCHOOL, teacherId: KEEPING,
      teacher: { id: KEEPING, schoolId: SCHOOL },
    });
    // A different section already holding the name being moved onto.
    prismaFake.section.findFirst.mockResolvedValue({
      id: 'section-2', name: 'Grade 6 - Sampaguita', schoolYear: '2026-2027', schoolId: SCHOOL,
    });

    const res = await call('PUT', `/api/admin/${ADMIN}/sections/${SECTION}`, {
      name: 'Grade 6 - Sampaguita',
    });

    expect(res.status).toBe(400);
    expect(prismaFake.section.update).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Forgetting an AI pass completely
// ───────────────────────────────────────────────────────────────────────────

describe('UNGRADED_RESET — every column an AI pass writes', () => {
  const { UNGRADED_RESET } = require('../server.js');

  /**
   * The reset used to be written out by hand at each site, and each site listed
   * the fields it happened to remember. rubricScoreNote was added to the three
   * success paths and to none of the reset paths, so replacing the photo on a
   * flagged paper kept its red "the AI's own numbers disagree" banner while the
   * criteria it quoted were being set to null in the same statement.
   *
   * Prisma treats an omitted key as "leave this column alone", so a field
   * missing here is a field that survives a reset. Named explicitly rather than
   * asserted loosely: adding a flag means adding it in both places, and this is
   * what says so.
   */
  it('nulls every AI-written column, not just the ones anyone remembered', () => {
    expect(UNGRADED_RESET).toEqual({
      status: 'PENDING',
      aiScore: null,
      aiFeedback: null,
      readingStrategy: null,
      rubricData: null,
      skillScores: null,
      privacyViolation: false,
      gradeLevelAssumed: false,
      rubricParseFailed: false,
      scoreFeedbackMismatch: false,
      rubricScoreNote: null,
      scoreOutOfRange: false,
      gradedAt: null,
    });
  });

  it('carries no key Prisma would reject on Submission', () => {
    // A stray key here fails every upload at runtime, not at import.
    for (const key of Object.keys(UNGRADED_RESET)) {
      expect(typeof key).toBe('string');
      expect(key.startsWith('$')).toBe(false);
    }
  });
});
