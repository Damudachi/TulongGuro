import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

/**
 * Who may create a section or a course shell, and on whose behalf.
 *
 * ── What changed, and why this file was rewritten rather than deleted ──
 *
 * Creating a block section, creating a course shell, enrolling a learner,
 * correcting their name and resetting their password used to be teacher
 * routes. They are the admin's now: the school decides which blocks exist, who
 * advises each one and who teaches what into it, and a teacher works inside
 * that structure rather than building their own copy of it.
 *
 * The old teacher-side create had one property that made it a standing hazard,
 * and it is the reason this file existed in the first place. POST
 * /api/teacher/sections resolved a section by (name, school, school year) and
 * *reused* whatever it found — correct for "add my class list to Sampaguita",
 * but it meant the lookup was scoped to the school and never to the caller. Any
 * teacher who typed an existing name was writing into a roster somebody else
 * advised. The case that surfaced it: an admin reassigns the adviser, and the
 * previous one — who can no longer so much as fix a spelling there — can still
 * enrol learners onto it.
 *
 * The admin routes that replace it do not have that shape. Creating is
 * creating: a name already taken inside the school year is refused, and adding
 * learners to a section that exists is a different URL naming it by id. So the
 * rules worth guarding are different rules, and they are what this file now
 * covers — plus, at the end, that the teacher routes really are gone rather
 * than merely unlinked from the UI.
 *
 * Driven over real HTTP against the real routes, for the same reason
 * route-wiring.test.js is: every defect here is a missing call, and no pure
 * test of the surrounding helpers would notice.
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

process.env.AUTH_SECRET = 'section-adviser-test-secret';
process.env.NODE_ENV = 'test';

const SCHOOL = 'school-a';
const OTHER_SCHOOL = 'school-b';
const ADMIN = 'admin-1';
const ADVISER = 'teacher-adviser';     // the adviser the admin names
const SUBJECT_TEACHER = 'teacher-subject';   // teaches into a block he does not advise
const OUTSIDER = 'teacher-outsider';   // a teacher at another school entirely
const SECTION = 'section-1';
const SECTION_NAME = 'Grade 6 - Sampaguita';
const YEAR = '2026-2027';

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
 * The people these routes look up, answered by id.
 *
 * Answered by query shape rather than with one fixed value, because three
 * different lookups share this mock: the auth middleware's revocation check
 * (by the caller's id), requireAdminSchool and teacherInSchool (by the id in
 * the URL or body), and nextStudentId(), which probes `{ where: { username } }`
 * inside a `for (;;)` and only stops when one comes back free. A blanket
 * mockResolvedValue makes that loop run until the heap gives out.
 */
const DIRECTORY = {
  [ADMIN]: { id: ADMIN, role: 'ADMIN', schoolId: SCHOOL, schoolName: 'Sampaguita ES', school: { id: SCHOOL, name: 'Sampaguita ES' }, sessionsValidFrom: null },
  [ADVISER]: { id: ADVISER, role: 'TEACHER', name: 'Ms. Reyes', schoolId: SCHOOL, sessionsValidFrom: null },
  [SUBJECT_TEACHER]: { id: SUBJECT_TEACHER, role: 'TEACHER', name: 'Mr. Santos', schoolId: SCHOOL, sessionsValidFrom: null },
  [OUTSIDER]: { id: OUTSIDER, role: 'TEACHER', name: 'Ms. Cruz', schoolId: OTHER_SCHOOL, sessionsValidFrom: null },
};

function signedIn() {
  resetPrisma();
  prismaFake.user.findUnique.mockImplementation(({ where } = {}) =>
    Promise.resolve(where?.id ? (DIRECTORY[where.id] || null) : null)
  );
}

const adminToken = () => signToken({ id: ADMIN, role: 'ADMIN', schoolId: SCHOOL });
const teacherToken = (id) => signToken({ id, role: 'TEACHER', schoolId: SCHOOL });

/**
 * A roster entry the enrolment path will actually accept.
 *
 * Birthdays are mandatory (rosterBirthdayProblem, 422) and that check sits
 * above everything else in the handler — so a roster of bare name strings is
 * refused before it reaches the rule under test, and the test fails on the
 * wrong line while looking like it passed for the right reason.
 */
const learner = (name) => ({ name, birthday: '03/15/2014' });

const postSection = (token, body) =>
  fetch(`${baseUrl}/api/admin/${ADMIN}/sections`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const postClass = (token, body) =>
  fetch(`${baseUrl}/api/admin/${ADMIN}/classes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => signedIn());

describe('POST /api/admin/:adminId/sections names an adviser', () => {
  it('refuses a section with no adviser, and creates nothing', async () => {
    const res = await postSection(adminToken(), { name: SECTION_NAME, gradeLevel: 'Grade 6' });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/advise/i);
    // A section with no adviser is a roster nobody is responsible for, and the
    // adviser is read in the teacher's own section list, the setup checklist
    // and teacher handover — all of which would read wrong until somebody
    // noticed. Refusing beats creating one and hoping it is filled in later.
    expect(prismaFake.section.create).not.toHaveBeenCalled();
  });

  it('refuses an adviser from another school', async () => {
    const res = await postSection(adminToken(), {
      name: SECTION_NAME, gradeLevel: 'Grade 6', teacherId: OUTSIDER,
    });

    expect(res.status).toBe(404);
    expect(prismaFake.section.create).not.toHaveBeenCalled();
  });

  it('stores the named adviser, the school and the year', async () => {
    prismaFake.section.create.mockResolvedValue({ id: SECTION, name: SECTION_NAME, teacherId: ADVISER });

    const res = await postSection(adminToken(), {
      name: SECTION_NAME, gradeLevel: 'Grade 6', schoolYear: YEAR, teacherId: ADVISER, studentsList: [],
    });

    expect(res.status).toBe(200);
    const { data } = prismaFake.section.create.mock.calls[0][0];
    expect(data.teacherId).toBe(ADVISER);
    expect(data.schoolId).toBe(SCHOOL);
    // Stamped at creation rather than inferred later: schools reuse block names
    // every year, and a section carrying no year is reused across them.
    expect(data.schoolYear).toBe(YEAR);
  });

  it('creates a section on its own, with no roster at all', async () => {
    // Naming the block and typing forty learners are different jobs, and an
    // admin may well do them a week apart — so an omitted roster is a normal
    // outcome, not a caller mistake. The birthday check and the enrolment loop
    // both have to tolerate the field simply not being there.
    prismaFake.section.create.mockResolvedValue({ id: SECTION, name: SECTION_NAME, teacherId: ADVISER });

    const res = await postSection(adminToken(), { name: SECTION_NAME, teacherId: ADVISER });

    expect(res.status).toBe(200);
    expect(prismaFake.section.create).toHaveBeenCalledTimes(1);
    expect(prismaFake.user.create).not.toHaveBeenCalled();
  });

  it('names the adviser back, so the admin can see who it went to', async () => {
    prismaFake.section.create.mockResolvedValue({ id: SECTION, name: SECTION_NAME, teacherId: ADVISER });

    const body = await (await postSection(adminToken(), {
      name: SECTION_NAME, teacherId: ADVISER, studentsList: [],
    })).json();

    expect(body.section.teacher).toEqual({ id: ADVISER, name: 'Ms. Reyes' });
    expect(body.message).toMatch(/Ms\. Reyes/);
  });
});

describe('POST /api/admin/:adminId/sections refuses a name already in use', () => {
  it('refuses rather than quietly reopening the existing roster', async () => {
    // The whole hazard of the teacher route it replaces: that one resolved a
    // section by name and wrote into whatever it found. Creating is creating.
    prismaFake.section.findFirst.mockResolvedValue({
      id: SECTION, name: SECTION_NAME, schoolYear: YEAR, teacherId: ADVISER,
      teacher: { name: 'Ms. Reyes' },
    });

    const res = await postSection(adminToken(), {
      name: SECTION_NAME, schoolYear: YEAR, teacherId: SUBJECT_TEACHER, studentsList: [learner('Dela Cruz, Juan')],
    });

    expect(res.status).toBe(400);
    expect(prismaFake.section.create).not.toHaveBeenCalled();
    expect(prismaFake.user.create).not.toHaveBeenCalled();
  });

  it('says who advises the section that is in the way', async () => {
    // "That name is taken" with no name attached leaves the admin nobody to go
    // and ask, and no way to tell a clash from a mistake.
    prismaFake.section.findFirst.mockResolvedValue({
      id: SECTION, name: SECTION_NAME, schoolYear: YEAR, teacherId: ADVISER,
      teacher: { name: 'Ms. Reyes' },
    });

    const body = await (await postSection(adminToken(), {
      name: SECTION_NAME, schoolYear: YEAR, teacherId: SUBJECT_TEACHER,
    })).json();

    expect(body.error).toMatch(/Ms\. Reyes/);
    expect(body.error).toMatch(new RegExp(YEAR));
  });
});

describe('POST /api/admin/:adminId/sections requires a real name', () => {
  const rejected = [
    ['the field is missing entirely', {}],
    ['it is an empty string', { name: '' }],
    ['it is only whitespace', { name: '   ' }],
    ['it is a number', { name: 123 }],
    ['it is null', { name: null }],
    ['it is an array', { name: [] }],
  ];

  for (const [label, body] of rejected) {
    it(`400s when ${label}, and creates nothing`, async () => {
      const res = await postSection(adminToken(), { gradeLevel: 'Grade 6', teacherId: ADVISER, ...body });

      expect(res.status).toBe(400);
      expect(prismaFake.section.create).not.toHaveBeenCalled();
    });
  }

  it('explains what is wrong rather than leaking a TypeError', async () => {
    const body = await (await postSection(adminToken(), { gradeLevel: 'Grade 6', teacherId: ADVISER })).json();

    expect(body.success).toBe(false);
    expect(body.error).toMatch(/name/i);
    expect(body.error).not.toMatch(/trim|undefined|TypeError/);
  });

  it('accepts a name padded with spaces, and stores it trimmed', async () => {
    prismaFake.section.create.mockResolvedValue({ id: SECTION, name: SECTION_NAME });

    const res = await postSection(adminToken(), {
      name: `  ${SECTION_NAME}  `, gradeLevel: 'Grade 6', teacherId: ADVISER, studentsList: [],
    });

    expect(res.status).toBe(200);
    expect(prismaFake.section.create).toHaveBeenCalledTimes(1);
    expect(prismaFake.section.create.mock.calls[0][0].data.name).toBe(SECTION_NAME);
  });
});

/**
 * A course shell is created *for* a teacher, in a section that may belong to a
 * colleague — teaching a subject into a block somebody else advises is the
 * ordinary shape of a subject teacher's week. The bar is the school on both
 * sides, and the shell must land on the named teacher rather than on whoever
 * happened to submit the form.
 */
describe('POST /api/admin/:adminId/classes assigns the shell to a named teacher', () => {
  const inSchoolSection = () => prismaFake.section.findUnique.mockResolvedValue({
    id: SECTION, name: SECTION_NAME, schoolId: SCHOOL, teacherId: ADVISER,
    teacher: { id: ADVISER, schoolId: SCHOOL },
  });

  const shell = (over = {}) => ({
    name: 'Filipino 6', gradeLevel: 'Grade 6', subject: 'Filipino',
    schoolYear: YEAR, sectionId: SECTION, teacherId: SUBJECT_TEACHER, ...over,
  });

  it('refuses a shell with no teacher on it', async () => {
    const res = await postClass(adminToken(), shell({ teacherId: undefined }));

    expect(res.status).toBe(400);
    expect(prismaFake.class.create).not.toHaveBeenCalled();
  });

  it('refuses a shell with no section on it', async () => {
    const res = await postClass(adminToken(), shell({ sectionId: undefined }));

    expect(res.status).toBe(400);
    expect(prismaFake.class.create).not.toHaveBeenCalled();
  });

  it('refuses a teacher from another school', async () => {
    inSchoolSection();
    const res = await postClass(adminToken(), shell({ teacherId: OUTSIDER }));

    expect(res.status).toBe(404);
    expect(prismaFake.class.create).not.toHaveBeenCalled();
  });

  it('refuses a section from another school', async () => {
    // Taken on trust, this attaches another school's roster to this teacher's
    // gradebook and analytics, both of which read class.section.students.
    prismaFake.section.findUnique.mockResolvedValue({
      id: 'far-away-section', schoolId: OTHER_SCHOOL, teacherId: 'someone-else',
      teacher: { id: 'someone-else', schoolId: OTHER_SCHOOL },
    });

    const res = await postClass(adminToken(), shell({ sectionId: 'far-away-section' }));

    expect(res.status).toBe(404);
    expect(prismaFake.class.create).not.toHaveBeenCalled();
  });

  it('creates it against the named teacher, not the admin', async () => {
    inSchoolSection();
    prismaFake.class.create.mockResolvedValue({ id: 'class-1', name: 'Filipino 6' });

    const res = await postClass(adminToken(), shell());

    expect(res.status).toBe(200);
    const { data } = prismaFake.class.create.mock.calls[0][0];
    expect(data.teacherId).toBe(SUBJECT_TEACHER);
    expect(data.sectionId).toBe(SECTION);
    // Class.teacherId is what GET /api/teacher/:teacherId/classes reads, so
    // this field alone is what makes the shell appear on the teacher's own
    // dashboard.
    expect(data.schoolYear).toBe(YEAR);
  });

  it('lets a colleague teach into a section they do not advise', async () => {
    inSchoolSection();
    prismaFake.class.create.mockResolvedValue({ id: 'class-2', name: 'Filipino 6' });

    const res = await postClass(adminToken(), shell({ teacherId: SUBJECT_TEACHER }));

    expect(res.status).toBe(200);
    expect(prismaFake.class.create).toHaveBeenCalled();
  });

  it('names the class from subject and grade level when none is given', async () => {
    inSchoolSection();
    prismaFake.class.create.mockResolvedValue({ id: 'class-3' });

    await postClass(adminToken(), shell({ name: '   ' }));

    expect(prismaFake.class.create.mock.calls[0][0].data.name).toBe('Filipino — Grade 6');
  });

  it('refuses a second identical shell for the same teacher', async () => {
    // Two shells for one teacher, section, subject and year split that
    // teacher's gradebook for the block in half.
    inSchoolSection();
    prismaFake.class.findFirst.mockResolvedValue({ id: 'class-existing', name: 'Filipino 6' });

    const res = await postClass(adminToken(), shell());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/already has/i);
    expect(prismaFake.class.create).not.toHaveBeenCalled();
  });
});

/**
 * The teacher-side routes are gone, not merely unlinked from the screens.
 *
 * A control removed from the UI is a control an old cached bundle, a bookmarked
 * request or a curl still reaches. These assert the server itself refuses —
 * whether by authorizePath (403, the literal is no longer in
 * TEACHER_ROUTE_SEGMENTS) or by there being no handler left to route to (404)
 * is an implementation detail; that nothing is written is not.
 */
describe('the teacher can no longer create or enrol', () => {
  const gone = [
    ['POST', '/api/teacher/sections', { name: SECTION_NAME, studentsList: [learner('Dela Cruz, Juan')] }],
    ['POST', '/api/teacher/classes', { name: 'Filipino 6', sectionId: SECTION, subject: 'Filipino' }],
    ['POST', '/api/teacher/quick-setup', { sectionName: SECTION_NAME, subject: 'Filipino', gradeLevel: 'Grade 6' }],
    ['POST', '/api/teacher/extract-students', {}],
    ['PUT', `/api/teacher/sections/${SECTION}/students/student-1`, { name: 'Corrected Name' }],
    ['PUT', `/api/teacher/sections/${SECTION}/students/student-1/password`, {}],
  ];

  for (const [method, path, body] of gone) {
    it(`refuses ${method} ${path} and writes nothing`, async () => {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${teacherToken(ADVISER)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(prismaFake.section.create).not.toHaveBeenCalled();
      expect(prismaFake.class.create).not.toHaveBeenCalled();
      expect(prismaFake.user.create).not.toHaveBeenCalled();
      expect(prismaFake.user.update).not.toHaveBeenCalled();
    });
  }

  it('still lets a teacher read the sections they teach in', async () => {
    // Removing the writes must not take the read with them: the teacher's
    // section list is how they look up which block a learner sits in.
    prismaFake.section.findMany.mockResolvedValue([]);

    const res = await fetch(`${baseUrl}/api/teacher/${ADVISER}/sections`, {
      headers: { Authorization: `Bearer ${teacherToken(ADVISER)}` },
    });

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });
});
