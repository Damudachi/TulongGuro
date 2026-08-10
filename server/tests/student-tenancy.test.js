import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

/**
 * Whose student record a staff account may read.
 *
 * authorizePath lets teachers and admins through the /api/student/... area on
 * purpose — the teacher analytics screen charts a selected learner through the
 * same endpoint the learner's own dashboard uses, and a comment there says
 * ownership is checked in the handlers instead.
 *
 * It was not. Five handlers passed req.params.studentId straight to Prisma
 * with no school scoping, so the id in the URL was the only thing deciding
 * whose record came back — and releaseFilterFor withholds unreleased marks
 * from students but not from staff, so an outside teacher saw grades the
 * learner's own school had not published yet.
 *
 * Student ids are uuids, so this was never walkable. It did not need to be:
 * ids travel in gradebook URLs, in exports and through the transfer flow, and
 * a teacher who changes schools keeps every id they ever saw.
 *
 * The fixtures below are deliberately generous — the victim has a name, a
 * section and a graded submission — so that a handler which quietly returns an
 * empty shape cannot be mistaken for one that refused.
 *
 * Harness notes are the same as route-wiring.test.js: both modules load
 * through Node's own CJS cache so the db.js mutated here is the one server.js
 * resolves, and @prisma/client is deliberately not vi.mock'd.
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
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop === 'then') return undefined;
      if (prop === '$transaction') {
        return (arg) => (typeof arg === 'function' ? arg(fake) : Promise.all(arg));
      }
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

process.env.AUTH_SECRET = 'student-tenancy-test-secret';
process.env.NODE_ENV = 'test';

const SCHOOL_A = 'school-a';       // the caller's school
const SCHOOL_B = 'school-b';       // the victim's school
const VICTIM = 'student-in-school-b';

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

/** A learner in SCHOOL_B, with a name worth leaking and a released grade. */
const victim = () => ({
  id: VICTIM,
  name: 'Maria Santos',
  username: 'maria.santos',
  role: 'STUDENT',
  schoolId: SCHOOL_B,
  sectionId: 'section-b',
  sessionsValidFrom: null,
  section: {
    id: 'section-b',
    name: 'Grade 6 - Rizal',
    schoolId: SCHOOL_B,
    classes: [{ id: 'class-b', name: 'English 6', subject: 'English', activities: [] }],
  },
});

const victimSubmission = () => ({
  id: 'submission-b',
  studentId: VICTIM,
  status: 'GRADED',
  hitlScore: 91,
  aiScore: 88,
  hitlFeedback: 'Excellent thesis.',
  releasedAt: new Date(),
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  skillScores: null,
  rubricData: null,
  activity: {
    id: 'activity-b',
    title: 'Persuasive Essay',
    type: 'Essay',
    topic: 'Argument',
    points: 50,
    component: 'WW',
    classId: 'class-b',
    class: { id: 'class-b', name: 'English 6', subject: 'English', gradeLevel: 'Grade 6', teacherId: 'teacher-in-school-b' },
  },
});

/**
 * Everyone who is not the victim. Their school comes from their own id so a
 * caller named `...-in-school-b` really is in SCHOOL_B — the guard reads the
 * caller's school from the database rather than from their token, so a fixture
 * that answered one school for every id would make the same-school cases fail
 * for a reason that has nothing to do with the rule under test.
 */
const bystander = (id) => ({
  id,
  schoolId: id.endsWith(SCHOOL_B) ? SCHOOL_B : id.endsWith(SCHOOL_A) ? SCHOOL_A : null,
  sessionsValidFrom: null,
});

beforeEach(() => {
  resetPrisma();
  prismaFake.user.findUnique.mockImplementation(async ({ where }) => (
    where.id === VICTIM ? victim() : bystander(where.id)
  ));
  prismaFake.submission.findMany.mockImplementation(async ({ where }) =>
    (where?.studentId === VICTIM ? [victimSubmission()] : [])
  );
});

const get = (path, token) =>
  fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });

const STUDENT_READ_ROUTES = [
  ['dashboard', `/api/student/${VICTIM}/dashboard`],
  ['analytics', `/api/student/${VICTIM}/analytics`],
  ['subjects', `/api/student/${VICTIM}/subjects`],
  ['activities', `/api/student/${VICTIM}/activities`],
  ['skill progress', `/api/student/${VICTIM}/skill-progress`],
];

describe('a student record is readable only inside its own school', () => {
  for (const [label, path] of STUDENT_READ_ROUTES) {
    it(`refuses a teacher from another school reading ${label}`, async () => {
      const res = await get(path, signToken({ id: 'teacher-in-school-a', role: 'TEACHER', schoolId: SCHOOL_A }));
      expect(res.status).toBe(403);
      // The status alone is not the guarantee — assert the payload carries
      // nothing about the learner either.
      const body = await res.text();
      expect(body).not.toContain('Maria Santos');
      expect(body).not.toContain('Persuasive Essay');
    });

    it(`refuses an admin from another school reading ${label}`, async () => {
      const res = await get(path, signToken({ id: 'admin-in-school-a', role: 'ADMIN', schoolId: SCHOOL_A }));
      expect(res.status).toBe(403);
      const body = await res.text();
      expect(body).not.toContain('Maria Santos');
      expect(body).not.toContain('Persuasive Essay');
    });
  }
});

describe('the staff who should reach a learner still can', () => {
  for (const [label, path] of STUDENT_READ_ROUTES) {
    it(`lets a teacher in the same school read ${label}`, async () => {
      const res = await get(path, signToken({ id: 'teacher-in-school-b', role: 'TEACHER', schoolId: SCHOOL_B }));
      expect(res.status).toBe(200);
    });

    it(`lets an admin in the same school read ${label}`, async () => {
      const res = await get(path, signToken({ id: 'admin-in-school-b', role: 'ADMIN', schoolId: SCHOOL_B }));
      expect(res.status).toBe(200);
    });

    it(`lets the learner read their own ${label}`, async () => {
      const res = await get(path, signToken({ id: VICTIM, role: 'STUDENT', schoolId: SCHOOL_B }));
      expect(res.status).toBe(200);
    });
  }

  // A learner enrolled before schoolId was stamped on User carries it only via
  // their section. Reading that as "no school" and refusing would lock their
  // own teachers out of a roster that predates the column.
  it('falls back to the section school when the learner has no schoolId', async () => {
    prismaFake.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.id === VICTIM) return { ...victim(), schoolId: null };
      return bystander(where.id);
    });

    const res = await get(
      `/api/student/${VICTIM}/dashboard`,
      signToken({ id: 'teacher-in-school-b', role: 'TEACHER', schoolId: SCHOOL_B })
    );
    expect(res.status).toBe(200);
  });

  /**
   * A learner in an unaffiliated teacher's sandbox has no school on either
   * record, so there is no tenant boundary to compare against. Falling through
   * to allow is what access.js's own comment calls out as the bug it already
   * had to fix once, so the narrow answer applies here too: their section's
   * adviser may read them, and nobody else.
   */
  const sandboxLearner = () => ({
    ...victim(),
    schoolId: null,
    section: { ...victim().section, schoolId: null, teacherId: 'unaffiliated-teacher' },
  });

  it("lets the adviser read a sandbox learner who has no school anywhere", async () => {
    prismaFake.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.id === VICTIM) return sandboxLearner();
      return { id: where.id, schoolId: null, sessionsValidFrom: null };
    });

    const res = await get(
      `/api/student/${VICTIM}/dashboard`,
      signToken({ id: 'unaffiliated-teacher', role: 'TEACHER', schoolId: null })
    );
    expect(res.status).toBe(200);
  });

  it('refuses everyone else on a sandbox learner', async () => {
    prismaFake.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.id === VICTIM) return sandboxLearner();
      return { id: where.id, schoolId: SCHOOL_A, sessionsValidFrom: null };
    });

    const res = await get(
      `/api/student/${VICTIM}/dashboard`,
      signToken({ id: 'teacher-in-school-a', role: 'TEACHER', schoolId: SCHOOL_A })
    );
    expect(res.status).toBe(403);
  });
});

/**
 * The teacher-facing detail screen, which is a different route reached from
 * Analytics rather than from the learner's own dashboard.
 *
 * This one was half-right, and the half that worked disguised the half that
 * did not. Submissions are scoped to `class.teacherId = req.auth.sub`, so an
 * outside teacher saw no work — but the `findUnique` that loads the learner
 * had no scope at all, so the screen still named them. A manual pass found it
 * exactly that way: the learner's name and Student ID, and "no activity found"
 * underneath.
 *
 * A name and a login are not a lesser leak than a grade. The Student ID is
 * what the learner signs in with.
 */
describe('the teacher-facing student detail is scoped too', () => {
  const path = `/api/teacher/student/${VICTIM}/analytics`;

  it('refuses a teacher from another school', async () => {
    const res = await get(path, signToken({ id: 'teacher-in-school-a', role: 'TEACHER', schoolId: SCHOOL_A }));
    expect(res.status).toBe(403);
    const body = await res.text();
    expect(body).not.toContain('Maria Santos');
    expect(body).not.toContain('maria.santos');
  });

  it('still lets a teacher in the same school open it', async () => {
    const res = await get(path, signToken({ id: 'teacher-in-school-b', role: 'TEACHER', schoolId: SCHOOL_B }));
    expect(res.status).toBe(200);
  });
});

describe('a student still cannot read another student', () => {
  it('refuses a classmate in the same school', async () => {
    const res = await get(
      `/api/student/${VICTIM}/dashboard`,
      signToken({ id: 'classmate', role: 'STUDENT', schoolId: SCHOOL_B })
    );
    expect(res.status).toBe(403);
  });
});
