import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

/**
 * How much work a low average has to stand on before a learner is called out.
 *
 * The early-warning panel on the teacher dashboard says "N students below 75% —
 * averaging below the passing grade". It used to say that off a single graded
 * activity, which is not an average and not a claim anyone can act on: the
 * first essay of a quarter is exactly where an unfamiliar format or a hard
 * rubric produces a number that says nothing about the child. A teacher who
 * graded one piece of work was told a third of their class was failing.
 *
 * The rule now needs grading.MIN_GRADED_FOR_RISK pieces of graded work before a
 * low average becomes a reason — the same evidence bar the trend rules beside
 * it already used, which need three scores before calling a slide.
 *
 * Driven through the real route rather than a helper, because the threshold is
 * only worth anything if it is what the dashboard actually receives.
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

process.env.AUTH_SECRET = 'early-warning-test-secret';
process.env.NODE_ENV = 'test';

const SCHOOL = 'school-a';
const TEACHER = 'teacher-1';
const STUDENT = 'student-1';

let baseUrl;
let server;
let signToken;
let restoreClient;
let grading;

beforeAll(async () => {
  restoreClient = require('../db.js').__setClientForTests(prismaFake);
  const { app } = require('../server.js');
  ({ signToken } = require('../auth.js'));
  grading = require('../grading.js');
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}, 60000);

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (restoreClient) restoreClient();
});

const CLASS = {
  id: 'class-1',
  name: 'English 6',
  subject: 'English',
  gradeLevel: 'Grade 6',
  sectionId: 'section-1',
  section: { id: 'section-1', name: 'Einstein', students: [{ id: STUDENT, name: 'Juan Dela Cruz', username: 'juan' }] },
};

/** A failing mark on its own activity — 40%, well under any passing grade. */
const failingSubmission = (n) => ({
  id: `sub-${n}`,
  studentId: STUDENT,
  status: 'GRADED',
  hitlScore: 40,
  aiScore: 40,
  createdAt: new Date(2026, 0, n),
  skillScores: null,
  activity: {
    id: `act-${n}`, title: `Essay ${n}`, type: 'Essay', points: 100,
    classId: CLASS.id, component: 'WW', rubric: null, classLesson: null,
    class: { subject: 'English', gradeLevel: 'Grade 6' },
  },
});

beforeEach(() => {
  resetPrisma();
  prismaFake.user.findUnique.mockResolvedValue({ id: TEACHER, schoolId: SCHOOL, sessionsValidFrom: null });
  prismaFake.class.findMany.mockResolvedValue([CLASS]);
});

const token = () => signToken({ id: TEACHER, role: 'TEACHER', schoolId: SCHOOL });

const analyticsWith = async (submissions) => {
  prismaFake.submission.findMany.mockResolvedValue(submissions);
  const res = await fetch(`${baseUrl}/api/teacher/${TEACHER}/analytics`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  expect(res.status).toBe(200);
  return res.json();
};

/** The "failing" entries only — the ones the red panel counts. */
const failingOf = (body) => (body.needsSupport || []).filter(e => e.severity === 'failing');

describe('a learner failing on very little evidence', () => {
  it('is not flagged off a single graded activity', async () => {
    const body = await analyticsWith([failingSubmission(1)]);

    expect(failingOf(body)).toEqual([]);
    expect(body.failingCount).toBe(0);
    // The badge in the sidebar reads this, so it has to agree.
    expect(body.warningCount).toBe(0);
  });

  it('is still not flagged on two', async () => {
    const body = await analyticsWith([failingSubmission(1), failingSubmission(2)]);
    expect(failingOf(body)).toEqual([]);
  });

  it('keeps reporting the average itself while it waits', async () => {
    // The number is not suppressed, only the accusation built on it — the
    // gradebook and the student's own row still show where they stand.
    const body = await analyticsWith([failingSubmission(1)]);
    const trend = body.studentTrends.find(t => t.student.id === STUDENT);
    expect(trend.avgPercent).toBeLessThan(75);
    expect(trend.gradedCount).toBe(1);
  });
});

describe('once there is enough work to speak of', () => {
  it('flags the learner at the third graded activity', async () => {
    const body = await analyticsWith([1, 2, 3].map(failingSubmission));

    const failing = failingOf(body);
    expect(failing).toHaveLength(1);
    expect(failing[0].student.id).toBe(STUDENT);
    expect(body.failingCount).toBe(1);
  });

  it('says how much work the call rests on', async () => {
    const body = await analyticsWith([1, 2, 3].map(failingSubmission));

    const [entry] = failingOf(body);
    expect(entry.gradedCount).toBe(3);
    expect(entry.reasons.find(r => r.kind === 'average').label).toMatch(/across 3 activities/);
  });

  it('publishes the bar it applied, so the UI cannot describe a different one', async () => {
    const body = await analyticsWith([failingSubmission(1)]);
    expect(body.summary.minGradedForRisk).toBe(grading.MIN_GRADED_FOR_RISK);
  });
});

describe('work that does not count toward the average', () => {
  it('does not count toward the threshold either', async () => {
    // Two real marks and an excused one. Excusing removes the activity from the
    // average entirely, so treating it as evidence would flag a learner on two
    // pieces of work through the back door.
    const excused = { ...failingSubmission(3), excusedAt: new Date(2026, 0, 3) };
    const body = await analyticsWith([failingSubmission(1), failingSubmission(2), excused]);

    expect(failingOf(body)).toEqual([]);
  });
});
