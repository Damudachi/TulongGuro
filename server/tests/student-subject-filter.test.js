import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

/**
 * What one learner's analytics has to carry for the screen to be filterable by
 * subject.
 *
 * A self-contained teacher takes the same children for every subject, so this
 * page pooled a child's whole workload into one average, one points total and
 * one date-ordered list of everything they had ever handed in — Filipino and
 * Mathematics interleaved, with no way to read either on its own.
 *
 * Filtering happens on the client, because the payload already holds every
 * subject and a chip that refetches is a chip that spins. That makes these the
 * two things the server owes it: each submission has to say which subject it
 * belongs to, and the skills timeline — computed server-side from rubricData
 * the client never receives — has to be narrowable in the same way.
 *
 * Harness matches analytics-scope.test.js.
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
      if (prop === '$transaction') return (arg) => (typeof arg === 'function' ? arg(fake) : Promise.all(arg));
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

process.env.AUTH_SECRET = 'student-subject-filter-test-secret';
process.env.NODE_ENV = 'test';

const SCHOOL = 'school-a';
const TEACHER = 'teacher-1';
const STUDENT = 'student-1';

let baseUrl, server, signToken, restoreClient;

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
  // One shape answers every user.findUnique this path makes: the tenancy check
  // on the learner, the caller's own school, and the learner lookup the route
  // does for the header. Same school, so the guard passes.
  prismaFake.user.findUnique.mockResolvedValue({
    id: STUDENT, name: 'Ana Cruz', username: 'ana.cruz', schoolId: SCHOOL,
    section: { schoolId: SCHOOL, teacherId: TEACHER },
    sessionsValidFrom: null,
  });
});

const token = () => signToken({ id: TEACHER, role: 'TEACHER', schoolId: SCHOOL });
const get = (url) => fetch(`${baseUrl}${url}`, { headers: { Authorization: `Bearer ${token()}` } });

const submission = (id, subject, overrides = {}) => ({
  id,
  studentId: STUDENT,
  status: 'GRADED',
  aiScore: 80, hitlScore: null,
  excusedAt: null, excusedReason: null,
  imageUrl: null, aiFeedback: null, hitlFeedback: null,
  skillScores: null, rubricData: null,
  createdAt: new Date('2026-08-01'),
  activity: {
    id: `activity-${id}`, title: `Work ${id}`, type: 'Essay', points: 100,
    classId: 'class-1', component: 'WW', term: 1,
    class: { name: `${subject} 6-Rizal`, subject, gradeLevel: 'Grade 6' },
  },
  ...overrides,
});

describe('one learner\'s analytics says which subject each piece of work is in', () => {
  it('carries the subject on every submission', async () => {
    prismaFake.submission.findMany.mockResolvedValue([
      submission('s1', 'Filipino'),
      submission('s2', 'Mathematics'),
    ]);

    const body = await (await get(`/api/teacher/student/${STUDENT}/analytics`)).json();

    expect(body.success).toBe(true);
    expect(body.submissions.map(s => s.subject)).toEqual(['Filipino', 'Mathematics']);
  });

  it('sends the subject as its own field, not folded into the class name', async () => {
    // className is a display name a teacher is free to write anything into —
    // "6-Rizal AM", "Ma'am Dela Cruz's class" — so a client parsing the subject
    // back out of it would filter correctly only on the schools that happened
    // to name their classes the way the parser expected.
    prismaFake.submission.findMany.mockResolvedValue([
      { ...submission('s1', 'Science'), activity: { ...submission('s1', 'Science').activity, class: { name: '6-Rizal AM', subject: 'Science', gradeLevel: 'Grade 6' } } },
    ]);

    const [row] = (await (await get(`/api/teacher/student/${STUDENT}/analytics`)).json()).submissions;

    expect(row.subject).toBe('Science');
    expect(row.className).toBe('6-Rizal AM');
  });

  it('pairs the subject with its grade level, which is what selects a policy', async () => {
    // DepEd component weights are set per subject PER GRADE LEVEL, and
    // gradeBreakdown is keyed on both. A subject sent without its grade level
    // could not be matched back to its own working.
    prismaFake.submission.findMany.mockResolvedValue([submission('s1', 'Filipino')]);

    const body = await (await get(`/api/teacher/student/${STUDENT}/analytics`)).json();

    expect(body.submissions[0].gradeLevel).toBe('Grade 6');
    expect(body.gradeBreakdown[0]).toMatchObject({ subject: 'Filipino', gradeLevel: 'Grade 6' });
  });

  it('leaves the subject null rather than guessing when the class has none', async () => {
    // Nullable in the schema, so the client's chip row has to be built from
    // what is actually there. Inventing a label here would put a chip on screen
    // that filters to a subject nobody teaches.
    prismaFake.submission.findMany.mockResolvedValue([submission('s1', null)]);

    const body = await (await get(`/api/teacher/student/${STUDENT}/analytics`)).json();

    expect(body.submissions[0].subject).toBeNull();
  });
});

describe('the skills timeline narrows to one subject', () => {
  /** The `where` the route handed to submission.findMany. */
  const where = () => prismaFake.submission.findMany.mock.calls[0][0].where;

  it('filters on the activity\'s own class subject when asked', async () => {
    await get(`/api/student/${STUDENT}/skill-progress?subject=Mathematics`);

    expect(where()).toMatchObject({
      studentId: STUDENT,
      status: 'GRADED',
      activity: { class: { subject: 'Mathematics' } },
    });
  });

  it('reads the whole record when no subject is named', async () => {
    // The same endpoint draws the chart on the learner's own dashboard, where
    // their whole record is the point — so the filter has to stay optional.
    await get(`/api/student/${STUDENT}/skill-progress`);

    expect(where().activity).toBeUndefined();
    expect(where().studentId).toBe(STUDENT);
  });

  it('keeps the rubric-data requirement when a subject is named', async () => {
    // The subject clause is nested under `activity`, which is also where a
    // careless spread would land — this pins that adding it did not displace
    // the conditions the timeline is actually built from.
    await get(`/api/student/${STUDENT}/skill-progress?subject=Filipino`);

    expect(where().rubricData).toEqual({ not: null });
    expect(where().status).toBe('GRADED');
  });
});
