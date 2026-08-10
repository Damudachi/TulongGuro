import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

/**
 * Who may write to a section.
 *
 * GET /api/teacher/:teacherId/sections deliberately returns every section in
 * the school — colleagues teach the same block — and marks each one `isOwn`
 * so the client knows which are editable. The two per-learner routes back
 * that up server-side: PUT .../students/:studentId and its /password sibling
 * both refuse unless `section.teacherId === req.auth.sub`.
 *
 * POST /api/teacher/sections is the third way into a section and the one that
 * did not check. It resolves a section by (name, school, school year) so that
 * "add my class list" reuses the existing roster instead of making a second
 * one — correct, and the reason two schools can both run a "Grade 6 -
 * Sampaguita". But the lookup is scoped to the *school*, never to the caller,
 * so any teacher who types an existing section's name is enrolling learners
 * into a roster somebody else advises.
 *
 * The case that surfaced it: a teacher creates a section, an admin reassigns
 * the adviser (PUT /api/admin/:adminId/sections/:sectionId accepts teacherId),
 * and the previous adviser — who can no longer rename a learner or reset a
 * password there — can still add students to it. The section does not even
 * appear to them as their own; `isOwn` is false in the list they are looking
 * at while the write goes through.
 *
 * Driven over real HTTP against the real route, for the same reason
 * route-wiring.test.js is: the defect is a missing call, and no pure test of
 * the surrounding helpers would notice.
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
const OLD_ADVISER = 'teacher-old';   // created the section, then was replaced
const NEW_ADVISER = 'teacher-new';   // the admin's replacement
const OTHER = 'teacher-other';       // never had anything to do with it
const SECTION = 'section-1';
const SECTION_NAME = 'Grade 6 - Sampaguita';

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
 * The caller, as both the auth middleware's revocation check and the route's
 * own creator lookup see them.
 *
 * Answered by query shape rather than with one fixed value, because a third
 * caller shares this mock: nextStudentId() probes `{ where: { username } }`
 * inside a `for (;;)` and only stops when one comes back free. A blanket
 * mockResolvedValue makes that loop run until the heap gives out.
 */
function signedInAs(teacherId) {
  resetPrisma();
  prismaFake.user.findUnique.mockImplementation(({ where } = {}) =>
    Promise.resolve(
      where?.id ? { id: teacherId, schoolId: SCHOOL, sessionsValidFrom: null } : null
    )
  );
}

/** The section as it stands after the admin handed it to NEW_ADVISER. */
function sectionAdvisedByNewTeacher() {
  prismaFake.section.findFirst.mockResolvedValue({
    id: SECTION,
    name: SECTION_NAME,
    teacherId: NEW_ADVISER,
    schoolId: SCHOOL,
    gradeLevel: 'Grade 6',
    schoolYear: '2026-2027',
  });
}

const tokenFor = (id) => signToken({ id, role: 'TEACHER', schoolId: SCHOOL });

const postSection = (token, body) =>
  fetch(`${baseUrl}/api/teacher/sections`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => resetPrisma());

describe('POST /api/teacher/sections respects who advises the section', () => {
  it('refuses the previous adviser after an admin has reassigned the section', async () => {
    signedInAs(OLD_ADVISER);
    sectionAdvisedByNewTeacher();

    const res = await postSection(tokenFor(OLD_ADVISER), {
      name: SECTION_NAME,
      gradeLevel: 'Grade 6',
      studentsList: ['Dela Cruz, Juan'],
    });

    expect(res.status).toBe(403);

    // The rejection has to happen before anything is written. A 403 that still
    // enrolled the learner would be worse than an honest 200.
    expect(prismaFake.user.create).not.toHaveBeenCalled();
    expect(prismaFake.section.update).not.toHaveBeenCalled();
  });

  it('refuses any other teacher in the school who guesses the name', async () => {
    signedInAs(OTHER);
    sectionAdvisedByNewTeacher();

    const res = await postSection(tokenFor(OTHER), {
      name: SECTION_NAME,
      studentsList: ['Santos, Maria Clara'],
    });

    expect(res.status).toBe(403);
    expect(prismaFake.user.create).not.toHaveBeenCalled();
  });

  it('names the adviser in the refusal, so the teacher knows who to ask', async () => {
    signedInAs(OLD_ADVISER);
    prismaFake.section.findFirst.mockResolvedValue({
      id: SECTION,
      name: SECTION_NAME,
      teacherId: NEW_ADVISER,
      schoolId: SCHOOL,
      schoolYear: '2026-2027',
      teacher: { id: NEW_ADVISER, name: 'Ms. Reyes' },
    });

    const res = await postSection(tokenFor(OLD_ADVISER), {
      name: SECTION_NAME,
      studentsList: ['Dela Cruz, Juan'],
    });

    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toMatch(/Ms\. Reyes/);
  });

  it('still lets the current adviser add to their own section', async () => {
    signedInAs(NEW_ADVISER);
    sectionAdvisedByNewTeacher();

    const res = await postSection(tokenFor(NEW_ADVISER), {
      name: SECTION_NAME,
      studentsList: [],
    });

    expect(res.status).toBe(200);
  });

  it('still lets a teacher create a section that does not exist yet', async () => {
    signedInAs(OLD_ADVISER);
    // findFirst answers null — nothing by this name in this school and year.
    prismaFake.section.create.mockResolvedValue({
      id: 'section-new',
      name: 'Grade 6 - Ilang-Ilang',
      teacherId: OLD_ADVISER,
      schoolId: SCHOOL,
      schoolYear: '2026-2027',
    });

    const res = await postSection(tokenFor(OLD_ADVISER), {
      name: 'Grade 6 - Ilang-Ilang',
      studentsList: [],
    });

    expect(res.status).toBe(200);
    expect(prismaFake.section.create).toHaveBeenCalled();
  });
});

/**
 * A class may be created in a section this teacher does not advise — that is
 * the ordinary shape of a subject teacher's week, and the class picker offers
 * every section in the school for exactly that reason. The bar is the school,
 * and there was none: sectionId was taken on trust and written onto the class,
 * so an id belonging to another school would attach that school's roster to
 * this teacher's gradebook and analytics, both of which read
 * class.section.students.
 */
describe('POST /api/teacher/classes keeps a class inside its own school', () => {
  const postClass = (token, body) =>
    fetch(`${baseUrl}/api/teacher/classes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const newClassBody = (sectionId) => ({
    name: 'Filipino 10', gradeLevel: 'Grade 10', subject: 'Filipino',
    schoolYear: '2026-2027', sectionId,
  });

  it('refuses a section belonging to another school', async () => {
    signedInAs(OTHER);
    prismaFake.section.findUnique.mockResolvedValue({
      id: 'far-away-section', schoolId: 'school-b', teacherId: 'someone-else',
    });

    const res = await postClass(tokenFor(OTHER), newClassBody('far-away-section'));

    expect(res.status).toBe(403);
    expect(prismaFake.class.create).not.toHaveBeenCalled();
  });

  it('refuses a section id that does not exist', async () => {
    signedInAs(OTHER);
    // section.findUnique answers null by default.
    const res = await postClass(tokenFor(OTHER), newClassBody('no-such-section'));

    expect(res.status).toBe(404);
    expect(prismaFake.class.create).not.toHaveBeenCalled();
  });

  it('allows a colleague\'s section in the same school', async () => {
    signedInAs(OTHER);
    prismaFake.section.findUnique.mockResolvedValue({
      id: SECTION, schoolId: SCHOOL, teacherId: NEW_ADVISER,
    });
    prismaFake.class.create.mockResolvedValue({ id: 'class-1', name: 'Filipino 10' });

    const res = await postClass(tokenFor(OTHER), newClassBody(SECTION));

    expect(res.status).toBe(200);
    expect(prismaFake.class.create).toHaveBeenCalled();
  });

  it('allows their own section even when it carries no school', async () => {
    // A roster created before sections had a schoolId must stay usable by the
    // teacher who made it.
    signedInAs(OTHER);
    prismaFake.section.findUnique.mockResolvedValue({
      id: 'legacy-section', schoolId: null, teacherId: OTHER,
    });
    prismaFake.class.create.mockResolvedValue({ id: 'class-2', name: 'Filipino 10' });

    const res = await postClass(tokenFor(OTHER), newClassBody('legacy-section'));

    expect(res.status).toBe(200);
    expect(prismaFake.class.create).toHaveBeenCalled();
  });
});
