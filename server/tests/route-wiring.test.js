import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

/**
 * Route wiring for the two rules that already have pure unit tests.
 *
 * score-validation.test.js proves `parseScore` refuses 500, -5, 'abc', null,
 * '' and true. access.test.js proves `staffMayAccess` keeps another school —
 * and an unaffiliated stranger — out of a class. Neither says anything about
 * whether the routes actually *call* those functions, or what HTTP status a
 * rejection turns into. That gap is the whole of HANDOFF.md's P3 and P8, which
 * were written as manual REST-client steps.
 *
 * A route could pass every pure test and still write the grade, because the
 * defect being guarded against in both cases was a missing call, not a wrong
 * answer. So these drive the real Express app over real HTTP.
 *
 * ── No database ──
 * db.js hands the application a Proxy over a swappable Prisma client, and the
 * fake below is installed before server.js is ever required. Two details make
 * that reliable:
 *
 *   1. Both modules are loaded through `createRequire`, i.e. Node's own CJS
 *      cache, so the db.js this file mutates is the same instance server.js
 *      resolves. Importing them through Vitest's module runner instead would
 *      produce a second copy and the swap would silently do nothing.
 *   2. `vi.mock('@prisma/client')` is deliberately *not* used. Vitest cannot
 *      rewrite a `require()` inside a CommonJS file, so it is ignored without
 *      warning — an earlier version of this file mocked the module, appeared
 *      to work, and was in fact querying the production database.
 *
 * The assertions that matter most are the negative ones: `submission.update`
 * must never be called.
 */

const require = createRequire(import.meta.url);

/**
 * A stand-in Prisma client. Any model the app touches answers with a vi.fn();
 * defaults are the "nothing found" shapes and a test overrides only what it
 * cares about, so the fake never has to track an 8k-line file's full surface.
 */
function makePrismaFake() {
  const models = new Map();
  const defaults = {
    findUnique: null, findFirst: null, findMany: [], count: 0,
    create: {}, update: {}, updateMany: { count: 0 },
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
      if (prop === 'then') return undefined;              // must not look thenable
      if (prop === '$transaction') {
        return (arg) => (typeof arg === 'function' ? arg(fake) : Promise.all(arg));
      }
      // $queryRaw is a tagged template returning rows, not a model namespace,
      // so it is held apart from `models` — the reset loop below walks those
      // expecting an object of methods. The login route reads `.length` off
      // the result, hence the array default.
      if (prop === '$queryRaw') return rawQuery;
      if (prop.startsWith('$')) return () => Promise.resolve(undefined);
      if (!models.has(prop)) models.set(prop, makeModel());
      return models.get(prop);
    },
  });

  // Returned alongside rather than hung off the proxy: the get trap answers
  // every string property with a model, so a `fake.__reset` would be shadowed.
  const reset = () => {
    for (const model of models.values()) {
      for (const [method, value] of Object.entries(defaults)) {
        model[method].mockReset().mockResolvedValue(value);
      }
    }
    rawQuery.mockReset().mockResolvedValue([]);
  };

  return { fake, reset, rawQuery };
}

const { fake: prismaFake, reset: resetPrisma, rawQuery } = makePrismaFake();

// Set before server.js loads: auth.js must sign with the key we mint against,
// and server.js pulls in dotenv, which does not overwrite an already-set
// variable — so this wins over whatever server/.env carries.
process.env.AUTH_SECRET = 'route-wiring-test-secret';
process.env.NODE_ENV = 'test';

const SCHOOL_A = 'school-a';
const SCHOOL_B = 'school-b';
const T1 = 'teacher-t1';          // owns the class in every fixture below
const T2 = 'teacher-t2';          // unrelated staff account
const ACTIVITY = 'activity-1';
const SUBMISSION = 'submission-1';

let baseUrl;
let server;
let signToken;
let restoreClient;

beforeAll(async () => {
  // Swap the client in before the route table is built.
  restoreClient = require('../db.js').__setClientForTests(prismaFake);

  const { app } = require('../server.js');
  ({ signToken } = require('../auth.js'));

  // app.listen directly rather than the exported startServer(): that one also
  // runs verifyStorage(), which would talk to Supabase.
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
  // No user has ended their sessions, so no token reads as revoked.
  prismaFake.user.findUnique.mockResolvedValue({ sessionsValidFrom: null });
});

const tokenFor = ({ id, role = 'TEACHER', schoolId = null }) => signToken({ id, role, schoolId });

const call = (method, path, { token, body } = {}) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

/** A class as CLASS_TENANCY_SELECT loads it, owned by T1. */
const classOwnedByT1 = (sectionSchool) => ({
  id: 'class-1',
  name: 'Class',
  teacherId: T1,
  section: { schoolId: sectionSchool },
  teacher: { schoolId: sectionSchool },
});

// ───────────────────────────────────────────────────────────────────
// P3 — PUT /api/teacher/submissions/:id/grade rejects an invalid score
// ───────────────────────────────────────────────────────────────────

describe('P3: the validate endpoint refuses a score it cannot trust', () => {
  const url = `/api/teacher/submissions/${SUBMISSION}/grade`;

  const gradeableSubmission = () => ({
    id: SUBMISSION,
    aiScore: null,                 // keeps the mini-RAG capture out of the way
    aiFeedback: null,
    activity: { type: 'Essay', class: { teacherId: T1, gradeLevel: 'Grade 6' } },
  });

  // Every value HANDOFF.md P3 lists, plus the omitted-field case. Note what
  // Number() does to most of these: null, '' and [] all coerce to 0, a
  // perfectly valid failing grade for a student whose mark was never sent.
  const rejected = [
    ['above the range', 500],
    ['negative', -5],
    ['not a number', 'abc'],
    ['null', null],
    ['empty string', ''],
    ['a boolean', true],
    ['an array', []],
    ['just past the top of the range', 100.1],
  ];

  for (const [label, hitlScore] of rejected) {
    it(`400s on ${label} and writes nothing`, async () => {
      prismaFake.submission.findUnique.mockResolvedValue(gradeableSubmission());

      const res = await call('PUT', url, {
        token: tokenFor({ id: T1 }),
        body: { hitlScore, hitlFeedback: 'x', rubricData: [] },
      });

      expect(res.status).toBe(400);
      // The assertion that actually protects the student: no grade of record
      // was written on the way to that status code.
      expect(prismaFake.submission.update).not.toHaveBeenCalled();
    });
  }

  it('400s when hitlScore is omitted entirely', async () => {
    prismaFake.submission.findUnique.mockResolvedValue(gradeableSubmission());

    const res = await call('PUT', url, {
      token: tokenFor({ id: T1 }),
      body: { hitlFeedback: 'x', rubricData: [] },
    });

    expect(res.status).toBe(400);
    expect(prismaFake.submission.update).not.toHaveBeenCalled();
  });

  it('accepts a real mark and stores the decimal unrounded', async () => {
    // 23 out of a 30-point activity. Rounding here would quietly cost the
    // student the fraction on every points -> percent -> points round trip.
    prismaFake.submission.findUnique.mockResolvedValue(gradeableSubmission());
    prismaFake.submission.update.mockResolvedValue({ id: SUBMISSION, hitlScore: 76.7 });

    const res = await call('PUT', url, {
      token: tokenFor({ id: T1 }),
      body: { hitlScore: 76.7, hitlFeedback: 'Good work', rubricData: [] },
    });

    expect(res.status).toBe(200);
    expect(prismaFake.submission.update).toHaveBeenCalledTimes(1);
    const { data } = prismaFake.submission.update.mock.calls[0][0];
    expect(data.hitlScore).toBe(76.7);
    expect(data.status).toBe('GRADED');
  });

  it('accepts a validated zero, which is a real mark and not a missing one', async () => {
    prismaFake.submission.findUnique.mockResolvedValue(gradeableSubmission());
    prismaFake.submission.update.mockResolvedValue({ id: SUBMISSION, hitlScore: 0 });

    const res = await call('PUT', url, {
      token: tokenFor({ id: T1 }),
      body: { hitlScore: 0, hitlFeedback: 'Not attempted', rubricData: [] },
    });

    expect(res.status).toBe(200);
    expect(prismaFake.submission.update.mock.calls[0][0].data.hitlScore).toBe(0);
  });

  it("refuses to grade another teacher's paper even with a valid score", async () => {
    prismaFake.submission.findUnique.mockResolvedValue(gradeableSubmission());

    const res = await call('PUT', url, {
      token: tokenFor({ id: T2 }),
      body: { hitlScore: 90, hitlFeedback: 'x', rubricData: [] },
    });

    expect(res.status).toBe(403);
    expect(prismaFake.submission.update).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────
// P8 — cross-tenant reads
// ───────────────────────────────────────────────────────────────────

describe("P8: staff cannot read another tenant's work", () => {
  const activityRow = (cls) => ({ id: ACTIVITY, title: 'Essay', class: cls });
  const submissionRow = (cls) => ({
    id: SUBMISSION,
    studentId: 'student-1',
    releasedAt: new Date(),
    activity: { class: cls, classLesson: null },
  });

  /** The three routes HANDOFF.md P8 names, and how to arm the fake for each. */
  const routes = [
    {
      name: 'GET /api/activities/:id',
      path: `/api/activities/${ACTIVITY}`,
      arm: (cls) => prismaFake.activity.findUnique.mockResolvedValue(activityRow(cls)),
    },
    {
      name: 'GET /api/activities/:id/submissions',
      path: `/api/activities/${ACTIVITY}/submissions`,
      arm: (cls) => prismaFake.activity.findUnique.mockResolvedValue(activityRow(cls)),
    },
    {
      name: 'GET /api/submissions/:id',
      path: `/api/submissions/${SUBMISSION}`,
      arm: (cls) => prismaFake.submission.findUnique.mockResolvedValue(submissionRow(cls)),
    },
  ];

  describe('a class with no school anywhere — the hole that was open', () => {
    // Every one of these returned 200 before the fix: the check read
    // `if (schoolId) { ...compare... }` and fell through to allow, so a
    // section created by a teacher with no school yet was world-readable to
    // any authenticated staff account.
    for (const route of routes) {
      it(`${route.name} 403s for an unrelated teacher`, async () => {
        route.arm(classOwnedByT1(null));
        prismaFake.user.findUnique.mockResolvedValue({ sessionsValidFrom: null, schoolId: null });

        const res = await call('GET', route.path, { token: tokenFor({ id: T2 }) });
        expect(res.status).toBe(403);
      });

      it(`${route.name} still 200s for the owning teacher`, async () => {
        // Half the point of P8: the fix must not lock T1 out of their own work.
        route.arm(classOwnedByT1(null));
        prismaFake.user.findUnique.mockResolvedValue({ sessionsValidFrom: null, schoolId: null });

        const res = await call('GET', route.path, { token: tokenFor({ id: T1 }) });
        expect(res.status).toBe(200);
      });
    }
  });

  describe('a class that belongs to a school', () => {
    for (const route of routes) {
      it(`${route.name} 403s for staff at a different school`, async () => {
        route.arm(classOwnedByT1(SCHOOL_A));
        prismaFake.user.findUnique.mockResolvedValue({ sessionsValidFrom: null, schoolId: SCHOOL_B });

        const res = await call('GET', route.path, { token: tokenFor({ id: T2, schoolId: SCHOOL_B }) });
        expect(res.status).toBe(403);
      });

      it(`${route.name} 200s for a colleague at the same school`, async () => {
        // Deliberately school-scoped rather than owner-scoped: a coordinator
        // or covering teacher opening a colleague's activity is the reason
        // these routes are not restricted to the exact owning teacher.
        route.arm(classOwnedByT1(SCHOOL_A));
        prismaFake.user.findUnique.mockResolvedValue({ sessionsValidFrom: null, schoolId: SCHOOL_A });

        const res = await call('GET', route.path, { token: tokenFor({ id: T2, schoolId: SCHOOL_A }) });
        expect(res.status).toBe(200);
      });
    }
  });

  it('404s rather than 403s when the activity does not exist', async () => {
    prismaFake.activity.findUnique.mockResolvedValue(null);
    const res = await call('GET', `/api/activities/${ACTIVITY}`, { token: tokenFor({ id: T1 }) });
    expect(res.status).toBe(404);
  });
});

// ───────────────────────────────────────────────────────────────────
// Student IDs typed the way a child types them
// ───────────────────────────────────────────────────────────────────

describe('POST /api/auth/login accepts a student ID that is punctuated differently', () => {
  const bcrypt = require('bcryptjs');
  const PASSWORD = '03152014';
  let hashed;

  const studentRow = () => ({
    id: 'student-1',
    name: 'Juan Dela Cruz',
    username: 'AS-26-0001',
    role: 'STUDENT',
    password: hashed,
    sessionsValidFrom: null,
    section: null,
    school: null,
  });

  const login = (username, password = PASSWORD, role = 'STUDENT') =>
    call('POST', '/api/auth/login', { body: { username, password, role } });

  beforeAll(async () => { hashed = await bcrypt.hash(PASSWORD, 4); });

  it('signs in on the exact ID without needing the relaxed lookup', async () => {
    prismaFake.user.findFirst.mockResolvedValue(studentRow());

    const res = await login('AS-26-0001');
    expect(res.status).toBe(200);
    // The exact match short-circuits, so the fallback query never runs.
    expect(rawQuery).not.toHaveBeenCalled();
  });

  it('trims stray whitespace, which a copy-paste off a slip carries', async () => {
    prismaFake.user.findFirst.mockResolvedValue(studentRow());

    await login('  AS-26-0001  ');
    expect(prismaFake.user.findFirst.mock.calls[0][0].where.username).toBe('AS-26-0001');
  });

  for (const typed of ['as-26-0001', 'AS 26 0001', 'as260001', 'AS260001']) {
    it(`signs in when the ID is typed as "${typed}"`, async () => {
      // Exact lookup misses; the normalised one finds exactly one account.
      prismaFake.user.findFirst.mockResolvedValue(null);
      rawQuery.mockResolvedValue([{ id: 'student-1' }]);
      prismaFake.user.findUnique.mockResolvedValue(studentRow());

      const res = await login(typed);
      expect(res.status).toBe(200);
    });
  }

  it('still refuses the wrong password on a relaxed match', async () => {
    // The relaxed lookup widens how the account is *named*, never what proves
    // it is yours. This is the assertion that keeps it that way.
    prismaFake.user.findFirst.mockResolvedValue(null);
    rawQuery.mockResolvedValue([{ id: 'student-1' }]);
    prismaFake.user.findUnique.mockResolvedValue(studentRow());

    const res = await login('as260001', 'not-the-password');
    expect(res.status).toBe(401);
  });

  it('refuses rather than guessing when two IDs normalise the same way', async () => {
    prismaFake.user.findFirst.mockResolvedValue(null);
    rawQuery.mockResolvedValue([{ id: 'student-1' }, { id: 'student-2' }]);

    const res = await login('as260001');
    expect(res.status).toBe(401);
    // Critically, it must not have gone on to load either candidate.
    expect(prismaFake.user.findUnique).not.toHaveBeenCalled();
  });

  it('does not relax anything for a teacher', async () => {
    // Teachers sign in with an email; there is no punctuation ambiguity to
    // forgive, and widening the lookup for them would be unearned.
    prismaFake.user.findFirst.mockResolvedValue(null);

    const res = await login('teacher@deped.gov.ph', 'whatever', 'TEACHER');
    expect(res.status).toBe(401);
    expect(rawQuery).not.toHaveBeenCalled();
  });

  it('does not run the fallback on an empty or punctuation-only ID', async () => {
    prismaFake.user.findFirst.mockResolvedValue(null);

    const res = await login('---');
    expect(res.status).toBe(401);
    expect(rawQuery).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────
// A learner who has moved between sections
// ───────────────────────────────────────────────────────────────────

describe("GET /api/teacher/:teacherId/student/:studentId/gradebook after a transfer", () => {
  const STUDENT = 'student-1';
  const NEW_SECTION = 'section-new';
  const OLD_CLASS = 'class-old';

  const activity = (id, classId, sectionId, withSubmission, deadline = null) => ({
    id,
    title: `Activity ${id}`,
    points: 100,
    deadline,
    class: { name: 'Class', sectionId },
    submissions: withSubmission
      ? [{ id: `sub-${id}`, hitlScore: 88, aiScore: 80, status: 'GRADED', createdAt: new Date(), isLate: false, excusedAt: null, excusedReason: null }]
      : [],
  });

  const arm = (activities) => {
    // A User has exactly one Section, so the student now reports only the new one.
    prismaFake.user.findUnique.mockResolvedValue({
      id: STUDENT, name: 'Juan', username: 'AS-26-0001', sectionId: NEW_SECTION, sessionsValidFrom: null,
    });
    prismaFake.submission.findMany.mockResolvedValue([{ activity: { classId: OLD_CLASS } }]);
    prismaFake.activity.findMany.mockResolvedValue(activities);
  };

  const fetchRows = async () => {
    const res = await call('GET', `/api/teacher/${T1}/student/${STUDENT}/gradebook`, { token: tokenFor({ id: T1 }) });
    expect(res.status).toBe(200);
    return (await res.json()).rows;
  };

  it('still shows work the learner did in a section they have left', async () => {
    // The defect: this query keyed on the student's *current* sectionId, so a
    // transfer made every mark their previous teacher gave them vanish from
    // that teacher's view — while it kept counting toward the average.
    arm([activity('a-old', OLD_CLASS, 'section-old', true)]);

    const rows = await fetchRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].activityId).toBe('a-old');
    expect(rows[0].grade).toBe(88);
    expect(rows[0].fromPreviousSection).toBe(true);
  });

  it('does not invent a MISSING mark for work set after they left', async () => {
    // No submission, previous section: indistinguishable from "had already
    // transferred", so it is dropped rather than held against them.
    arm([
      activity('a-old', OLD_CLASS, 'section-old', true),
      activity('a-old-unsubmitted', OLD_CLASS, 'section-old', false),
    ]);

    const rows = await fetchRows();
    expect(rows.map(r => r.activityId)).toEqual(['a-old']);
  });

  it('keeps MISSING for the section they are actually in', async () => {
    // The filter must not swallow genuine missing work in the current section.
    // Deadline well past, so this is unambiguously not-handed-in.
    arm([activity('a-current', 'class-new', NEW_SECTION, false, '2020-01-01')]);

    const rows = await fetchRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].fromPreviousSection).toBe(false);
    expect(rows[0].status).toBe('MISSING');
  });

  it('asks only for classes this teacher owns', async () => {
    // Widening the view must not widen whose work it can reach.
    arm([activity('a-old', OLD_CLASS, 'section-old', true)]);
    await fetchRows();

    expect(prismaFake.submission.findMany.mock.calls[0][0].where.activity.class.teacherId).toBe(T1);
    expect(prismaFake.activity.findMany.mock.calls[0][0].where.class.teacherId).toBe(T1);
  });
});

describe('the session gate itself', () => {
  it('401s without a token', async () => {
    const res = await call('GET', `/api/activities/${ACTIVITY}`);
    expect(res.status).toBe(401);
  });

  it('401s on a token whose signature does not verify', async () => {
    const forged = `${signToken({ id: T1, role: 'TEACHER' })}tampered`;
    const res = await call('GET', `/api/activities/${ACTIVITY}`, { token: forged });
    expect(res.status).toBe(401);
  });

  it('403s a student reaching a staff-only activity route', async () => {
    const res = await call('GET', `/api/activities/${ACTIVITY}`, {
      token: tokenFor({ id: 'student-1', role: 'STUDENT' }),
    });
    expect(res.status).toBe(403);
  });
});

// ───────────────────────────────────────────────────────────────────
// Moving a student back out deletes only the rows the move invented
// ───────────────────────────────────────────────────────────────────

describe('a transfer out cleans up only what a transfer in created', () => {
  it('deletes untouched auto-excused rows and nothing else', async () => {
    const { cleanUpTransferRows } = require('../server.js');

    const deleteMany = vi.fn().mockResolvedValue({ count: 3 });
    const tx = { submission: { deleteMany } };

    await cleanUpTransferRows(tx, { studentId: 'stu-1', sectionId: 'sec-a' });

    expect(deleteMany).toHaveBeenCalledTimes(1);
    const { where } = deleteMany.mock.calls[0][0];

    // The four conditions together are what makes this safe. Losing any one of
    // them puts a teacher-entered mark in range of a delete.
    expect(where.studentId).toBe('stu-1');
    expect(where.transferId).toEqual({ not: null });
    expect(where.attemptCount).toBe(0);
    expect(where.aiScore).toBeNull();
    expect(where.hitlScore).toBeNull();
    expect(where.activity).toEqual({ class: { sectionId: 'sec-a' } });
  });
});

// ───────────────────────────────────────────────────────────────────
// The one lookup every merged read shares
// ───────────────────────────────────────────────────────────────────

describe('carriedOverForClass', () => {
  it('returns an empty map without querying when no student has moved', async () => {
    const { carriedOverForClass } = require('../server.js');

    const prisma = {
      class: { findUnique: vi.fn().mockResolvedValue({ id: 'c1', subject: 'English', gradeLevel: 'Grade 6', schoolYear: '2026-2027', sectionId: 'sec-b' }) },
      sectionTransfer: { findMany: vi.fn().mockResolvedValue([]) },
      submission: { findMany: vi.fn() },
    };

    const result = await carriedOverForClass(prisma, { classId: 'c1', studentIds: ['s1'] });

    expect(result.size).toBe(0);
    // The N+1 this replaces is the whole point: no student means no query.
    expect(prisma.submission.findMany).not.toHaveBeenCalled();
  });

  it('fetches every student\'s carried work in one query, not one per student', async () => {
    const { carriedOverForClass } = require('../server.js');

    const prisma = {
      class: {
        findUnique: vi.fn().mockResolvedValue({ id: 'c1', subject: 'English', gradeLevel: 'Grade 6', schoolYear: '2026-2027', sectionId: 'sec-b' }),
        findMany: vi.fn().mockResolvedValue([
          { id: 'old-eng', subject: 'English', gradeLevel: 'Grade 6', schoolYear: '2026-2027', sectionId: 'sec-a' },
          { id: 'old-sci', subject: 'Science', gradeLevel: 'Grade 6', schoolYear: '2026-2027', sectionId: 'sec-a' },
        ]),
      },
      sectionTransfer: {
        findMany: vi.fn().mockResolvedValue([
          { studentId: 's1', fromSectionId: 'sec-a', toSectionId: 'sec-b' },
          { studentId: 's2', fromSectionId: 'sec-a', toSectionId: 'sec-b' },
        ]),
      },
      submission: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'sub1', studentId: 's1', activityId: 'a1', activity: { id: 'a1', classId: 'old-eng' } },
          { id: 'sub2', studentId: 's2', activityId: 'a2', activity: { id: 'a2', classId: 'old-eng' } },
        ]),
      },
    };

    const result = await carriedOverForClass(prisma, { classId: 'c1', studentIds: ['s1', 's2'] });

    expect(prisma.submission.findMany).toHaveBeenCalledTimes(1);
    expect(result.get('s1').map(s => s.id)).toEqual(['sub1']);
    expect(result.get('s2').map(s => s.id)).toEqual(['sub2']);

    // Science is not English: the Science class must never be a source.
    const { where } = prisma.submission.findMany.mock.calls[0][0];
    expect(where.activity.classId.in).toEqual(['old-eng']);
  });
});

describe('the receiving teacher sees carried-over work read-only', () => {
  const T_RECEIVING = 'teacher-receiving';
  const STUDENT = 'student-maria';

  it('403s when that teacher tries to write to the sending teacher\'s class', async () => {
    // The read is school-scoped via staffMayAccess; the write is not. A
    // receiving teacher who can re-grade a colleague's mark would be able to
    // rewrite a grade of record they never awarded.
    prismaFake.activity.findUnique.mockResolvedValue({
      id: ACTIVITY, class: { teacherId: T1, sectionId: 'sec-a' },
    });

    const res = await call('POST', '/api/teacher/submissions/excuse', {
      token: tokenFor({ id: T_RECEIVING, schoolId: SCHOOL_A }),
      body: { activityId: ACTIVITY, studentId: STUDENT, excused: true, reason: 'x' },
    });

    expect(res.status).toBe(403);
    expect(prismaFake.submission.update).not.toHaveBeenCalled();
    expect(prismaFake.submission.create).not.toHaveBeenCalled();
  });
});
