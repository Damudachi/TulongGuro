import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import transfersModule from '../transfers.js';

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

  it('selects subject and gradeLevel on the carried activity\'s class', async () => {
    // workingAverageAcrossSubjects keys its per-subject grouping on
    // `activity.class.subject` + `.gradeLevel` (server.js: `const key =
    // ...cls?.subject...cls?.gradeLevel`). If CARRIED_OVER_SELECT ever stops
    // asking Prisma for those two fields, every pooled carried submission
    // comes back with subject/gradeLevel undefined, keys as the empty-string
    // pair, and lands in a phantom extra "subject" bucket instead of merging
    // into the student's real one — silently skewing every average that
    // pools carried work (teacher analytics, gradebook export, drill-down).
    const { carriedOverForClass } = require('../server.js');

    const prisma = {
      class: {
        findUnique: vi.fn().mockResolvedValue({ id: 'c1', subject: 'English', gradeLevel: 'Grade 6', schoolYear: '2026-2027', sectionId: 'sec-b' }),
        findMany: vi.fn().mockResolvedValue([
          { id: 'old-eng', subject: 'English', gradeLevel: 'Grade 6', schoolYear: '2026-2027', sectionId: 'sec-a' },
        ]),
      },
      sectionTransfer: {
        findMany: vi.fn().mockResolvedValue([{ studentId: 's1', fromSectionId: 'sec-a', toSectionId: 'sec-b' }]),
      },
      submission: { findMany: vi.fn().mockResolvedValue([]) },
    };

    await carriedOverForClass(prisma, { classId: 'c1', studentIds: ['s1'] });

    const { select } = prisma.submission.findMany.mock.calls[0][0];
    expect(select.activity.select.class.select.subject).toBe(true);
    expect(select.activity.select.class.select.gradeLevel).toBe(true);
  });

  it('counts carried work exactly once for a student with two SectionTransfer rows out of the same section', async () => {
    // A -> B -> A -> C is a real shape: a move gets undone (Task 4's "move
    // back") and then the student leaves A again, this time for C. That
    // leaves TWO SectionTransfer rows with the same fromSectionId ('sec-a')
    // for the same student. priorSectionIds dedupes them with `new Set`
    // before the class lookup and the submission query, so this is already
    // correct — this test is the regression pin the review asked for (rides
    // along with the CRITICAL-1 fixtures/family), not a fix.
    const { carriedOverForClass } = require('../server.js');

    const classFindMany = vi.fn().mockResolvedValue([
      { id: 'old-eng', subject: 'English', gradeLevel: 'Grade 6', schoolYear: '2026-2027', sectionId: 'sec-a' },
    ]);
    const submissionFindMany = vi.fn().mockResolvedValue([
      { id: 'sub1', studentId: 's1', activityId: 'a1', activity: { id: 'a1', classId: 'old-eng' } },
    ]);

    const prisma = {
      class: {
        findUnique: vi.fn().mockResolvedValue({ id: 'c1', subject: 'English', gradeLevel: 'Grade 6', schoolYear: '2026-2027', sectionId: 'sec-c' }),
        findMany: classFindMany,
      },
      sectionTransfer: {
        // Two rows, same fromSectionId — the double-transfer-out shape.
        findMany: vi.fn().mockResolvedValue([
          { studentId: 's1', fromSectionId: 'sec-a', toSectionId: 'sec-b' },
          { studentId: 's1', fromSectionId: 'sec-a', toSectionId: 'sec-c' },
        ]),
      },
      submission: { findMany: submissionFindMany },
    };

    const result = await carriedOverForClass(prisma, { classId: 'c1', studentIds: ['s1'] });

    // The candidate-class lookup and the submission query each ran once, over
    // a single 'sec-a' — not twice — and the student's carried work appears
    // exactly once, not duplicated.
    expect(classFindMany).toHaveBeenCalledTimes(1);
    expect(classFindMany.mock.calls[0][0].where.sectionId.in).toEqual(['sec-a']);
    expect(submissionFindMany).toHaveBeenCalledTimes(1);
    expect(result.get('s1').map(s => s.id)).toEqual(['sub1']);
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

  it('does not duplicate a submission the teacher already owns in both sections', async () => {
    // Maria moved from Section A's English 6 to Section B's English 6, and the
    // SAME teacher (T1) teaches both. Her Section A marks are already in `rows`
    // via classIdsWithWork, flagged fromPreviousSection. The carried-over loop
    // must not carry them in a second time just because Section B's English
    // matches Section A's English on (subject, gradeLevel, schoolYear) — that
    // would render the same grade twice, the second copy wrongly captioned
    // "marked by their previous teacher" when it was T1 both times.
    const CLASS_A = 'class-a-eng';
    const CLASS_B = 'class-b-eng';
    const SUB = 'sub-a1';

    prismaFake.user.findUnique.mockImplementation(({ where }) => {
      if (where.id === STUDENT) {
        return Promise.resolve({ id: STUDENT, name: 'Maria Test', username: 'maria', sectionId: 'sec-b' });
      }
      // Any other id is the auth revocation check on the signed-in teacher.
      return Promise.resolve({ sessionsValidFrom: null });
    });

    // classesWithWork: T1 already has a submission of Maria's from Section A's
    // English, which is why Section A's class ends up in ownClassIds too.
    // CARRIED_OVER_SELECT (the carried-over lookup) is distinguished by its
    // `archivedAt: null` clause, which the classesWithWork query never has.
    prismaFake.submission.findMany.mockImplementation(({ where }) => {
      if (where.archivedAt === null) {
        const wantsClassA = where.activity.classId.in.includes(CLASS_A);
        if (!wantsClassA) return Promise.resolve([]);
        return Promise.resolve([{
          id: SUB, studentId: STUDENT, activityId: 'act-a1',
          status: 'GRADED', hitlScore: 85, aiScore: null, hitlFeedback: null, aiFeedback: null,
          archivedAt: null, excusedAt: null, excusedReason: null, isLate: false,
          gradedAt: '2026-01-05T00:00:00Z', releasedAt: null,
          activity: {
            id: 'act-a1', title: 'A Activity', points: 100, component: 'WW',
            deadline: '2026-01-01T00:00:00Z', classId: CLASS_A,
            class: { id: CLASS_A, name: 'Eng6-A', section: { id: 'sec-a', name: 'Section A', gradeLevel: 'Grade 6' } },
          },
        }]);
      }
      return Promise.resolve([{ activity: { classId: CLASS_A } }]);
    });

    prismaFake.activity.findMany.mockResolvedValue([
      {
        id: 'act-b1', title: 'B Activity', classId: CLASS_B, deadline: '2026-02-01T00:00:00Z', points: 100,
        class: { name: 'Eng6-B', sectionId: 'sec-b' },
        submissions: [],
      },
      {
        id: 'act-a1', title: 'A Activity', classId: CLASS_A, deadline: '2026-01-01T00:00:00Z', points: 100,
        class: { name: 'Eng6-A', sectionId: 'sec-a' },
        submissions: [{
          id: SUB, hitlScore: 85, aiScore: null, status: 'GRADED',
          createdAt: '2026-01-01T00:00:00Z', isLate: false, excusedAt: null, excusedReason: null,
        }],
      },
    ]);

    prismaFake.class.findUnique.mockImplementation(({ where }) => {
      if (where.id === CLASS_B) return Promise.resolve({ id: CLASS_B, subject: 'English', gradeLevel: 'Grade 6', schoolYear: '2026-2027', sectionId: 'sec-b' });
      if (where.id === CLASS_A) return Promise.resolve({ id: CLASS_A, subject: 'English', gradeLevel: 'Grade 6', schoolYear: '2026-2027', sectionId: 'sec-a' });
      return Promise.resolve(null);
    });
    prismaFake.class.findMany.mockImplementation(({ where }) => {
      const ids = where.sectionId.in;
      if (ids.includes('sec-a')) return Promise.resolve([{ id: CLASS_A, subject: 'English', gradeLevel: 'Grade 6', schoolYear: '2026-2027' }]);
      return Promise.resolve([]);
    });
    prismaFake.sectionTransfer.findMany.mockResolvedValue([
      { studentId: STUDENT, fromSectionId: 'sec-a' },
    ]);

    const res = await call('GET', `/api/teacher/${T1}/student/${STUDENT}/gradebook`, {
      token: tokenFor({ id: T1 }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    const matches = body.rows.filter(r => r.submissionId === SUB);
    expect(matches).toHaveLength(1);
    // The surviving copy is the main-path row (fromPreviousSection, not the
    // read-only carried-over duplicate), because it is T1's own mark.
    expect(matches[0].carriedOver).toBe(false);
    expect(matches[0].fromPreviousSection).toBe(true);
  });

  it('IMPORTANT-3: does not duplicate a carried row across a double move (A -> D -> B) where the teacher owns both D and B', async () => {
    // Maria moved A -> D -> B. T1 owns both D and B (not A, which belongs to
    // a colleague). ownClassIds ends up [D, B]: D via classIdsWithWork (she
    // has a submission there), B via her current section. Asking
    // carriedOverForClass once per ownClassIds entry:
    //   - target D: priorSectionIds excludes D itself, leaving just A -> matches A only.
    //   - target B: priorSectionIds excludes B, leaving {A, D} -> matches A AND D,
    //     but D's own row is filtered by ownClassIdSet, so only A survives again.
    // Without a dedupe spanning the whole loop, A's submission is pushed into
    // carriedRows twice — rendered twice in the "Carried over from…" panel
    // and with a duplicate React key.
    const STUDENT = 'student-dm1';
    const SECTION_A = 'sec-dm1-a';
    const SECTION_D = 'sec-dm1-d';
    const SECTION_B = 'sec-dm1-b';
    const CLASS_A = 'class-dm1-a';
    const CLASS_D = 'class-dm1-d';
    const CLASS_B = 'class-dm1-b';
    const SUB_A = 'sub-dm1-a';

    prismaFake.user.findUnique.mockImplementation(({ where }) => {
      if (where.id === STUDENT) {
        return Promise.resolve({ id: STUDENT, name: 'Double Move Student', username: 'doublemove', sectionId: SECTION_B });
      }
      return Promise.resolve({ sessionsValidFrom: null });
    });

    prismaFake.activity.findMany.mockResolvedValue([
      { id: 'act-dm1-d', title: 'D Activity', classId: CLASS_D, deadline: '2026-01-01T00:00:00Z', points: 100, class: { name: 'Eng (D)', sectionId: SECTION_D }, submissions: [] },
      { id: 'act-dm1-b', title: 'B Activity', classId: CLASS_B, deadline: '2026-02-01T00:00:00Z', points: 100, class: { name: 'Eng (B)', sectionId: SECTION_B }, submissions: [] },
    ]);

    prismaFake.class.findUnique.mockImplementation(({ where }) => {
      if (where.id === CLASS_D) return Promise.resolve({ id: CLASS_D, subject: 'English', gradeLevel: 'Grade 6', schoolYear: '2026-2027', sectionId: SECTION_D });
      if (where.id === CLASS_B) return Promise.resolve({ id: CLASS_B, subject: 'English', gradeLevel: 'Grade 6', schoolYear: '2026-2027', sectionId: SECTION_B });
      return Promise.resolve(null);
    });
    prismaFake.class.findMany.mockImplementation(({ where }) => {
      const ids = where.sectionId.in;
      const result = [];
      if (ids.includes(SECTION_A)) result.push({ id: CLASS_A, subject: 'English', gradeLevel: 'Grade 6', schoolYear: '2026-2027' });
      if (ids.includes(SECTION_D)) result.push({ id: CLASS_D, subject: 'English', gradeLevel: 'Grade 6', schoolYear: '2026-2027' });
      return Promise.resolve(result);
    });

    prismaFake.sectionTransfer.findMany.mockResolvedValue([
      { studentId: STUDENT, fromSectionId: SECTION_A },
      { studentId: STUDENT, fromSectionId: SECTION_D },
    ]);

    prismaFake.submission.findMany.mockImplementation(({ where }) => {
      // classesWithWork — the query that puts CLASS_D into ownClassIds.
      if (where.activity?.class?.teacherId) {
        return Promise.resolve([{ activity: { classId: CLASS_D } }]);
      }
      // carriedOverForClass's own lookup — A is the only real foreign
      // source, present whether it's asked alongside D or alone.
      if (where.archivedAt === null) {
        if (!where.activity.classId.in.includes(CLASS_A)) return Promise.resolve([]);
        return Promise.resolve([{
          id: SUB_A, studentId: STUDENT, activityId: 'act-dm1-a-src', status: 'GRADED',
          hitlScore: 88, aiScore: null, hitlFeedback: null, aiFeedback: null,
          archivedAt: null, excusedAt: null, excusedReason: null, isLate: false,
          gradedAt: '2026-01-05T00:00:00Z', releasedAt: null,
          activity: {
            id: 'act-dm1-a-src', title: 'A Activity', points: 100, component: 'WW', deadline: '2026-01-01T00:00:00Z', classId: CLASS_A,
            class: { id: CLASS_A, name: 'Eng (A)', section: { id: SECTION_A, name: 'Section A', gradeLevel: 'Grade 6' } },
          },
        }]);
      }
      return Promise.resolve([]);
    });

    const res = await call('GET', `/api/teacher/${T1}/student/${STUDENT}/gradebook`, {
      token: tokenFor({ id: T1 }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    const matches = body.rows.filter(r => r.submissionId === SUB_A && r.carriedOver === true);
    expect(matches).toHaveLength(1);
  });
});

describe('a transferred student\'s exported grade uses their whole subject history', () => {
  // Unit-level only: exercises grading.computeGrade directly, not the export
  // route. It was originally named as if it proved the export route itself
  // merges carried work — it doesn't touch the route at all, so it would
  // still pass even if the export stopped calling carriedOverEntries. The
  // route-level proof is the 'the export route itself...' test below, which
  // drives GET .../gradebook/export and reads the CSV.
  it('computeGrade merges carried entries with a student\'s own before renormalising weights', () => {
    const grading = require('../grading.js');
    const POLICY = { WW: 30, PT: 50, QA: 20 };

    // Maria did the Quarterly Assessment in her old section and only one
    // Written Work task since arriving. Grading the new class alone drops QA
    // entirely and renormalises its 20% away.
    const own = [{ percent: 80, points: 100, component: 'WW' }];
    const carried = transfersModule.carriedOverEntries([
      { status: 'GRADED', hitlScore: 60, archivedAt: null, excusedAt: null,
        activity: { points: 100, component: 'QA' } },
    ]);

    const partial = grading.computeGrade(own, POLICY, { transmute: false });
    const merged = grading.computeGrade([...own, ...carried], POLICY, { transmute: false });

    expect(partial.finalGrade).toBe(80);          // QA renormalised away
    expect(merged.componentPercents.QA).toBe(60); // the QA she actually sat
    expect(merged.finalGrade).toBe(72);           // (80*30 + 60*20) / 50
    expect(merged.finalGrade).not.toBe(partial.finalGrade);
  });

  it('an unreviewed carried submission does not inflate the grade and does increment the unreviewed count', async () => {
    const CLASS_ID = 'class-transfer-export-new';
    const OLD_CLASS_ID = 'class-transfer-export-old';
    const SECTION_NEW = 'sec-transfer-export-new';
    const SECTION_OLD = 'sec-transfer-export-old';
    const STUDENT = 'student-transfer-export';
    const OWN_ACTIVITY = 'act-transfer-export-ww';
    const CARRIED_ACTIVITY = 'act-transfer-export-qa';

    prismaFake.class.findFirst.mockResolvedValue({ id: CLASS_ID });

    const classRow = {
      id: CLASS_ID,
      name: 'Science 6',
      subject: 'Science',
      gradeLevel: 'Grade 6',
      schoolYear: '2026-2027',
      sectionId: SECTION_NEW,
      section: {
        id: SECTION_NEW, name: 'Masipag', gradeLevel: 'Grade 6', schoolId: null,
        students: [{ id: STUDENT, name: 'Maria Clara', username: 'maria' }],
      },
      activities: [{
        id: OWN_ACTIVITY, title: 'Written Work 1', points: 100, component: 'WW', createdAt: '2026-06-01T00:00:00Z',
        submissions: [{ studentId: STUDENT, aiScore: null, hitlScore: 80, status: 'GRADED', archivedAt: null, excusedAt: null }],
      }],
    };
    // Both the main sheet-build query and carriedOverForClass's own lookup of
    // the target class hit class.findUnique with the same id — one fixture
    // answers both, since it is a superset of what either call reads.
    prismaFake.class.findUnique.mockImplementation(({ where }) => (
      where.id === CLASS_ID ? Promise.resolve(classRow) : Promise.resolve(null)
    ));
    prismaFake.sectionTransfer.findMany.mockResolvedValue([
      { studentId: STUDENT, fromSectionId: SECTION_OLD },
    ]);
    prismaFake.class.findMany.mockImplementation(({ where }) => (
      where.sectionId?.in?.includes(SECTION_OLD)
        ? Promise.resolve([{ id: OLD_CLASS_ID, subject: 'Science', gradeLevel: 'Grade 6', schoolYear: '2026-2027' }])
        : Promise.resolve([])
    ));
    // The AI scored her old-section Quarterly Assessment, but the sending
    // teacher never validated it before she moved — status stays short of
    // GRADED. This is exactly the row the review found silently vanishing:
    // dropped from the grade (correctly) and from the unreviewed count
    // (incorrectly, before this fix).
    prismaFake.submission.findMany.mockResolvedValue([{
      id: 'sub-carried-qa', studentId: STUDENT, activityId: CARRIED_ACTIVITY, status: 'SUBMITTED',
      hitlScore: null, aiScore: 90, hitlFeedback: null, aiFeedback: null,
      archivedAt: null, excusedAt: null, excusedReason: null, isLate: false,
      gradedAt: null, releasedAt: null,
      activity: {
        id: CARRIED_ACTIVITY, title: 'Quarterly Assessment', points: 100, component: 'QA',
        deadline: '2026-05-01T00:00:00Z', classId: OLD_CLASS_ID,
        class: { id: OLD_CLASS_ID, name: 'Science 6 (Old)', section: { id: SECTION_OLD, name: 'Masaya', gradeLevel: 'Grade 6' } },
      },
    }]);

    const csvRes = await call('GET', `/api/teacher/${T1}/gradebook/export?classId=${CLASS_ID}&format=csv`, {
      token: tokenFor({ id: T1 }),
    });
    const csv = await csvRes.text();
    const lines = csv.split('\n');

    // (a) The unreviewed carried QA does not contribute to the computed
    // grade: Written Work alone renormalises to the full average, exactly as
    // if the carried column had never existed.
    const dataLine = lines.find(l => l.startsWith('"Maria Clara"'));
    expect(dataLine).toBeDefined();
    const cells = dataLine.split(',');
    expect(cells[cells.length - 1]).toBe('80%'); // average: WW only, QA never counted
    expect(cells[cells.length - 2]).toBe('');    // carried cell: blank, not a score

    // The notice names the previous section and says the work is unvalidated
    // — the receiving teacher cannot validate it herself.
    const notice = lines.find(l => l.startsWith('# Carried over:'));
    expect(notice).toContain('1 of those carried submission(s) not yet validated');
    expect(notice).toContain('Grade 6 — Masaya');

    // (b) It increments the same unreviewedCount the amber Incomplete:/
    // # INCOMPLETE: banner is driven by — checked via preflight, where the
    // route exposes the count directly instead of a rendered notice string.
    const preflightRes = await call('GET', `/api/teacher/${T1}/gradebook/export?classId=${CLASS_ID}&preflight=1`, {
      token: tokenFor({ id: T1 }),
    });
    const preflight = await preflightRes.json();
    expect(preflight.classes[0].unreviewedCount).toBe(1);
    expect(preflight.totalUnreviewed).toBe(1);
  });

  it('the export route itself pools a validated carried mark into the exported average, not just computeGrade in isolation', async () => {
    // The sibling test above proves the *unvalidated* case is excluded. This
    // proves the whole point of the branch the other way round: a validated
    // carried mark from the previous section has to actually move the number
    // that lands on the CSV, driven through the real route — not just
    // asserted against grading.computeGrade called directly.
    const CLASS_ID = 'class-transfer-export-new-2';
    const OLD_CLASS_ID = 'class-transfer-export-old-2';
    const SECTION_NEW = 'sec-transfer-export-new-2';
    const SECTION_OLD = 'sec-transfer-export-old-2';
    const STUDENT = 'student-transfer-export-2';
    const OWN_ACTIVITY = 'act-transfer-export-ww-2';
    const CARRIED_ACTIVITY = 'act-transfer-export-qa-2';

    prismaFake.class.findFirst.mockResolvedValue({ id: CLASS_ID });

    const classRow = {
      id: CLASS_ID,
      name: 'Science 6',
      subject: 'Science',
      gradeLevel: 'Grade 6',
      schoolYear: '2026-2027',
      sectionId: SECTION_NEW,
      section: {
        id: SECTION_NEW, name: 'Masipag', gradeLevel: 'Grade 6', schoolId: null,
        students: [{ id: STUDENT, name: 'Maria Clara', username: 'maria' }],
      },
      // Own work since arriving: one Written Work at 80%. Science weighs
      // WW 40 / PT 40 / QA 20 — with QA absent, WW-only renormalises to the
      // full 100% and the average would read 80% if the carried mark below
      // were ignored.
      activities: [{
        id: OWN_ACTIVITY, title: 'Written Work 1', points: 100, component: 'WW', createdAt: '2026-06-01T00:00:00Z',
        submissions: [{ studentId: STUDENT, aiScore: null, hitlScore: 80, status: 'GRADED', archivedAt: null, excusedAt: null }],
      }],
    };
    prismaFake.class.findUnique.mockImplementation(({ where }) => (
      where.id === CLASS_ID ? Promise.resolve(classRow) : Promise.resolve(null)
    ));
    prismaFake.sectionTransfer.findMany.mockResolvedValue([
      { studentId: STUDENT, fromSectionId: SECTION_OLD },
    ]);
    prismaFake.class.findMany.mockImplementation(({ where }) => (
      where.sectionId?.in?.includes(SECTION_OLD)
        ? Promise.resolve([{ id: OLD_CLASS_ID, subject: 'Science', gradeLevel: 'Grade 6', schoolYear: '2026-2027' }])
        : Promise.resolve([])
    ));
    // The old section's teacher DID validate this QA (hitlScore set, status
    // GRADED) before Maria moved — the case the branch exists to serve.
    prismaFake.submission.findMany.mockResolvedValue([{
      id: 'sub-carried-qa-validated', studentId: STUDENT, activityId: CARRIED_ACTIVITY, status: 'GRADED',
      hitlScore: 60, aiScore: null, hitlFeedback: null, aiFeedback: null,
      archivedAt: null, excusedAt: null, excusedReason: null, isLate: false,
      gradedAt: '2026-04-01T00:00:00Z', releasedAt: null,
      activity: {
        id: CARRIED_ACTIVITY, title: 'Quarterly Assessment', points: 100, component: 'QA',
        deadline: '2026-05-01T00:00:00Z', classId: OLD_CLASS_ID,
        class: { id: OLD_CLASS_ID, name: 'Science 6 (Old)', section: { id: SECTION_OLD, name: 'Masaya', gradeLevel: 'Grade 6' } },
      },
    }]);

    const csvRes = await call('GET', `/api/teacher/${T1}/gradebook/export?classId=${CLASS_ID}&format=csv`, {
      token: tokenFor({ id: T1 }),
    });
    const csv = await csvRes.text();
    const lines = csv.split('\n');

    const dataLine = lines.find(l => l.startsWith('"Maria Clara"'));
    expect(dataLine).toBeDefined();
    const cells = dataLine.split(',');
    // Own WW 80 + carried QA 60, weighted 40/20 renormalised over 60:
    // (80*40 + 60*20) / 60 = 73.33 -> 73. NOT 80 (own work alone) and NOT the
    // unvalidated-case blank — this is the whole-subject-history number the
    // feature exists to produce.
    expect(cells[cells.length - 2]).toBe('60'); // the carried QA cell itself, printed as a real score
    expect(cells[cells.length - 1]).toBe('73%');

    // Nothing left unreviewed — the mark was validated before the move.
    const notice = lines.find(l => l.startsWith('# Carried over:'));
    expect(notice).not.toContain('not yet validated');
  });
});

describe('AI checking is refused when nobody wrote a rubric', () => {
  // The rule our adviser asked for, enforced where it actually matters. The
  // teacher-facing button is disabled too, but a disabled button is a courtesy;
  // this is the part that cannot be clicked past, replayed from a stale tab, or
  // reached by a queued job whose activity lost its rubric after it was queued.
  const url = `/api/teacher/activities/${ACTIVITY}/ai-check`;

  /** An activity as teacherOwnsActivity loads it, owned by T1. */
  const activityOwnedByT1 = ({ rubric = null, lessonRubric = null } = {}) => ({
    id: ACTIVITY,
    rubric,
    class: { teacherId: T1 },
    classLesson: lessonRubric ? { defaultRubric: lessonRubric } : null,
  });

  const RUBRIC = JSON.stringify({ criteria: [{ name: 'Content', points: 100 }] });

  it('409s with NO_RUBRIC and starts no job when the rubric was left blank', async () => {
    prismaFake.activity.findUnique.mockResolvedValue(activityOwnedByT1());
    prismaFake.submission.findMany.mockResolvedValue([
      { id: SUBMISSION, imageUrl: 'u.jpg', retainUntil: null, studentId: 'stu-1' },
    ]);

    const res = await call('POST', url, { token: tokenFor({ id: T1 }), body: {} });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('NO_RUBRIC');
    // The assertion that protects the pupil: refused before the papers were
    // even claimed for grading, so no AI call could follow.
    expect(prismaFake.submission.update).not.toHaveBeenCalled();
  });

  it('refuses before checking whether there are papers to grade', async () => {
    // Order matters for the teacher: "add a rubric" is the actionable message.
    // Reporting "no unchecked papers" first would send them hunting for the
    // wrong problem on an activity that also has no rubric.
    prismaFake.activity.findUnique.mockResolvedValue(activityOwnedByT1());
    prismaFake.submission.findMany.mockResolvedValue([]);

    const res = await call('POST', url, { token: tokenFor({ id: T1 }), body: {} });

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('NO_RUBRIC');
  });

  it('lets the check start when the teacher set a rubric', async () => {
    prismaFake.activity.findUnique.mockResolvedValue(activityOwnedByT1({ rubric: RUBRIC }));
    prismaFake.submission.findMany.mockResolvedValue([
      { id: SUBMISSION, imageUrl: 'u.jpg', retainUntil: null, studentId: 'stu-1' },
    ]);

    const res = await call('POST', url, { token: tokenFor({ id: T1 }), body: {} });

    // 503 when this server has no AI key configured is fine and expected — what
    // must not happen is a NO_RUBRIC refusal on an activity that has one.
    expect((await res.json()).code).not.toBe('NO_RUBRIC');
  });

  it('accepts the curriculum lesson rubric on an activity made before this change', async () => {
    prismaFake.activity.findUnique.mockResolvedValue(activityOwnedByT1({ lessonRubric: RUBRIC }));
    prismaFake.submission.findMany.mockResolvedValue([
      { id: SUBMISSION, imageUrl: 'u.jpg', retainUntil: null, studentId: 'stu-1' },
    ]);

    const res = await call('POST', url, { token: tokenFor({ id: T1 }), body: {} });

    expect((await res.json()).code).not.toBe('NO_RUBRIC');
  });
});

describe('the export still contains a learner who transferred out', () => {
  // HANDOFF §5.2 B. The export built its roster from Section.students — where a
  // learner is *now* — so a pupil who moved was not a blank row or a flagged
  // row but no row at all, while every mark this teacher gave them sat in the
  // database untouched. This is the file that becomes a report card.
  it('lists them with the date they left, and keeps them out of the class average', async () => {
    const CLASS_ID = 'class-departed-export';
    const SECTION_ID = 'sec-departed-export';
    const STAYED = 'student-departed-stayed';
    const LEFT = 'student-departed-left';
    const ACT = 'act-departed-ww';

    prismaFake.class.findFirst.mockResolvedValue({ id: CLASS_ID });
    prismaFake.class.findUnique.mockImplementation(({ where }) => (
      where.id === CLASS_ID ? Promise.resolve({
        id: CLASS_ID, name: 'English 6', subject: 'English', gradeLevel: 'Grade 6',
        schoolYear: '2026-2027', sectionId: SECTION_ID,
        section: {
          id: SECTION_ID, name: 'Masipag', gradeLevel: 'Grade 6', schoolId: null,
          // Jose is NOT here — he has already moved on. That is the point.
          students: [{ id: STAYED, name: 'Ana Reyes', username: 'ana' }],
        },
        activities: [{
          id: ACT, title: 'Written Work 1', points: 100, component: 'WW', createdAt: '2026-06-01T00:00:00Z',
          submissions: [
            { studentId: STAYED, aiScore: null, hitlScore: 90, status: 'GRADED', archivedAt: null, excusedAt: null },
            // Awarded by this teacher, before Jose left. Never deleted.
            { studentId: LEFT, aiScore: null, hitlScore: 70, status: 'GRADED', archivedAt: null, excusedAt: null },
          ],
        }],
      }) : Promise.resolve(null)
    ));
    prismaFake.user.findMany.mockResolvedValue([{ id: LEFT, name: 'Jose Rizal', username: 'jose' }]);
    // Two different callers hit sectionTransfer.findMany here: the departure
    // lookup (fromSectionId is this section) and carriedOverPrefetch
    // (fromSectionId: { not: null }). Only the first has anything to say.
    prismaFake.sectionTransfer.findMany.mockImplementation(({ where }) => (
      where.fromSectionId === SECTION_ID
        ? Promise.resolve([{ studentId: LEFT, transferredAt: '2026-07-15T00:00:00Z' }])
        : Promise.resolve([])
    ));
    prismaFake.class.findMany.mockResolvedValue([]);
    prismaFake.submission.findMany.mockResolvedValue([]);

    const res = await call('GET', `/api/teacher/${T1}/gradebook/export?classId=${CLASS_ID}&format=csv`, {
      token: tokenFor({ id: T1 }),
    });
    const csv = await res.text();
    const lines = csv.split('\n');

    // (a) The row exists at all. Before the fix there was no line for Jose.
    const departedLine = lines.find(l => l.startsWith('"Jose Rizal'));
    expect(departedLine).toBeDefined();
    // (b) Named with the day he left, so his blank cells for work set after
    // that date read as "was not here" rather than "did not hand it in".
    expect(departedLine).toContain('transferred out 15 July 2026');
    // (c) Carrying his real mark.
    expect(departedLine.split(',').pop()).toBe('70%');
    // (d) The sheet says why he is on it.
    expect(lines.find(l => l.startsWith('# Transferred out:'))).toContain('1 learner(s)');

    // (e) CLASS AVERAGE is the current class's standing — 90, Ana alone. His
    // row rests on whatever part of the quarter he was present for, so
    // averaging it in would compare two different things.
    const avgLine = lines.find(l => l.startsWith('CLASS AVERAGE'));
    expect(avgLine.split(',').pop()).toBe('90%');
  });
});

describe('at-risk detection for a transferred student', () => {
  // One graded item since arriving is not evidence of anything. Flagging on it
  // is noise; hiding a struggling child behind it is worse.
  it('reads their whole subject history, not just post-arrival work', () => {
    const grading = require('../grading.js');
    const POLICY = { WW: 30, PT: 50, QA: 20 };

    const postArrivalOnly = [{ percent: 55, points: 100, component: 'WW' }];
    const withCarried = [
      ...postArrivalOnly,
      { percent: 88, points: 100, component: 'WW' },
      { percent: 90, points: 100, component: 'PT' },
    ];

    expect(grading.computeGrade(postArrivalOnly, POLICY, { transmute: false }).isPassing).toBe(false);
    expect(grading.computeGrade(withCarried, POLICY, { transmute: false }).isPassing).toBe(true);
  });
});

describe('GET /api/teacher/:teacherId/analytics and a transferred student', () => {
  it('pools a transferred-in student\'s carried work into the same subject bucket as their own, not a phantom one', async () => {
    // Proves the endpoint wiring (server.js's new carriedOverForClass loop):
    // a transferred-in student's carried WW/PT submissions merge with their
    // own WW submission into ONE subject average, not two averaged
    // separately. 83 is the single-subject weighted average of all three
    // items together; a two-bucket split (own subject + a same-keyed second
    // bucket) would instead give 72. This test's fixture supplies
    // subject/gradeLevel on the carried rows directly (the fake Prisma client
    // does not project fields per `select`), so it does not exercise
    // CARRIED_OVER_SELECT itself — that is covered separately by
    // "selects subject and gradeLevel on the carried activity's class" above.
    const CLASS_NEW = 'class-ti-new';
    const CLASS_OLD = 'class-ti-old';
    const SECTION_NEW = 'sec-ti-new';
    const SECTION_OLD = 'sec-ti-old';
    const STUDENT = 'student-transferred-in';

    prismaFake.class.findMany.mockImplementation(({ where }) => {
      if (where?.teacherId) {
        return Promise.resolve([{
          id: CLASS_NEW, name: 'English 6', subject: 'English', gradeLevel: 'Grade 6',
          teacherId: T1, sectionId: SECTION_NEW,
          section: { id: SECTION_NEW, name: 'New Section', students: [{ id: STUDENT, name: 'Incoming Student', username: 'incoming' }] },
        }]);
      }
      if (where?.sectionId?.in?.includes(SECTION_OLD)) {
        return Promise.resolve([{ id: CLASS_OLD, subject: 'English', gradeLevel: 'Grade 6', schoolYear: '2026-2027' }]);
      }
      return Promise.resolve([]);
    });

    prismaFake.class.findUnique.mockImplementation(({ where }) => (
      where.id === CLASS_NEW
        ? Promise.resolve({ id: CLASS_NEW, subject: 'English', gradeLevel: 'Grade 6', schoolYear: '2026-2027', sectionId: SECTION_NEW })
        : Promise.resolve(null)
    ));

    prismaFake.sectionTransfer.findMany.mockImplementation(({ where }) => {
      const rows = [{ studentId: STUDENT, fromSectionId: SECTION_OLD, toSectionId: SECTION_NEW }];
      if (where.fromSectionId?.in) return Promise.resolve(rows.filter(r => where.fromSectionId.in.includes(r.fromSectionId)));
      return Promise.resolve(rows.filter(r => r.fromSectionId != null));
    });

    prismaFake.submission.findMany.mockImplementation(({ where }) => {
      if (where.archivedAt === null) {
        // carriedOverForClass's own lookup.
        if (!where.activity.classId.in.includes(CLASS_OLD)) return Promise.resolve([]);
        return Promise.resolve([
          {
            id: 'sub-ti-carried-ww', studentId: STUDENT, activityId: 'act-ti-carried-ww', status: 'GRADED',
            hitlScore: 88, aiScore: null, hitlFeedback: null, aiFeedback: null,
            archivedAt: null, excusedAt: null, excusedReason: null, isLate: false,
            gradedAt: '2026-01-05T00:00:00Z', releasedAt: null,
            activity: {
              id: 'act-ti-carried-ww', title: 'Old WW', points: 100, component: 'WW', deadline: '2026-01-01T00:00:00Z', classId: CLASS_OLD,
              class: { id: CLASS_OLD, name: 'English 6 (Old)', subject: 'English', gradeLevel: 'Grade 6', section: { id: SECTION_OLD, name: 'Old Section', gradeLevel: 'Grade 6' } },
            },
          },
          {
            id: 'sub-ti-carried-pt', studentId: STUDENT, activityId: 'act-ti-carried-pt', status: 'GRADED',
            hitlScore: 90, aiScore: null, hitlFeedback: null, aiFeedback: null,
            archivedAt: null, excusedAt: null, excusedReason: null, isLate: false,
            gradedAt: '2026-01-06T00:00:00Z', releasedAt: null,
            activity: {
              id: 'act-ti-carried-pt', title: 'Old PT', points: 100, component: 'PT', deadline: '2026-01-02T00:00:00Z', classId: CLASS_OLD,
              class: { id: CLASS_OLD, name: 'English 6 (Old)', subject: 'English', gradeLevel: 'Grade 6', section: { id: SECTION_OLD, name: 'Old Section', gradeLevel: 'Grade 6' } },
            },
          },
        ]);
      }
      // The endpoint's own `graded` query.
      return Promise.resolve([{
        id: 'sub-ti-own', studentId: STUDENT, status: 'GRADED', hitlScore: 55, aiScore: null, skillScores: null, createdAt: '2026-06-01T00:00:00Z',
        activity: {
          id: 'act-ti-own', title: 'WW1', type: 'WRITTEN_WORK', points: 100, classId: CLASS_NEW, component: 'WW',
          rubric: null, classLesson: null,
          class: { subject: 'English', gradeLevel: 'Grade 6' },
        },
      }]);
    });

    const res = await call('GET', `/api/teacher/${T1}/analytics`, { token: tokenFor({ id: T1 }) });
    expect(res.status).toBe(200);
    const body = await res.json();

    const trend = body.studentTrends.find(t => t.student.id === STUDENT);
    expect(trend).toBeDefined();
    expect(trend.gradedCount).toBe(3); // 1 own + 2 carried
    expect(trend.avgPercent).toBe(83); // merged single-subject average, not the 72 a phantom bucket would give
  });

  it('orders a transferred-in student\'s merged history by date, so "latest" is their newest work and the trend runs forwards', async () => {
    // `graded` arrives ordered createdAt asc; carried work is appended to the
    // tail. For a learner who transferred IN, that work is OLDER than anything
    // their new teacher set — so without a re-sort, subs[length - 1] named a
    // previous section's activity as their most recent, the sparkline rendered
    // right-to-left, and the "easing down" check read the last three of an
    // anti-chronological array and could flip direction.
    //
    // Maria: three carried marks in January (88, 90, 85), then one own mark in
    // June (55). Chronologically her scores are sliding; appended untouched
    // they read 55, 88, 90, 85 — improving, with an old QA as "latest".
    const CLASS_NEW = 'class-chrono-new';
    const CLASS_OLD = 'class-chrono-old';
    const SECTION_NEW = 'sec-chrono-new';
    const SECTION_OLD = 'sec-chrono-old';
    const STUDENT = 'student-chrono';

    const oldClassShape = {
      id: CLASS_OLD, name: 'English 6 (Old)', subject: 'English', gradeLevel: 'Grade 6',
      section: { id: SECTION_OLD, name: 'Masaya', gradeLevel: 'Grade 6' },
    };
    const carried = (id, title, component, score, createdAt) => ({
      id, studentId: STUDENT, activityId: `act-${id}`, status: 'GRADED',
      hitlScore: score, aiScore: null, hitlFeedback: null, aiFeedback: null,
      archivedAt: null, excusedAt: null, excusedReason: null, isLate: false,
      createdAt, gradedAt: createdAt, releasedAt: null,
      activity: {
        id: `act-${id}`, title, points: 100, component, deadline: createdAt, classId: CLASS_OLD,
        class: oldClassShape,
      },
    });

    prismaFake.class.findMany.mockImplementation(({ where }) => {
      if (where?.teacherId) {
        return Promise.resolve([{
          id: CLASS_NEW, name: 'English 6', subject: 'English', gradeLevel: 'Grade 6',
          teacherId: T1, sectionId: SECTION_NEW,
          section: { id: SECTION_NEW, name: 'Masipag', students: [{ id: STUDENT, name: 'Maria Clara', username: 'maria' }] },
        }]);
      }
      if (where?.sectionId?.in?.includes(SECTION_OLD)) {
        return Promise.resolve([{ id: CLASS_OLD, subject: 'English', gradeLevel: 'Grade 6', schoolYear: '2026-2027', sectionId: SECTION_OLD }]);
      }
      return Promise.resolve([]);
    });
    prismaFake.class.findUnique.mockImplementation(({ where }) => (
      where.id === CLASS_NEW
        ? Promise.resolve({ id: CLASS_NEW, subject: 'English', gradeLevel: 'Grade 6', schoolYear: '2026-2027', sectionId: SECTION_NEW })
        : Promise.resolve(null)
    ));
    prismaFake.sectionTransfer.findMany.mockResolvedValue([
      { studentId: STUDENT, fromSectionId: SECTION_OLD, toSectionId: SECTION_NEW },
    ]);
    prismaFake.submission.findMany.mockImplementation(({ where }) => {
      if (where.archivedAt === null) {
        if (!where.activity.classId.in.includes(CLASS_OLD)) return Promise.resolve([]);
        return Promise.resolve([
          carried('sub-chrono-ww', 'Old WW', 'WW', 88, '2026-01-05T00:00:00Z'),
          carried('sub-chrono-pt', 'Old PT', 'PT', 90, '2026-01-06T00:00:00Z'),
          carried('sub-chrono-qa', 'Old QA', 'QA', 85, '2026-01-07T00:00:00Z'),
        ]);
      }
      return Promise.resolve([{
        id: 'sub-chrono-own', studentId: STUDENT, status: 'GRADED', hitlScore: 55, aiScore: null,
        skillScores: null, createdAt: '2026-06-01T00:00:00Z',
        activity: {
          id: 'act-chrono-own', title: 'June WW', type: 'WRITTEN_WORK', points: 100, classId: CLASS_NEW,
          component: 'WW', rubric: null, classLesson: null,
          class: { subject: 'English', gradeLevel: 'Grade 6' },
        },
      }]);
    });

    const res = await call('GET', `/api/teacher/${T1}/analytics`, { token: tokenFor({ id: T1 }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    const trend = body.studentTrends.find(t => t.student.id === STUDENT);

    // (a) "Latest" is the June work she actually did most recently, not the
    // January QA that happened to be appended last.
    expect(trend.latest.activityTitle).toBe('June WW');
    expect(trend.latest.percent).toBe(55);
    // (b) The sparkline runs oldest -> newest, so its trailing point is 55.
    expect(trend.history).toEqual([88, 90, 85, 55]);
    // (c) Her real slide is caught. On the unsorted array the last three read
    // 88, 90, 85 and the check does not fire at all.
    const maria = body.needsSupport.find(s => s.student.id === STUDENT);
    expect(maria?.reasons.some(r => r.kind === 'trend')).toBe(true);
  });

  it('a student who left the section is absent from studentTrends and needsSupport, but their mark before leaving still counts in the class record', async () => {
    // No transferredOut flag exists (removed — see the comment in server.js
    // above the "A learner who transferred out" heading for why one can
    // never be correct here). This pins the structural property that stands
    // in for it: `uniqueStudents` is built from the section's CURRENT roster
    // (`classes[].section.students`), so a student who has actually left is
    // simply not in it — never reaches studentTrends, never reaches
    // needsSupport. Their graded work is untouched: `graded` is scoped by
    // the activity's class, not by who is enrolled today, so it still
    // contributes to the class's per-activity record (activityBreakdown)
    // and gradedCount exactly as before they left.
    const CLASS_A = 'class-left-a';
    const SECTION_A = 'sec-left-a';
    const STUDENT_LEFT = 'student-left';
    const STUDENT_STAYED = 'student-stayed';

    prismaFake.class.findMany.mockImplementation(({ where }) => {
      if (where?.teacherId) {
        return Promise.resolve([{
          id: CLASS_A, name: 'Math A', subject: 'Math', gradeLevel: 'Grade 6',
          teacherId: T1, sectionId: SECTION_A,
          // Current roster: only the student who stayed. User.sectionId for
          // STUDENT_LEFT no longer points here, so they are absent from this
          // list even though they have graded work in this class.
          section: { id: SECTION_A, name: 'Masipag', students: [{ id: STUDENT_STAYED, name: 'Stayed Student', username: 'stayed' }] },
        }]);
      }
      return Promise.resolve([]);
    });

    prismaFake.class.findUnique.mockResolvedValue({ id: CLASS_A, subject: 'Math', gradeLevel: 'Grade 6', schoolYear: '2026-2027', sectionId: SECTION_A });

    prismaFake.submission.findMany.mockResolvedValue([
      {
        id: 'sub-left-1', studentId: STUDENT_LEFT, status: 'GRADED', hitlScore: 40, aiScore: null, skillScores: null, createdAt: '2026-05-01T00:00:00Z',
        activity: {
          id: 'act-left-1', title: 'Quiz (before they left)', type: 'QUIZ', points: 100, classId: CLASS_A, component: 'WW',
          rubric: null, classLesson: null,
          class: { subject: 'Math', gradeLevel: 'Grade 6' },
        },
      },
      {
        id: 'sub-stayed-1', studentId: STUDENT_STAYED, status: 'GRADED', hitlScore: 90, aiScore: null, skillScores: null, createdAt: '2026-05-02T00:00:00Z',
        activity: {
          id: 'act-stayed-1', title: 'Quiz (still enrolled)', type: 'QUIZ', points: 100, classId: CLASS_A, component: 'WW',
          rubric: null, classLesson: null,
          class: { subject: 'Math', gradeLevel: 'Grade 6' },
        },
      },
    ]);

    const res = await call('GET', `/api/teacher/${T1}/analytics`, { token: tokenFor({ id: T1 }) });
    expect(res.status).toBe(200);
    const body = await res.json();

    // Absent from studentTrends and needsSupport — never reachable, since
    // uniqueStudents never contained them.
    expect(body.studentTrends.find(t => t.student.id === STUDENT_LEFT)).toBeUndefined();
    expect(body.needsSupport.find(n => n.student.id === STUDENT_LEFT)).toBeUndefined();

    // Their mark before leaving still shows up in the class's own record:
    // gradedCount counts both submissions, and the activity they did still
    // reports the score they actually got.
    expect(body.summary.gradedCount).toBe(2);
    const activity = body.activityBreakdown.find(a => a.id === 'act-left-1');
    expect(activity).toBeDefined();
    expect(activity.avgPercent).toBe(40);

    // The student who stayed is unaffected.
    expect(body.studentTrends.find(t => t.student.id === STUDENT_STAYED)).toBeDefined();
  });

  it('does not double-count a submission from a class the teacher owns on both sides of the transfer', async () => {
    // T1 is a self-contained homeroom teacher running two sections of Math.
    // The student moved from the old section to the new one; both classes
    // are T1's own, so the old class's graded submission is already in
    // `graded` (scoped by activity.classId across ALL of T1's classIds).
    // carriedOverForClass, asked per-class for "what did this student do
    // elsewhere that counts here", finds that same old-class submission
    // again (it matches on subject/gradeLevel/schoolYear). Pooling it a
    // second time would double the student's gradedCount and skew avgPercent
    // toward that one mark. This test fails without the
    // `!classIds.includes(...)` guard: gradedCount comes back 3, not 2, and
    // avgPercent 80, not 75.
    const CLASS_OLD = 'class-dc-old';
    const CLASS_NEW = 'class-dc-new';
    const SECTION_OLD = 'sec-dc-old';
    const SECTION_NEW = 'sec-dc-new';
    const STUDENT = 'student-dc';

    prismaFake.class.findMany.mockImplementation(({ where }) => {
      if (where?.teacherId) {
        return Promise.resolve([
          {
            id: CLASS_OLD, name: 'Math (Old)', subject: 'Math', gradeLevel: 'Grade 6',
            teacherId: T1, sectionId: SECTION_OLD,
            section: { id: SECTION_OLD, name: 'Masipag', students: [] },
          },
          {
            id: CLASS_NEW, name: 'Math (New)', subject: 'Math', gradeLevel: 'Grade 6',
            teacherId: T1, sectionId: SECTION_NEW,
            section: { id: SECTION_NEW, name: 'Masaya', students: [{ id: STUDENT, name: 'Moved Student', username: 'moved' }] },
          },
        ]);
      }
      if (where?.sectionId?.in?.includes(SECTION_OLD)) {
        return Promise.resolve([{ id: CLASS_OLD, subject: 'Math', gradeLevel: 'Grade 6', schoolYear: '2026-2027' }]);
      }
      return Promise.resolve([]);
    });

    prismaFake.class.findUnique.mockImplementation(({ where }) => {
      if (where.id === CLASS_OLD) return Promise.resolve({ id: CLASS_OLD, subject: 'Math', gradeLevel: 'Grade 6', schoolYear: '2026-2027', sectionId: SECTION_OLD });
      if (where.id === CLASS_NEW) return Promise.resolve({ id: CLASS_NEW, subject: 'Math', gradeLevel: 'Grade 6', schoolYear: '2026-2027', sectionId: SECTION_NEW });
      return Promise.resolve(null);
    });

    prismaFake.sectionTransfer.findMany.mockResolvedValue([
      { studentId: STUDENT, fromSectionId: SECTION_OLD, toSectionId: SECTION_NEW },
    ]);

    prismaFake.submission.findMany.mockImplementation(({ where }) => {
      if (where.archivedAt === null) {
        // carriedOverForClass's own lookup — finds the SAME old-class
        // submission that `graded` below already has.
        if (!where.activity.classId.in.includes(CLASS_OLD)) return Promise.resolve([]);
        return Promise.resolve([{
          id: 'sub-dc-old', studentId: STUDENT, activityId: 'act-dc-old', status: 'GRADED',
          hitlScore: 90, aiScore: null, hitlFeedback: null, aiFeedback: null,
          archivedAt: null, excusedAt: null, excusedReason: null, isLate: false,
          gradedAt: '2026-01-05T00:00:00Z', releasedAt: null,
          activity: {
            id: 'act-dc-old', title: 'Old Quiz', points: 100, component: 'WW', deadline: '2026-01-01T00:00:00Z', classId: CLASS_OLD,
            class: { id: CLASS_OLD, name: 'Math (Old)', subject: 'Math', gradeLevel: 'Grade 6', section: { id: SECTION_OLD, name: 'Masipag', gradeLevel: 'Grade 6' } },
          },
        }]);
      }
      // The endpoint's own `graded` query — already spans both of T1's
      // classes, old and new.
      return Promise.resolve([
        {
          id: 'sub-dc-old', studentId: STUDENT, status: 'GRADED', hitlScore: 90, aiScore: null, skillScores: null, createdAt: '2026-01-05T00:00:00Z',
          activity: {
            id: 'act-dc-old', title: 'Old Quiz', type: 'QUIZ', points: 100, classId: CLASS_OLD, component: 'WW',
            rubric: null, classLesson: null,
            class: { subject: 'Math', gradeLevel: 'Grade 6' },
          },
        },
        {
          id: 'sub-dc-new', studentId: STUDENT, status: 'GRADED', hitlScore: 60, aiScore: null, skillScores: null, createdAt: '2026-06-01T00:00:00Z',
          activity: {
            id: 'act-dc-new', title: 'New Quiz', type: 'QUIZ', points: 100, classId: CLASS_NEW, component: 'WW',
            rubric: null, classLesson: null,
            class: { subject: 'Math', gradeLevel: 'Grade 6' },
          },
        },
      ]);
    });

    const res = await call('GET', `/api/teacher/${T1}/analytics`, { token: tokenFor({ id: T1 }) });
    expect(res.status).toBe(200);
    const body = await res.json();

    const trend = body.studentTrends.find(t => t.student.id === STUDENT);
    expect(trend).toBeDefined();
    expect(trend.gradedCount).toBe(2); // own two marks, not the old one counted twice
    expect(trend.avgPercent).toBe(75); // (60 + 90) / 2, points-weighted, single WW component — 80 would mean the 90 counted twice
  });

  it('does not double-count a FOREIGN class\'s carried work across two of the teacher\'s own same-key classes', async () => {
    // CRITICAL-1 from the final review. Different shape from the test above:
    // there the same class appeared on both sides (own class == source
    // class), and the `!classIds.includes(...)` guard alone was enough. Here
    // T1 is an ordinary departmentalised Grade 6 English teacher running TWO
    // of his own sections — CLASS_B and CLASS_C, same (subject, gradeLevel,
    // schoolYear) key — and the source class the student transferred out of
    // (CLASS_FOREIGN) belongs to a THIRD, unrelated teacher. carriedOverForClass
    // matches purely on classKey, so asking it once for CLASS_B and once for
    // CLASS_C both find CLASS_FOREIGN and both return the SAME submission.
    // The `!classIds.includes(...)` guard does not catch this — CLASS_FOREIGN
    // is in neither class's classIds — so only a dedupe that spans the WHOLE
    // loop (not reset per class) can stop it being pooled twice.
    const CLASS_B = 'class-cc1-eng-b';
    const CLASS_C = 'class-cc1-eng-c';
    const SECTION_B = 'sec-cc1-b';
    const SECTION_C = 'sec-cc1-c';
    const SECTION_FOREIGN = 'sec-cc1-foreign';
    const CLASS_FOREIGN = 'class-cc1-foreign';
    const STUDENT = 'student-cc1';

    prismaFake.class.findMany.mockImplementation(({ where }) => {
      if (where?.teacherId) {
        return Promise.resolve([
          {
            id: CLASS_B, name: 'English 6 (Masipag)', subject: 'English', gradeLevel: 'Grade 6',
            teacherId: T1, sectionId: SECTION_B,
            section: { id: SECTION_B, name: 'Masipag', students: [] },
          },
          {
            id: CLASS_C, name: 'English 6 (Masaya)', subject: 'English', gradeLevel: 'Grade 6',
            teacherId: T1, sectionId: SECTION_C,
            section: { id: SECTION_C, name: 'Masaya', students: [{ id: STUDENT, name: 'Cross Count Student', username: 'crosscount' }] },
          },
        ]);
      }
      if (where?.sectionId?.in?.includes(SECTION_FOREIGN)) {
        return Promise.resolve([{ id: CLASS_FOREIGN, subject: 'English', gradeLevel: 'Grade 6', schoolYear: '2026-2027' }]);
      }
      return Promise.resolve([]);
    });

    prismaFake.class.findUnique.mockImplementation(({ where }) => {
      if (where.id === CLASS_B) return Promise.resolve({ id: CLASS_B, subject: 'English', gradeLevel: 'Grade 6', schoolYear: '2026-2027', sectionId: SECTION_B });
      if (where.id === CLASS_C) return Promise.resolve({ id: CLASS_C, subject: 'English', gradeLevel: 'Grade 6', schoolYear: '2026-2027', sectionId: SECTION_C });
      return Promise.resolve(null);
    });

    prismaFake.sectionTransfer.findMany.mockResolvedValue([
      { studentId: STUDENT, fromSectionId: SECTION_FOREIGN, toSectionId: SECTION_C },
    ]);

    prismaFake.submission.findMany.mockImplementation(({ where }) => {
      if (where.archivedAt === null) {
        // carriedOverForClass's own lookup. Both the CLASS_B and CLASS_C
        // iterations land here and both match CLASS_FOREIGN — this is not
        // filtered by which of T1's classes triggered the lookup.
        if (!where.activity.classId.in.includes(CLASS_FOREIGN)) return Promise.resolve([]);
        return Promise.resolve([{
          id: 'sub-cc1-foreign', studentId: STUDENT, activityId: 'act-cc1-foreign', status: 'GRADED',
          hitlScore: 90, aiScore: null, hitlFeedback: null, aiFeedback: null,
          archivedAt: null, excusedAt: null, excusedReason: null, isLate: false,
          gradedAt: '2026-01-05T00:00:00Z', releasedAt: null,
          activity: {
            id: 'act-cc1-foreign', title: 'Foreign WW', points: 100, component: 'WW', deadline: '2026-01-01T00:00:00Z', classId: CLASS_FOREIGN,
            class: { id: CLASS_FOREIGN, name: 'English 6 (Foreign)', subject: 'English', gradeLevel: 'Grade 6', section: { id: SECTION_FOREIGN, name: 'Foreign Section', gradeLevel: 'Grade 6' } },
          },
        }]);
      }
      // The endpoint's own `graded` query — scoped to CLASS_B/CLASS_C, so it
      // never contains CLASS_FOREIGN's row.
      return Promise.resolve([{
        id: 'sub-cc1-own', studentId: STUDENT, status: 'GRADED', hitlScore: 60, aiScore: null, skillScores: null, createdAt: '2026-06-01T00:00:00Z',
        activity: {
          id: 'act-cc1-own', title: 'Own WW', type: 'QUIZ', points: 100, classId: CLASS_C, component: 'WW',
          rubric: null, classLesson: null,
          class: { subject: 'English', gradeLevel: 'Grade 6' },
        },
      }]);
    });

    const res = await call('GET', `/api/teacher/${T1}/analytics`, { token: tokenFor({ id: T1 }) });
    expect(res.status).toBe(200);
    const body = await res.json();

    const trend = body.studentTrends.find(t => t.student.id === STUDENT);
    expect(trend).toBeDefined();
    // 1 own + 1 foreign carried, pooled once even though the loop asked
    // twice — NOT 3, which is what pooling CLASS_FOREIGN's row on both the
    // CLASS_B and CLASS_C iterations would give.
    expect(trend.gradedCount).toBe(2);
    expect(trend.avgPercent).toBe(75); // (60 + 90) / 200 * 100 — 80 would mean the foreign 90 counted twice
  });

  it('CRITICAL-2: an unvalidated carried AI draft does not become a grade of record', async () => {
    // The main `graded` query is scoped `status: 'GRADED'`, so byStudent
    // normally holds only grades of record. Before this fix, carried rows
    // entered unfiltered — an AI-scored submission the sending teacher never
    // validated (status still SUBMITTED) would be pooled and counted exactly
    // like a real mark, which is the bug grading.countsAsGrade exists to
    // prevent everywhere else in this file.
    const CLASS_NEW = 'class-cg2-new';
    const CLASS_OLD = 'class-cg2-old';
    const SECTION_NEW = 'sec-cg2-new';
    const SECTION_OLD = 'sec-cg2-old';
    const STUDENT = 'student-cg2';

    prismaFake.class.findMany.mockImplementation(({ where }) => {
      if (where?.teacherId) {
        return Promise.resolve([{
          id: CLASS_NEW, name: 'English 6', subject: 'English', gradeLevel: 'Grade 6',
          teacherId: T1, sectionId: SECTION_NEW,
          section: { id: SECTION_NEW, name: 'New Section', students: [{ id: STUDENT, name: 'Unvalidated Draft Student', username: 'unval' }] },
        }]);
      }
      if (where?.sectionId?.in?.includes(SECTION_OLD)) {
        return Promise.resolve([{ id: CLASS_OLD, subject: 'English', gradeLevel: 'Grade 6', schoolYear: '2026-2027' }]);
      }
      return Promise.resolve([]);
    });

    prismaFake.class.findUnique.mockImplementation(({ where }) => (
      where.id === CLASS_NEW
        ? Promise.resolve({ id: CLASS_NEW, subject: 'English', gradeLevel: 'Grade 6', schoolYear: '2026-2027', sectionId: SECTION_NEW })
        : Promise.resolve(null)
    ));

    prismaFake.sectionTransfer.findMany.mockResolvedValue([
      { studentId: STUDENT, fromSectionId: SECTION_OLD, toSectionId: SECTION_NEW },
    ]);

    prismaFake.submission.findMany.mockImplementation(({ where }) => {
      if (where.archivedAt === null) {
        if (!where.activity.classId.in.includes(CLASS_OLD)) return Promise.resolve([]);
        // AI-scored 90, never signed off by the sending teacher — status
        // stays short of GRADED.
        return Promise.resolve([{
          id: 'sub-cg2-draft', studentId: STUDENT, activityId: 'act-cg2-draft', status: 'SUBMITTED',
          hitlScore: null, aiScore: 90, hitlFeedback: null, aiFeedback: null,
          archivedAt: null, excusedAt: null, excusedReason: null, isLate: false,
          gradedAt: null, releasedAt: null,
          activity: {
            id: 'act-cg2-draft', title: 'Unvalidated PT', points: 100, component: 'PT', deadline: '2026-01-01T00:00:00Z', classId: CLASS_OLD,
            class: { id: CLASS_OLD, name: 'English 6 (Old)', subject: 'English', gradeLevel: 'Grade 6', section: { id: SECTION_OLD, name: 'Old Section', gradeLevel: 'Grade 6' } },
          },
        }]);
      }
      return Promise.resolve([{
        id: 'sub-cg2-own', studentId: STUDENT, status: 'GRADED', hitlScore: 70, aiScore: null, skillScores: null, createdAt: '2026-06-01T00:00:00Z',
        activity: {
          id: 'act-cg2-own', title: 'Own WW', type: 'QUIZ', points: 100, classId: CLASS_NEW, component: 'WW',
          rubric: null, classLesson: null,
          class: { subject: 'English', gradeLevel: 'Grade 6' },
        },
      }]);
    });

    const res = await call('GET', `/api/teacher/${T1}/analytics`, { token: tokenFor({ id: T1 }) });
    expect(res.status).toBe(200);
    const body = await res.json();

    const trend = body.studentTrends.find(t => t.student.id === STUDENT);
    expect(trend).toBeDefined();
    // Only the own, validated WW — the unvalidated carried PT never entered.
    expect(trend.gradedCount).toBe(1);
    expect(trend.avgPercent).toBe(70);
  });

  it('CRITICAL-2: a scoreless carried excused row does not become a phantom zero', async () => {
    // percents = subs.map(s => s.hitlScore ?? s.aiScore ?? 0). A carried row
    // the sending teacher excused (illness, etc. — both scores null) used to
    // fall through that `?? 0` unfiltered, polluting history, latest and the
    // "Scores easing down" trend with a zero the student never earned.
    const CLASS_NEW = 'class-cg3-new';
    const CLASS_OLD = 'class-cg3-old';
    const SECTION_NEW = 'sec-cg3-new';
    const SECTION_OLD = 'sec-cg3-old';
    const STUDENT = 'student-cg3';

    prismaFake.class.findMany.mockImplementation(({ where }) => {
      if (where?.teacherId) {
        return Promise.resolve([{
          id: CLASS_NEW, name: 'English 6', subject: 'English', gradeLevel: 'Grade 6',
          teacherId: T1, sectionId: SECTION_NEW,
          section: { id: SECTION_NEW, name: 'New Section', students: [{ id: STUDENT, name: 'Excused Carry Student', username: 'excar' }] },
        }]);
      }
      if (where?.sectionId?.in?.includes(SECTION_OLD)) {
        return Promise.resolve([{ id: CLASS_OLD, subject: 'English', gradeLevel: 'Grade 6', schoolYear: '2026-2027' }]);
      }
      return Promise.resolve([]);
    });

    prismaFake.class.findUnique.mockImplementation(({ where }) => (
      where.id === CLASS_NEW
        ? Promise.resolve({ id: CLASS_NEW, subject: 'English', gradeLevel: 'Grade 6', schoolYear: '2026-2027', sectionId: SECTION_NEW })
        : Promise.resolve(null)
    ));

    prismaFake.sectionTransfer.findMany.mockResolvedValue([
      { studentId: STUDENT, fromSectionId: SECTION_OLD, toSectionId: SECTION_NEW },
    ]);

    prismaFake.submission.findMany.mockImplementation(({ where }) => {
      if (where.archivedAt === null) {
        if (!where.activity.classId.in.includes(CLASS_OLD)) return Promise.resolve([]);
        // Excused for illness before she moved — both scores null.
        return Promise.resolve([{
          id: 'sub-cg3-excused', studentId: STUDENT, activityId: 'act-cg3-excused', status: 'GRADED',
          hitlScore: null, aiScore: null, hitlFeedback: null, aiFeedback: null,
          archivedAt: null, excusedAt: '2026-01-01T00:00:00Z', excusedReason: 'Illness', isLate: false,
          gradedAt: null, releasedAt: null,
          activity: {
            id: 'act-cg3-excused', title: 'Excused QA', points: 100, component: 'QA', deadline: '2026-01-01T00:00:00Z', classId: CLASS_OLD,
            class: { id: CLASS_OLD, name: 'English 6 (Old)', subject: 'English', gradeLevel: 'Grade 6', section: { id: SECTION_OLD, name: 'Old Section', gradeLevel: 'Grade 6' } },
          },
        }]);
      }
      return Promise.resolve([{
        id: 'sub-cg3-own', studentId: STUDENT, status: 'GRADED', hitlScore: 70, aiScore: null, skillScores: null, createdAt: '2026-06-01T00:00:00Z',
        activity: {
          id: 'act-cg3-own', title: 'Own WW', type: 'QUIZ', points: 100, classId: CLASS_NEW, component: 'WW',
          rubric: null, classLesson: null,
          class: { subject: 'English', gradeLevel: 'Grade 6' },
        },
      }]);
    });

    const res = await call('GET', `/api/teacher/${T1}/analytics`, { token: tokenFor({ id: T1 }) });
    expect(res.status).toBe(200);
    const body = await res.json();

    const trend = body.studentTrends.find(t => t.student.id === STUDENT);
    expect(trend).toBeDefined();
    // Only the own, validated WW — the excused carried QA never entered, so
    // no phantom 0 anywhere: not in gradedCount, not in avgPercent, not in
    // history.
    expect(trend.gradedCount).toBe(1);
    expect(trend.avgPercent).toBe(70);
    expect(trend.history).toEqual([70]);
  });
});

describe('a section\'s skill-progress timeline is stable when a student leaves', () => {
  const SECTION = 'sec-a';
  const url = `/api/teacher/${T1}/section/${SECTION}/skill-progress`;

  const query = async () => {
    await call('GET', url, { token: tokenFor({ id: T1, schoolId: SCHOOL_A }) });
    return prismaFake.submission.findMany.mock.calls[0][0].where;
  };

  it('scopes by the activity\'s section, never by where the student is now', async () => {
    const where = await query();

    // A submission on this section's activity can only have come from someone
    // enrolled here at the time. `student: { sectionId }` re-tested enrolment
    // against *now*, which is what erased a departed learner's work from the
    // section's past.
    expect(where.activity).toEqual({ class: { teacherId: T1, sectionId: SECTION } });
    expect(where.student).toBeUndefined();
  });

  it('still excludes auto-excused transfer rows, which carry no rubric', async () => {
    const where = await query();
    expect(where.rubricData).toEqual({ not: null });
    expect(where.status).toBe('GRADED');
  });
});

describe('P7 invariant: a move does not change the admin student count', () => {
  it('never widens the Section.students relation itself', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');

    // Admin analytics builds its student set from this relation and dedupes by
    // id (server.js ~1757); QA test P7 asserts the Students tile and the class
    // spread bar agree. Widening the relation would put a transferred learner
    // in two sections at once and break that. The widening belongs in the
    // gradebook endpoint's response shaping, and only there.
    const adminAnalytics = src.slice(src.indexOf("app.get('/api/admin/:adminId/analytics'"));
    const body = adminAnalytics.slice(0, adminAnalytics.indexOf('\napp.'));
    expect(body).not.toMatch(/sectionTransfer/);
  });
});

// ───────────────────────────────────────────────────────────────────
// GET /api/teacher/:teacherId/gradebook — the sending teacher's roster
// ───────────────────────────────────────────────────────────────────

describe('GET /api/teacher/:teacherId/gradebook keeps a transferred-out learner on the sending roster', () => {
  const CLASS = 'class-gb-1';
  const SECTION = 'section-gb-old';
  const STAYED = 'student-gb-stayed';
  const LEFT = 'student-gb-left';
  const RETURNED = 'student-gb-returned';
  const LEFT_AT = '2026-07-01T00:00:00.000Z';

  const armClasses = (students) => {
    prismaFake.activity.findMany.mockResolvedValue([]);
    prismaFake.class.findMany.mockResolvedValue([{
      id: CLASS, name: 'Class', teacherId: T1, sectionId: SECTION,
      section: { id: SECTION, name: 'Section', students },
    }]);
  };

  const fetchStudents = async () => {
    const res = await call('GET', `/api/teacher/${T1}/gradebook`, { token: tokenFor({ id: T1 }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    return body.classes[0].section.students;
  };

  it('flags a departed learner transferredOut with the date they left, and leaves current students unflagged', async () => {
    armClasses([{ id: STAYED, name: 'Stayed Learner', username: 'stayed' }]);
    prismaFake.sectionTransfer.findMany.mockResolvedValue([
      { studentId: LEFT, fromSectionId: SECTION, transferredAt: LEFT_AT },
    ]);
    prismaFake.user.findMany.mockResolvedValue([
      { id: LEFT, name: 'Left Learner', username: 'left', sectionId: 'section-gb-new' },
    ]);

    const students = await fetchStudents();

    const stayed = students.find(s => s.id === STAYED);
    expect(stayed.transferredOut).toBe(false);
    expect(stayed.transferredOutAt).toBeNull();

    const left = students.find(s => s.id === LEFT);
    expect(left).toBeDefined();
    expect(left.transferredOut).toBe(true);
    expect(left.transferredOutAt).toBe(LEFT_AT);
  });

  it('does not flag a learner who left and came back as transferred out', async () => {
    // She has a SectionTransfer row out of this section, but her current
    // sectionId is this section again — she is on the roster the normal way,
    // via Section.students. An earlier task shipped exactly the inverted bug
    // (flagging a returning student as departed) and it had to be reverted.
    armClasses([{ id: RETURNED, name: 'Returned Learner', username: 'returned' }]);
    prismaFake.sectionTransfer.findMany.mockResolvedValue([
      { studentId: RETURNED, fromSectionId: SECTION, transferredAt: LEFT_AT },
    ]);
    prismaFake.user.findMany.mockResolvedValue([
      { id: RETURNED, name: 'Returned Learner', username: 'returned', sectionId: SECTION },
    ]);

    const students = await fetchStudents();

    expect(students).toHaveLength(1);
    expect(students[0].id).toBe(RETURNED);
    expect(students[0].transferredOut).toBe(false);
  });

  it('does not query sectionTransfer when the teacher has no classes', async () => {
    prismaFake.activity.findMany.mockResolvedValue([]);
    prismaFake.class.findMany.mockResolvedValue([]);

    const res = await call('GET', `/api/teacher/${T1}/gradebook`, { token: tokenFor({ id: T1 }) });
    expect(res.status).toBe(200);
    expect(prismaFake.sectionTransfer.findMany).not.toHaveBeenCalled();
  });
});

describe('excusing a student who has since transferred out', () => {
  const url = '/api/teacher/submissions/excuse';

  it('lets the owning teacher excuse work set while the student was enrolled', async () => {
    prismaFake.submission.findUnique.mockResolvedValue({
      id: SUBMISSION, activity: { type: 'Essay', class: { teacherId: T1 } },
    });
    prismaFake.activity.findUnique.mockResolvedValue({
      id: ACTIVITY, class: { teacherId: T1, sectionId: 'sec-a' },
    });
    // She is in sec-b now, but she was in sec-a when this was set.
    prismaFake.user.findUnique.mockResolvedValue({
      id: 'maria', role: 'STUDENT', sectionId: 'sec-b', sessionsValidFrom: null,
    });
    prismaFake.sectionTransfer.findFirst.mockResolvedValue({
      studentId: 'maria', fromSectionId: 'sec-a',
    });
    prismaFake.submission.findFirst.mockResolvedValue({ id: SUBMISSION });

    const res = await call('POST', url, {
      token: tokenFor({ id: T1, schoolId: SCHOOL_A }),
      body: { activityId: ACTIVITY, studentId: 'maria', excused: true, reason: 'Was on school representation' },
    });

    expect(res.status).toBe(200);
    expect(prismaFake.submission.update).toHaveBeenCalled();

    // `studentId` alone would let a teacher excuse any learner who has ever
    // transferred out of ANY section, anywhere — it is the pairing with THIS
    // activity's own section (`fromSectionId`) that keeps the check honest.
    // Assert both fields explicitly so a future "simplification" that drops
    // one of them fails loudly here instead of silently widening access.
    const { where } = prismaFake.sectionTransfer.findFirst.mock.calls[0][0];
    expect(where.studentId).toBe('maria');
    expect(where.fromSectionId).toBe('sec-a');
  });

  it('still 404s for a student who was never in the section at all', async () => {
    prismaFake.activity.findUnique.mockResolvedValue({
      id: ACTIVITY, class: { teacherId: T1, sectionId: 'sec-a' },
    });
    prismaFake.user.findUnique.mockResolvedValue({
      id: 'stranger', role: 'STUDENT', sectionId: 'sec-z', sessionsValidFrom: null,
    });
    prismaFake.sectionTransfer.findFirst.mockResolvedValue(null);

    const res = await call('POST', url, {
      token: tokenFor({ id: T1, schoolId: SCHOOL_A }),
      body: { activityId: ACTIVITY, studentId: 'stranger', excused: true },
    });

    expect(res.status).toBe(404);
    expect(prismaFake.submission.create).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────
// Badges: what the learner is told, and what never leaves the server
// ───────────────────────────────────────────────────────────────────

describe('GET /api/student/:id/dashboard badges', () => {
  const STUDENT = 'student-badges';
  const SECTION = 'sec-badges';

  /** A graded, released submission for this learner. */
  const graded = (percent, day) => ({
    id: `sub-${day}`,
    studentId: STUDENT,
    hitlScore: percent,
    aiScore: null,
    status: 'GRADED',
    isLate: false,
    readingStrategy: null,
    skillScores: null,
    gradedAt: `2026-03-0${day}T00:00:00Z`,
    createdAt: `2026-03-0${day}T00:00:00Z`,
    updatedAt: `2026-03-0${day}T00:00:00Z`,
    releasedAt: new Date(),
    activity: { type: 'Essay', points: 100, class: { subject: 'English', gradeLevel: 'Grade 6' } },
  });

  const armStudent = ({ own = [], storedBadges = [] } = {}) => {
    prismaFake.user.findUnique.mockImplementation(({ where }) => {
      if (where.id === STUDENT) {
        return Promise.resolve({
          id: STUDENT, name: 'Badge Learner', username: 'badge-1',
          sectionId: SECTION, schoolId: null, sessionsValidFrom: null,
          section: { id: SECTION, schoolId: null, classes: [] },
        });
      }
      return Promise.resolve({ sessionsValidFrom: null });
    });
    prismaFake.submission.findMany.mockResolvedValue(own);
    prismaFake.studentBadge.findMany.mockResolvedValue(storedBadges.map(badgeId => ({ badgeId })));
    prismaFake.activity.findMany.mockResolvedValue([]);
  };

  const fetchBadges = async () => {
    const res = await call('GET', `/api/student/${STUDENT}/dashboard`, {
      token: tokenFor({ id: STUDENT, role: 'STUDENT' }),
    });
    expect(res.status).toBe(200);
    return (await res.json()).badges;
  };

  it('returns the full badge set with earned flags', async () => {
    armStudent({ own: [graded(95, 1)] });

    const badges = await fetchBadges();
    expect(badges).toHaveLength(15);
    expect(badges.find(b => b.id === 'first-steps').earned).toBe(true);
    expect(badges.find(b => b.id === 'first-star').earned).toBe(true);
    expect(badges.find(b => b.id === 'dedicated').earned).toBe(false);
  });

  it('leaks nothing about a classmate', async () => {
    // The rank query loads the whole section server-side. The response must
    // carry one boolean about this learner and nothing that could be assembled
    // into a leaderboard — no names, no ids, no other averages.
    armStudent({ own: [1, 2, 3, 4, 5].map(d => graded(90, d)) });
    prismaFake.user.findMany.mockResolvedValue([{ id: STUDENT }, { id: 'classmate-1' }]);

    const res = await call('GET', `/api/student/${STUDENT}/dashboard`, {
      token: tokenFor({ id: STUDENT, role: 'STUDENT' }),
    });
    const body = await res.text();

    // The section really was loaded — otherwise this asserts nothing.
    expect(prismaFake.user.findMany).toHaveBeenCalled();
    expect(body).not.toContain('classmate-1');
    const champion = JSON.parse(body).badges.find(b => b.id === 'class-champion');
    expect(Object.keys(champion).sort()).toEqual(
      ['desc', 'earned', 'icon', 'id', 'passingGrade', 'progress', 'target', 'title']
    );
  });

  it('does not run the section query once the badge is already held', async () => {
    // The optimisation that keeps ranking off the hot path: held badges are
    // never recomputed.
    armStudent({ own: [1, 2, 3, 4, 5].map(d => graded(90, d)), storedBadges: ['class-champion'] });

    const badges = await fetchBadges();
    expect(badges.find(b => b.id === 'class-champion').earned).toBe(true);
    expect(prismaFake.user.findMany).not.toHaveBeenCalled();
  });

  it('does not rank a learner with too little work to be ranked fairly', async () => {
    armStudent({ own: [graded(99, 1)] });

    const badges = await fetchBadges();
    expect(prismaFake.user.findMany).not.toHaveBeenCalled();
    expect(badges.find(b => b.id === 'class-champion').earned).toBe(false);
  });

  it('keeps a stored badge earned even when the current data no longer says so', async () => {
    // A re-grade must not take a badge back off a child.
    armStudent({ own: [graded(40, 1)], storedBadges: ['first-star'] });

    const badges = await fetchBadges();
    const firstStar = badges.find(b => b.id === 'first-star');
    expect(firstStar.earned).toBe(true);
    expect(firstStar.progress).toBe(firstStar.target);
  });

  it('writes newly earned badges exactly once, skipping duplicates', async () => {
    armStudent({ own: [graded(95, 1)], storedBadges: ['first-steps'] });

    await fetchBadges();
    expect(prismaFake.studentBadge.createMany).toHaveBeenCalledTimes(1);
    const arg = prismaFake.studentBadge.createMany.mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true);
    // first-steps was already on record, so it is not written again.
    expect(arg.data.map(d => d.badgeId)).not.toContain('first-steps');
    expect(arg.data.map(d => d.badgeId)).toContain('first-star');
  });

  it('still returns badges when the rank query fails', async () => {
    armStudent({ own: [1, 2, 3, 4, 5].map(d => graded(90, d)) });
    prismaFake.user.findMany.mockRejectedValue(new Error('db down'));

    const badges = await fetchBadges();
    expect(badges).toHaveLength(15);
    expect(badges.find(b => b.id === 'class-champion').earned).toBe(false);
    expect(badges.find(b => b.id === 'honor-student').earned).toBe(true);
  });
});

describe('the badge store is an enhancement, not a dependency', () => {
  const STUDENT = 'student-nostore';

  it('still serves the dashboard when StudentBadge cannot be read', async () => {
    // The shape of a deploy where the app is live before its migration is.
    // Losing the trophy cabinet must not cost the learner their dashboard.
    prismaFake.user.findUnique.mockImplementation(({ where }) => {
      if (where.id === STUDENT) {
        return Promise.resolve({
          id: STUDENT, name: 'No Store', username: 'nostore',
          sectionId: null, schoolId: null, sessionsValidFrom: null,
          section: null,
        });
      }
      return Promise.resolve({ sessionsValidFrom: null });
    });
    prismaFake.submission.findMany.mockResolvedValue([{
      id: 'sub-1', studentId: STUDENT, hitlScore: 95, aiScore: null, status: 'GRADED',
      isLate: false, readingStrategy: null, skillScores: null,
      gradedAt: '2026-03-01T00:00:00Z', createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z', releasedAt: new Date(),
      activity: { type: 'Essay', points: 100, class: { subject: 'English', gradeLevel: 'Grade 6' } },
    }]);
    prismaFake.activity.findMany.mockResolvedValue([]);
    prismaFake.studentBadge.findMany.mockRejectedValue(new Error('relation "StudentBadge" does not exist'));

    const res = await call('GET', `/api/student/${STUDENT}/dashboard`, {
      token: tokenFor({ id: STUDENT, role: 'STUDENT' }),
    });

    expect(res.status).toBe(200);
    const { badges } = await res.json();
    expect(badges).toHaveLength(15);
    expect(badges.find(b => b.id === 'first-star').earned).toBe(true);
    // Nothing was written, because nothing could be read.
    expect(prismaFake.studentBadge.createMany).not.toHaveBeenCalled();
  });
});
