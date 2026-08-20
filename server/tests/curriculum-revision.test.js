import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

/**
 * Revising a curriculum that is already published.
 *
 * A curriculum is not written once. A school revises its scope and sequence
 * mid-year, DepEd reissues a guide, or the document uploaded in June turns out
 * to have been last year's — and the only route back used to be Delete →
 * publish again, which threw away every lesson the school's classes had been
 * built from in order to change one week's wording.
 *
 * What these tests are really pinning is the boundary the feature turns on:
 * a revision reaches the curriculum, and it reaches the classes following it,
 * but it stops dead at any lesson a teacher has already built activities on.
 * Rewriting that lesson's competencies would change what already-submitted work
 * is marked against, after the fact; deleting it would cut those activities
 * loose from their lesson entirely, because Activity.classLessonId is optional
 * and the row survives with a dangling null rather than the delete being
 * refused. Neither failure is visible on screen when it happens.
 *
 * Harness copied from curriculum-file-required.test.js: a fake Prisma client
 * installed through db.js's swappable proxy before server.js is required.
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

process.env.AUTH_SECRET = 'curriculum-revision-test-secret';
process.env.NODE_ENV = 'test';

const SCHOOL = 'school-a';
const ADMIN = 'admin-1';
const CURRICULUM = 'curriculum-1';

let baseUrl;
let server;
let signToken;
let restoreClient;
let currentSchoolYear;

/** The lessons this curriculum starts with, before any revision. */
const publishedLessons = () => ([
  {
    id: 'lesson-1',
    curriculumId: CURRICULUM,
    title: 'Week 1: Elements of a Short Story',
    description: 'What the June document said.',
    outputType: 'Essay',
    weekNumber: 1,
    competencies: JSON.stringify(['Identify the elements of a short story']),
    defaultRubric: null,
    // The school rubric this lesson was published with. Nothing in the revised
    // document can restore it, so a revision that recreated the row instead of
    // updating it would lose the link silently.
    rubricTemplateId: 'rubric-template-1',
  },
  {
    id: 'lesson-2',
    curriculumId: CURRICULUM,
    title: 'Week 2: Figurative Language',
    description: 'Dropped by the revision.',
    outputType: 'Essay',
    weekNumber: 2,
    competencies: null,
    defaultRubric: null,
    rubricTemplateId: null,
  },
]);

/**
 * What the admin approved in the preview: week 1 reworded (same lesson, matched
 * past its punctuation), week 2 gone, week 3 added.
 */
const revisedLessons = () => ([
  {
    title: 'Week 1 — Elements of a short story',
    description: 'What the November revision says.',
    outputType: 'Essay',
    weekNumber: 1,
    // Arrives as the JSON string the extractor stores and the preview handed
    // back, not as an array.
    competencies: JSON.stringify(['Identify the elements of a short story', 'Compare two short stories']),
    isNew: false,
  },
  {
    title: 'Week 3: Persuasive Writing',
    description: 'New this year.',
    outputType: 'Essay',
    weekNumber: 3,
    competencies: JSON.stringify(['Write a persuasive paragraph']),
    isNew: true,
  },
]);

beforeAll(async () => {
  restoreClient = require('../db.js').__setClientForTests(prismaFake);
  const { app } = require('../server.js');
  ({ signToken } = require('../auth.js'));
  ({ currentSchoolYear } = require('../schoolYear.js'));
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
  prismaFake.user.findUnique.mockImplementation(async (args) => {
    if (args?.where?.id !== ADMIN) return { sessionsValidFrom: null };
    return {
      id: ADMIN, name: 'Head Admin', role: 'ADMIN', schoolId: SCHOOL, sessionsValidFrom: null,
      school: { id: SCHOOL, name: 'Test ES', status: 'APPROVED', ownerId: ADMIN },
    };
  });
  prismaFake.curriculum.findUnique.mockImplementation(async (args) => {
    if (args?.where?.id !== CURRICULUM) return null;
    return {
      id: CURRICULUM, schoolId: SCHOOL, gradeLevel: 'Grade 6', subject: 'English',
      title: 'MATATAG English 6 — SY 2026-2027', description: null, sourceFile: '/uploads/june.pdf',
      lessons: publishedLessons(), rubrics: [],
    };
  });
  prismaFake.curriculum.update.mockImplementation(async (args) => ({ id: CURRICULUM, ...args.data }));
  // Echo what was written, so the route reads back the row it just made rather
  // than the bare {} the default mock returns — a lesson with no title would
  // match every other titleless thing when the revision is carried into classes.
  prismaFake.curriculumLesson.create.mockImplementation(async (args) => ({ id: 'new-lesson', ...args.data }));
  prismaFake.curriculumLesson.update.mockImplementation(async (args) => ({ id: args.where.id, ...args.data }));
  prismaFake.classLesson.create.mockImplementation(async (args) => ({ id: 'new-class-lesson', ...args.data }));
  prismaFake.classLesson.update.mockImplementation(async (args) => ({ id: args.where.id, ...args.data }));
});

const token = () => signToken({ id: ADMIN, role: 'ADMIN', schoolId: SCHOOL });
const auth = () => ({ Authorization: `Bearer ${token()}` });

const guideBody = ({ mode, lessons, withFile = true } = {}) => {
  const fd = new FormData();
  if (mode !== undefined) fd.append('mode', mode);
  if (lessons !== undefined) fd.append('lessons', JSON.stringify(lessons));
  if (withFile) {
    fd.append('curriculumFile',
      new Blob(['%PDF-1.4 the November revision'], { type: 'application/pdf' }), 'english6-nov.pdf');
  }
  return fd;
};

const applyGuide = (body, curriculumId = CURRICULUM) =>
  fetch(`${baseUrl}/api/admin/${ADMIN}/curriculums/${curriculumId}/guide`, {
    method: 'PUT', headers: auth(), body,
  });

/** A class that follows this curriculum, with one lesson taught and one not. */
function followingClass({ id = 'class-1', schoolYear = currentSchoolYear(), usedActivities = 2, unusedActivities = 0 } = {}) {
  return {
    id, schoolYear, gradeLevel: 'Grade 6', subject: 'English', teacherId: 'teacher-1',
    lessons: [
      {
        id: `${id}-cl1`, classId: id, title: 'Week 1: Elements of a Short Story',
        description: 'What the June document said.', outputType: 'Essay', weekNumber: 1,
        competencies: JSON.stringify(['Identify the elements of a short story']),
        _count: { activities: usedActivities },
      },
      {
        id: `${id}-cl2`, classId: id, title: 'Week 2: Figurative Language',
        description: 'Dropped by the revision.', outputType: 'Essay', weekNumber: 2,
        competencies: null,
        _count: { activities: unusedActivities },
      },
    ],
  };
}

const createdClassLessonTitles = () =>
  prismaFake.classLesson.create.mock.calls.map(([args]) => args.data.title);

describe('editing the details of a published curriculum', () => {
  const put = (body, curriculumId = CURRICULUM) =>
    fetch(`${baseUrl}/api/admin/${ADMIN}/curriculums/${curriculumId}`, {
      method: 'PUT',
      headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('renames it', async () => {
    const res = await put({ title: '  MATATAG English 6 — SY 2027-2028  ' });
    expect(res.status).toBe(200);
    expect(prismaFake.curriculum.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: 'MATATAG English 6 — SY 2027-2028' }) })
    );
  });

  it('stores an emptied description as null rather than a blank string', async () => {
    await put({ description: '   ' });
    expect(prismaFake.curriculum.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { description: null } })
    );
  });

  it('refuses to leave it with no title at all', async () => {
    const res = await put({ title: '   ' });
    expect(res.status).toBe(400);
    expect(prismaFake.curriculum.update).not.toHaveBeenCalled();
  });

  it('refuses a request that changes nothing, rather than reporting a save', async () => {
    const res = await put({});
    expect(res.status).toBe(400);
    expect(prismaFake.curriculum.update).not.toHaveBeenCalled();
  });

  it('will not touch another school\'s curriculum', async () => {
    const res = await put({ title: 'Theirs now' }, 'curriculum-elsewhere');
    expect(res.status).toBe(404);
    expect(prismaFake.curriculum.update).not.toHaveBeenCalled();
  });
});

describe('previewing a revised guide', () => {
  const preview = (curriculumId = CURRICULUM, withFile = true) => {
    const fd = new FormData();
    if (withFile) {
      fd.append('curriculumFile', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'rev.pdf');
    }
    return fetch(`${baseUrl}/api/admin/${ADMIN}/curriculums/${curriculumId}/guide/preview`, {
      method: 'POST', headers: auth(), body: fd,
    });
  };

  it('refuses without a file', async () => {
    const res = await preview(CURRICULUM, false);
    expect(res.status).toBe(400);
  });

  it('will not read a file against another school\'s curriculum', async () => {
    const res = await preview('curriculum-elsewhere');
    expect(res.status).toBe(404);
  });

  it('writes nothing, whatever the document turns out to say', async () => {
    // AI is not configured under test, so extraction fails — which is exactly
    // the path that must still not have touched a row on its way out.
    await preview();
    expect(prismaFake.curriculumLesson.create).not.toHaveBeenCalled();
    expect(prismaFake.curriculumLesson.deleteMany).not.toHaveBeenCalled();
    expect(prismaFake.curriculum.update).not.toHaveBeenCalled();
    expect(prismaFake.classLesson.create).not.toHaveBeenCalled();
  }, 30000);
});

describe('applying a revised guide to the curriculum', () => {
  it('refuses a mode it was not given', async () => {
    const res = await applyGuide(guideBody({ lessons: revisedLessons() }));
    expect(res.status).toBe(400);
    expect(prismaFake.curriculumLesson.create).not.toHaveBeenCalled();
  });

  it('refuses without the file, so the stored guide always matches the lessons', async () => {
    const res = await applyGuide(guideBody({ mode: 'replace', lessons: revisedLessons(), withFile: false }));
    expect(res.status).toBe(400);
    expect(prismaFake.curriculumLesson.create).not.toHaveBeenCalled();
  });

  it('refuses when no readable lesson came through with it', async () => {
    const res = await applyGuide(guideBody({ mode: 'replace', lessons: [{ title: '   ' }] }));
    expect(res.status).toBe(400);
    expect(prismaFake.curriculumLesson.deleteMany).not.toHaveBeenCalled();
  });

  it('replaces: drops what the document no longer lists', async () => {
    const res = await applyGuide(guideBody({ mode: 'replace', lessons: revisedLessons() }));
    expect(res.status).toBe(200);
    expect(prismaFake.curriculumLesson.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['lesson-2'] } } });
  });

  it('replaces: rewrites the matching lesson in place rather than recreating it', async () => {
    // Matched past the punctuation and casing — "Week 1: Elements of a Short
    // Story" and "Week 1 — Elements of a short story" are the same lesson, and
    // treating them as two would report one addition and one removal for a
    // reworded heading. In place, because rubricTemplateId is not in the
    // document and could not be put back.
    await applyGuide(guideBody({ mode: 'replace', lessons: revisedLessons() }));
    expect(prismaFake.curriculumLesson.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'lesson-1' },
      data: expect.objectContaining({ description: 'What the November revision says.' }),
    }));
    const created = prismaFake.curriculumLesson.create.mock.calls.map(([a]) => a.data.title);
    expect(created).toEqual(['Week 3: Persuasive Writing']);
  });

  it('keeps competencies a list, instead of wrapping the stored JSON in itself', async () => {
    await applyGuide(guideBody({ mode: 'replace', lessons: revisedLessons() }));
    const [[updateArgs]] = prismaFake.curriculumLesson.update.mock.calls;
    expect(JSON.parse(updateArgs.data.competencies))
      .toEqual(['Identify the elements of a short story', 'Compare two short stories']);
  });

  it('appends: adds only the new lesson and removes nothing', async () => {
    const res = await applyGuide(guideBody({ mode: 'append', lessons: revisedLessons() }));
    expect(res.status).toBe(200);
    expect(prismaFake.curriculumLesson.deleteMany).not.toHaveBeenCalled();
    expect(prismaFake.curriculumLesson.update).not.toHaveBeenCalled();
    const created = prismaFake.curriculumLesson.create.mock.calls.map(([a]) => a.data.title);
    expect(created).toEqual(['Week 3: Persuasive Writing']);
  });

  it('file-only: stores the document and leaves every lesson alone', async () => {
    const res = await applyGuide(guideBody({ mode: 'file-only' }));
    expect(res.status).toBe(200);
    expect(prismaFake.curriculumLesson.create).not.toHaveBeenCalled();
    expect(prismaFake.curriculumLesson.update).not.toHaveBeenCalled();
    expect(prismaFake.curriculumLesson.deleteMany).not.toHaveBeenCalled();
    expect(prismaFake.classLesson.create).not.toHaveBeenCalled();
    expect(prismaFake.curriculum.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sourceFile: expect.any(String) }),
    }));
  });

  it('records the new document against the curriculum', async () => {
    await applyGuide(guideBody({ mode: 'replace', lessons: revisedLessons() }));
    expect(prismaFake.curriculum.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: CURRICULUM },
      data: expect.objectContaining({ sourceFile: expect.stringContaining('english6-nov') }),
    }));
  });

  it('will not revise another school\'s curriculum', async () => {
    const res = await applyGuide(guideBody({ mode: 'replace', lessons: revisedLessons() }), 'curriculum-elsewhere');
    expect(res.status).toBe(404);
    expect(prismaFake.curriculum.update).not.toHaveBeenCalled();
  });
});

describe('carrying the revision into classes already built from it', () => {
  it('adds the new lesson to a class following this curriculum', async () => {
    prismaFake.class.findMany.mockResolvedValue([followingClass()]);
    const res = await applyGuide(guideBody({ mode: 'replace', lessons: revisedLessons() }));
    const d = await res.json();
    expect(createdClassLessonTitles()).toEqual(['Week 3: Persuasive Writing']);
    expect(d.propagation.classes).toBe(1);
    expect(d.propagation.added).toBe(1);
  });

  it('adds it on an append too — a new week reaches the class either way', async () => {
    prismaFake.class.findMany.mockResolvedValue([followingClass()]);
    await applyGuide(guideBody({ mode: 'append', lessons: revisedLessons() }));
    expect(createdClassLessonTitles()).toEqual(['Week 3: Persuasive Writing']);
  });

  it('updates a lesson that already has activities, rather than skipping it', async () => {
    // The reason the feature exists. Grading reads competencies off the
    // ClassLesson at the moment it marks, so a lesson imported before
    // competencies were extracted has none for every activity built on it —
    // and only an update to that row can fix it. Updating cannot disturb what
    // points at the row; only deleting could, and that is guarded separately.
    prismaFake.class.findMany.mockResolvedValue([followingClass({ usedActivities: 2 })]);
    const res = await applyGuide(guideBody({ mode: 'replace', lessons: revisedLessons() }));
    const d = await res.json();
    expect(prismaFake.classLesson.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'class-1-cl1' },
      data: expect.objectContaining({ description: 'What the November revision says.' }),
    }));
    expect(d.propagation.refreshed).toBe(1);
  });

  it('writes competencies into a lesson that never had any, with work already built on it', async () => {
    // The exact case the re-upload is for: the class was created from an import
    // that predates competency extraction, and its lessons carry activities.
    const klass = followingClass({ usedActivities: 4 });
    klass.lessons[0].competencies = null;
    prismaFake.class.findMany.mockResolvedValue([klass]);
    await applyGuide(guideBody({ mode: 'replace', lessons: revisedLessons() }));
    const call = prismaFake.classLesson.update.mock.calls.find(([a]) => a.where.id === 'class-1-cl1');
    expect(call).toBeDefined();
    expect(JSON.parse(call[0].data.competencies))
      .toEqual(['Identify the elements of a short story', 'Compare two short stories']);
  });

  it('refreshes the same lesson when nothing has been built on it yet', async () => {
    prismaFake.class.findMany.mockResolvedValue([followingClass({ usedActivities: 0 })]);
    await applyGuide(guideBody({ mode: 'replace', lessons: revisedLessons() }));
    expect(prismaFake.classLesson.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'class-1-cl1' },
      data: expect.objectContaining({ description: 'What the November revision says.' }),
    }));
  });

  it('removes a dropped lesson from the class only while it is unused', async () => {
    prismaFake.class.findMany.mockResolvedValue([followingClass({ unusedActivities: 0 })]);
    const res = await applyGuide(guideBody({ mode: 'replace', lessons: revisedLessons() }));
    const d = await res.json();
    expect(prismaFake.classLesson.delete).toHaveBeenCalledWith({ where: { id: 'class-1-cl2' } });
    expect(d.propagation.removed).toBe(1);
  });

  it('keeps a dropped lesson that activities point at, rather than orphaning them', async () => {
    // The one that matters most: Activity.classLessonId is optional, so this
    // delete would succeed and quietly leave those activities linked to
    // nothing at all.
    prismaFake.class.findMany.mockResolvedValue([followingClass({ unusedActivities: 3 })]);
    const res = await applyGuide(guideBody({ mode: 'replace', lessons: revisedLessons() }));
    const d = await res.json();
    expect(prismaFake.classLesson.delete).not.toHaveBeenCalled();
    // Only the dropped one is "kept": week 1 is in use as well, and it was
    // updated like any other lesson rather than held back.
    expect(d.propagation.keptInUse).toBe(1);
    expect(d.propagation.refreshed).toBe(1);
  });

  it('never deletes a class lesson on an append, even one the document dropped', async () => {
    prismaFake.class.findMany.mockResolvedValue([followingClass({ unusedActivities: 0 })]);
    await applyGuide(guideBody({ mode: 'append', lessons: revisedLessons() }));
    expect(prismaFake.classLesson.delete).not.toHaveBeenCalled();
    expect(prismaFake.classLesson.update).not.toHaveBeenCalled();
  });

  it('leaves last year\'s classes alone', async () => {
    // A finished school year is a record of what was actually taught, and this
    // year's guide has no business rewriting it.
    prismaFake.class.findMany.mockResolvedValue([followingClass({ id: 'old-class', schoolYear: '2019-2020', unusedActivities: 0 })]);
    const res = await applyGuide(guideBody({ mode: 'replace', lessons: revisedLessons() }));
    const d = await res.json();
    expect(prismaFake.classLesson.create).not.toHaveBeenCalled();
    expect(prismaFake.classLesson.delete).not.toHaveBeenCalled();
    expect(d.propagation.classes).toBe(0);
  });

  it('looks for classes in this school, grade level and subject only', async () => {
    prismaFake.class.findMany.mockResolvedValue([]);
    await applyGuide(guideBody({ mode: 'replace', lessons: revisedLessons() }));
    expect(prismaFake.class.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        gradeLevel: 'Grade 6',
        subject: 'English',
        teacher: { schoolId: SCHOOL },
      }),
    }));
  });

  it('does not add a lesson the class already has', async () => {
    const klass = followingClass();
    klass.lessons.push({
      id: 'class-1-cl3', classId: 'class-1', title: 'Week 3: Persuasive Writing',
      description: null, outputType: 'Essay', weekNumber: 3, competencies: null,
      _count: { activities: 0 },
    });
    prismaFake.class.findMany.mockResolvedValue([klass]);
    await applyGuide(guideBody({ mode: 'replace', lessons: revisedLessons() }));
    expect(prismaFake.classLesson.create).not.toHaveBeenCalled();
  });
});

describe('recognising a lesson the second reading worded differently', () => {
  /**
   * The document is read by a model, not diffed as text, so uploading the very
   * same guide twice — which is what a school does to backfill competencies an
   * older import never captured — does not reliably produce the same wording.
   * Treated as different lessons, the stored one is reported as dropped, a
   * duplicate is added beside it, and the competencies land on the copy that
   * none of the teacher's activities point at.
   */
  const oneLesson = (title, weekNumber) => ([{
    title, description: 'Second reading of the same document.', outputType: 'Essay',
    weekNumber, competencies: JSON.stringify(['Identify the elements of a short story']),
  }]);

  it('matches it when the "Week 1:" prefix was dropped the second time', async () => {
    await applyGuide(guideBody({ mode: 'replace', lessons: oneLesson('Elements of a Short Story', 1) }));
    expect(prismaFake.curriculumLesson.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'lesson-1' } })
    );
    expect(prismaFake.curriculumLesson.create).not.toHaveBeenCalled();
  });

  it('matches it when the wording drifted but it is the same week and mostly the same words', async () => {
    await applyGuide(guideBody({ mode: 'replace', lessons: oneLesson('Week 1: Elements of Short Stories', 1) }));
    expect(prismaFake.curriculumLesson.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'lesson-1' } })
    );
    expect(prismaFake.curriculumLesson.create).not.toHaveBeenCalled();
  });

  it('refuses to match a week that genuinely changed topic', async () => {
    // Sharing a week number is not sharing a lesson. Matching these would
    // rewrite the stored lesson in place, and an activity built on "Elements of
    // a Short Story" would end up hanging off a lesson about something else.
    await applyGuide(guideBody({ mode: 'replace', lessons: oneLesson('Week 1: Persuasive Letter Writing', 1) }));
    expect(prismaFake.curriculumLesson.update).not.toHaveBeenCalled();
    const created = prismaFake.curriculumLesson.create.mock.calls.map(([a]) => a.data.title);
    expect(created).toEqual(['Week 1: Persuasive Letter Writing']);
  });

  it('carries the same recognition into the class copies, instead of duplicating them', async () => {
    prismaFake.class.findMany.mockResolvedValue([followingClass({ usedActivities: 2 })]);
    await applyGuide(guideBody({ mode: 'replace', lessons: oneLesson('Elements of a Short Story', 1) }));
    expect(prismaFake.classLesson.create).not.toHaveBeenCalled();
    expect(prismaFake.classLesson.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'class-1-cl1' } })
    );
  });
});

describe('attaching a rubric to a published curriculum', () => {
  const evenCriteria = [
    { name: 'Content', points: 50, description: 'Ideas' },
    { name: 'Grammar', points: 50, description: 'Mechanics' },
  ];
  const post = (body, curriculumId = CURRICULUM) =>
    fetch(`${baseUrl}/api/admin/${ADMIN}/curriculums/${curriculumId}/rubrics`, {
      method: 'POST',
      headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('links it to the curriculum and tags it with that curriculum\'s grade and subject', async () => {
    prismaFake.rubricTemplate.create.mockImplementation(async (args) => ({ id: 'rubric-9', ...args.data }));
    const res = await post({ name: 'Grade 6 English — Performance Task', criteria: evenCriteria });
    expect(res.status).toBe(200);
    expect(prismaFake.rubricTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        curriculumId: CURRICULUM,
        schoolId: SCHOOL,
        teacherId: null,
        gradeLevel: 'Grade 6',
        subject: 'English',
      }),
    }));
  });

  it('holds to the weights-total-100 rule the publish form uses', async () => {
    const res = await post({
      name: 'Lopsided',
      criteria: [{ name: 'Content', points: 40 }, { name: 'Grammar', points: 40 }],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/total 100/i);
    expect(prismaFake.rubricTemplate.create).not.toHaveBeenCalled();
  });

  it('refuses a name the school is already using, with the code the form reads', async () => {
    prismaFake.rubricTemplate.findFirst.mockResolvedValue({ id: 'rubric-1', name: 'Written Output' });
    const res = await post({ name: 'written output', criteria: evenCriteria });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('DUPLICATE_RUBRIC_NAME');
    expect(prismaFake.rubricTemplate.create).not.toHaveBeenCalled();
  });

  it('requires a name and at least one criterion', async () => {
    const res = await post({ name: '   ', criteria: [] });
    expect(res.status).toBe(400);
    expect(prismaFake.rubricTemplate.create).not.toHaveBeenCalled();
  });

  it('will not hang a rubric off another school\'s curriculum', async () => {
    const res = await post({ name: 'Theirs', criteria: evenCriteria }, 'curriculum-elsewhere');
    expect(res.status).toBe(404);
    expect(prismaFake.rubricTemplate.create).not.toHaveBeenCalled();
  });
});
