import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

/**
 * What GET /api/teacher/:teacherId/analytics is allowed to look at.
 *
 * The scoping was already right here — every figure on the page is built from
 * `class.findMany({ where: { teacherId } })`, so a section the caller does not
 * teach into contributes nothing. The defect was on the client, which built
 * its section chooser from /api/teacher/:id/sections: that endpoint returns
 * every section in the *school* on purpose, so the chooser offered sections
 * whose only possible result was an empty page.
 *
 * These pin the server half so it stays the thing the client can be trusted to
 * mirror, and cover the subject narrowing added alongside.
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

process.env.AUTH_SECRET = 'analytics-scope-test-secret';
process.env.NODE_ENV = 'test';

const SCHOOL = 'school-a';
const TEACHER = 'teacher-1';

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

beforeEach(() => {
  resetPrisma();
  prismaFake.user.findUnique.mockResolvedValue({
    id: TEACHER, schoolId: SCHOOL, sessionsValidFrom: null,
  });
});

const token = () => signToken({ id: TEACHER, role: 'TEACHER', schoolId: SCHOOL });

const getAnalytics = (query = '') =>
  fetch(`${baseUrl}/api/teacher/${TEACHER}/analytics${query}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });

/** The `where` the route handed to class.findMany. */
const classWhere = () => prismaFake.class.findMany.mock.calls[0][0].where;

describe('analytics only ever reads the caller\'s own classes', () => {
  it('scopes every request to teacherId, with nothing else asked for', async () => {
    const res = await getAnalytics();
    expect(res.status).toBe(200);

    const where = classWhere();
    expect(where.teacherId).toBe(TEACHER);
    // No section or subject narrowing unless asked for, and — the point —
    // no way for the caller to widen past their own id.
    expect(where.sectionId).toBeUndefined();
    expect(where.subject).toBeUndefined();
  });

  it('keeps the teacher scope even when a section is named', async () => {
    // A section belonging to a colleague is not refused, because it does not
    // need to be: teacherId still applies, so it simply matches no classes and
    // the page comes back empty rather than showing another teacher's cohort.
    await getAnalytics('?sectionId=someone-elses-section');

    const where = classWhere();
    expect(where.teacherId).toBe(TEACHER);
    expect(where.sectionId).toBe('someone-elses-section');
  });

  it('narrows to one subject when asked', async () => {
    await getAnalytics('?subject=Filipino');

    const where = classWhere();
    expect(where.teacherId).toBe(TEACHER);
    expect(where.subject).toBe('Filipino');
  });

  it('combines section and subject, for one subject in one section', async () => {
    await getAnalytics('?sectionId=section-1&subject=Mathematics');

    const where = classWhere();
    expect(where).toMatchObject({
      teacherId: TEACHER,
      sectionId: 'section-1',
      subject: 'Mathematics',
    });
  });

  it('offers back only sections the caller teaches into', async () => {
    prismaFake.class.findMany.mockResolvedValue([
      { id: 'c1', subject: 'Filipino', sectionId: 's1', section: { id: 's1', name: 'Rizal', students: [] } },
      { id: 'c2', subject: 'Science', sectionId: 's1', section: { id: 's1', name: 'Rizal', students: [] } },
      { id: 'c3', subject: 'Filipino', sectionId: 's2', section: { id: 's2', name: 'Bonifacio', students: [] } },
    ]);

    const body = await (await getAnalytics()).json();

    // Deduplicated across the two classes sharing a section, and drawn from
    // the same teacher-scoped query as everything else on the page.
    expect(body.sections.map(s => s.id).sort()).toEqual(['s1', 's2']);
  });
});
