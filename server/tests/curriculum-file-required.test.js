import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

/**
 * A curriculum without its guide document is an empty shell.
 *
 * The upload used to be optional, and publishing without one produced a
 * Curriculum row with zero CurriculumLessons. That is not a smaller version of
 * the same thing — the lessons are what activities are tagged to, and their
 * learning competencies are what the AI checker is held to when it marks work
 * against that tag (see the TOPIC FOCUS RULE in server.js). An empty curriculum
 * therefore widens grading back out to "whatever the model thought was worth
 * commenting on", silently, and looks on screen exactly like one whose lessons
 * simply have not been expanded yet.
 *
 * So the file is now required, and this pins that at the route rather than only
 * in the admin form — the form's `disabled` attribute is a convenience, not a
 * rule, and it is not what a second client would honour.
 *
 * Harness copied from admin-co-admins.test.js: a fake Prisma client installed
 * through db.js's swappable proxy before server.js is required.
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

process.env.AUTH_SECRET = 'curriculum-file-required-test-secret';
process.env.NODE_ENV = 'test';

const SCHOOL = 'school-a';
const ADMIN = 'admin-1';

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
  prismaFake.user.findUnique.mockImplementation(async (args) => {
    if (args?.where?.id !== ADMIN) return { sessionsValidFrom: null };
    return {
      id: ADMIN, name: 'Head Admin', role: 'ADMIN', schoolId: SCHOOL, sessionsValidFrom: null,
      school: { id: SCHOOL, name: 'Test ES', status: 'APPROVED', ownerId: ADMIN },
    };
  });
  // No curriculum exists yet for this grade level + subject.
  prismaFake.curriculum.findFirst.mockResolvedValue(null);
  prismaFake.curriculum.create.mockImplementation(async (args) => ({ id: 'curriculum-1', ...args.data }));
});

const token = () => signToken({ id: ADMIN, role: 'ADMIN', schoolId: SCHOOL });

/** The form the admin page sends: three text fields, plus the guide when there is one. */
function body({ withFile } = {}) {
  const fd = new FormData();
  fd.append('gradeLevel', 'Grade 6');
  fd.append('subject', 'English');
  fd.append('title', 'MATATAG English 6 — SY 2026-2027');
  fd.append('description', '');
  if (withFile) {
    fd.append(
      'curriculumFile',
      new Blob(['%PDF-1.4 not a real guide, only enough to be a file'], { type: 'application/pdf' }),
      'english6.pdf'
    );
  }
  return fd;
}

const post = (fd) =>
  fetch(`${baseUrl}/api/admin/${ADMIN}/curriculums`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}` },
    body: fd,
  });

describe('publishing a curriculum requires its guide document', () => {
  it('refuses the request when no file is attached', async () => {
    const res = await post(body());
    expect(res.status).toBe(400);
    const d = await res.json();
    expect(d.success).toBe(false);
    expect(d.error).toMatch(/required/i);
  });

  it('writes nothing when it refuses — no empty curriculum is left behind', async () => {
    await post(body());
    expect(prismaFake.curriculum.create).not.toHaveBeenCalled();
    expect(prismaFake.curriculumLesson.createMany).not.toHaveBeenCalled();
  });

  it('says why the file matters, so the admin is not just told "no"', async () => {
    const d = await (await post(body())).json();
    // The reason is the point: without lessons there are no competencies, and
    // without competencies the AI checker has nothing to mark against.
    expect(d.error).toMatch(/lesson/i);
    expect(d.error).toMatch(/competenc/i);
  });

  it('still checks the text fields, and does so before the file', async () => {
    const fd = new FormData();
    fd.append('gradeLevel', 'Grade 6');
    fd.append('subject', 'English');
    fd.append('title', '   ');           // whitespace only
    const d = await (await post(fd)).json();
    expect(d.success).toBe(false);
    expect(d.error).toMatch(/title are required/i);
  });

  it('accepts the request once a guide is attached', async () => {
    // The stub PDF has no readable lessons in it, so extraction fails and the
    // route records a parse warning — which is a different outcome from being
    // refused, and the one this test is separating from it: the curriculum is
    // created, with a warning the admin can act on.
    const res = await post(body({ withFile: true }));
    expect(res.status).toBe(200);
    expect(prismaFake.curriculum.create).toHaveBeenCalled();
  }, 30000);
});
