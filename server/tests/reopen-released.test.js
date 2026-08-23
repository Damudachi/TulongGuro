import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

/**
 * Taking a result back, so a mistake found after release can still be fixed.
 *
 * Release used to be a one-way door: /analyze, /upload and DELETE all refuse a
 * released paper, each for the same good reason — a child has seen the mark and
 * it must not change under them silently. Together they left the one mistake
 * teachers actually make (validating and releasing the wrong paper, or the
 * right paper against the wrong rubric) with no route back through the app.
 *
 * /reopen is that route, and these pin what it does and does not undo. The
 * important asymmetry: it withdraws the release and the validation, because
 * those are the locks; it does NOT touch the marking, because a teacher who
 * reopens to look again should still see what they had decided.
 *
 * Harness is the fake-Prisma one from grading-prompt-contents.test.js.
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

const { fake: prismaFake, reset: resetPrisma } = makePrismaFake();

process.env.AUTH_SECRET = 'reopen-test-secret';
process.env.NODE_ENV = 'test';
process.env.GEMINI_MIN_SPACING_MS = '0';

const T1 = 'teacher-t1';
const OTHER_TEACHER = 'teacher-t2';
const SUBMISSION = 'submission-1';
const STUDENT = 'student-1';
const ACTIVITY = 'activity-1';

let baseUrl;
let server;
let signToken;
let restoreClient;

const submissionIn = (state) => ({
  id: SUBMISSION,
  studentId: STUDENT,
  activityId: ACTIVITY,
  hitlScore: 86,
  hitlFeedback: 'Clear opening paragraph.',
  aiScore: 84,
  imageUrl: '/uploads/x.jpg',
  ...state,
  activity: { title: 'Looking Back: Understanding Flashbacks', class: { teacherId: T1 } },
});

const RELEASED = { status: 'GRADED', releasedAt: new Date('2026-08-23T02:00:00Z') };
const VALIDATED = { status: 'GRADED', releasedAt: null };
const PENDING = { status: 'PENDING', releasedAt: null };

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
  prismaFake.user.findUnique.mockResolvedValue({ sessionsValidFrom: null });
  prismaFake.submission.update.mockResolvedValue({ id: SUBMISSION });
});

async function reopen(actor = T1) {
  const token = signToken({ id: actor, role: 'TEACHER', schoolId: 'school-a' });
  const res = await fetch(`${baseUrl}/api/teacher/submissions/${SUBMISSION}/reopen`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: await res.json() };
}

/** The `data` of the write the route made, or null if it made none. */
const written = () => prismaFake.submission.update.mock.calls[0]?.[0]?.data ?? null;

describe('POST /api/teacher/submissions/:id/reopen', () => {
  it('withdraws a released result and puts it back in the queue', async () => {
    prismaFake.submission.findUnique.mockResolvedValue(submissionIn(RELEASED));
    const { status, body } = await reopen();
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(written()).toMatchObject({ releasedAt: null, status: 'PENDING' });
  });

  it('leaves the marking alone — reopening is not unmarking', async () => {
    // A teacher who reopens to look again should still see what they decided.
    // The replacement upload clears the mark, because at that point it belongs
    // to a different paper; that is that route's job, not this one's.
    prismaFake.submission.findUnique.mockResolvedValue(submissionIn(RELEASED));
    await reopen();
    const data = written();
    expect(data).not.toHaveProperty('hitlScore');
    expect(data).not.toHaveProperty('hitlFeedback');
    expect(data).not.toHaveProperty('aiScore');
  });

  it('tells the learner, who had already seen the grade', async () => {
    prismaFake.submission.findUnique.mockResolvedValue(submissionIn(RELEASED));
    await reopen();
    expect(prismaFake.notification.create).toHaveBeenCalled();
    const { data } = prismaFake.notification.create.mock.calls[0][0];
    expect(data.userId).toBe(STUDENT);
    expect(data.type).toBe('GRADE_REOPENED');
  });

  it('records who took it back, alongside the release it undoes', async () => {
    // The RELEASED row stays — it carries the policy snapshot of what the
    // student was actually shown — and this is written next to it.
    prismaFake.submission.findUnique.mockResolvedValue(submissionIn(RELEASED));
    await reopen();
    const events = prismaFake.gradingAuditLog.create.mock.calls.map(c => c[0].data);
    expect(events.some(e => e.event === 'REOPENED' && e.actorId === T1)).toBe(true);
  });

  it('also reopens a validated paper that was never released', async () => {
    // This is what makes "Re-check with AI" work on a validated paper: /analyze
    // refuses anything that is not PENDING, so without this the button would
    // reopen nothing and then be refused by the route it had just cleared.
    prismaFake.submission.findUnique.mockResolvedValue(submissionIn(VALIDATED));
    const { body } = await reopen();
    expect(body.success).toBe(true);
    expect(body.alreadyOpen).toBeUndefined();
    expect(written()).toMatchObject({ status: 'PENDING' });
  });

  it('does not alarm a learner about a grade they were never shown', async () => {
    // Reopening a validated-but-unreleased paper takes nothing away from them.
    prismaFake.submission.findUnique.mockResolvedValue(submissionIn(VALIDATED));
    await reopen();
    expect(prismaFake.notification.create).not.toHaveBeenCalled();
  });

  it('is a no-op on a paper that is already open', async () => {
    // Two clicks on the same button, or a stale roster. Reported, not failed —
    // and crucially it must not write, or it would stamp PENDING over PENDING
    // and log a reopen that never happened.
    prismaFake.submission.findUnique.mockResolvedValue(submissionIn(PENDING));
    const { status, body } = await reopen();
    expect(status).toBe(200);
    expect(body.alreadyOpen).toBe(true);
    expect(prismaFake.submission.update).not.toHaveBeenCalled();
    expect(prismaFake.gradingAuditLog.create).not.toHaveBeenCalled();
  });

  it("refuses another teacher's paper", async () => {
    prismaFake.submission.findUnique.mockResolvedValue(submissionIn(RELEASED));
    const { status } = await reopen(OTHER_TEACHER);
    expect(status).toBe(403);
    expect(prismaFake.submission.update).not.toHaveBeenCalled();
  });

  it('404s on a submission that does not exist', async () => {
    prismaFake.submission.findUnique.mockResolvedValue(null);
    const { status } = await reopen();
    expect(status).toBe(404);
  });
});
