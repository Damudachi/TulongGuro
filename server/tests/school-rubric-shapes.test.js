import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

/**
 * A school rubric may be a band ladder, not only a percentage split.
 *
 * The admin's School Rubrics page could author exactly one shape. Its route
 * enforced `weights total 100` unconditionally — which is the *standard*
 * shape's rule and not the *range* shape's, where each criterion is scored on
 * its own ladder and the weights have no total to hit.
 *
 * That is most DepEd rubrics on paper. A school with one had no way to publish
 * it: the only editor that understood bands was the teacher's, so the rubric
 * got typed in there instead and the copy then belonged to that teacher rather
 * than to the school — invisible to every colleague, and gone if the account
 * was handed over.
 *
 * The rule now comes from `validateRubric`, which every other rubric write in
 * the app already goes through and which has always branched on the shape. The
 * duplicate is what let the two disagree, so what is worth pinning here is that
 * the admin route agrees with it in both directions: a banded rubric is
 * accepted without a 100 total, and a standard one is still held to it.
 *
 * Driven over real HTTP, because the defect was a route enforcing its own copy
 * of a rule — no pure test of `validateRubric` would have noticed.
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
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop === 'then') return undefined;
      if (prop === '$transaction') {
        return (arg) => (typeof arg === 'function' ? arg(fake) : Promise.all(arg));
      }
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

process.env.AUTH_SECRET = 'school-rubric-shapes-secret';
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
  prismaFake.user.findUnique.mockImplementation(({ where } = {}) =>
    Promise.resolve(where?.id === ADMIN
      ? { id: ADMIN, role: 'ADMIN', schoolId: SCHOOL, school: { id: SCHOOL, name: 'Sampaguita ES' }, sessionsValidFrom: null }
      : null));
});

const token = () => signToken({ id: ADMIN, role: 'ADMIN', schoolId: SCHOOL });

const post = (body) =>
  fetch(`${baseUrl}/api/admin/${ADMIN}/rubrics`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

/** A band ladder, of the shape the editor writes. Weights total 20, not 100. */
const BANDED = [
  {
    name: 'Content & Ideas',
    points: 10,
    description: 'Depth of the argument.',
    bands: [
      { label: 'Excellent', score: 10, description: 'Exceeds expectations.' },
      { label: 'Good', score: 6, description: 'Meets most expectations.' },
      { label: 'Needs Improvement', score: 2, description: 'Does not meet.' },
    ],
  },
  {
    name: 'Organisation',
    points: 10,
    description: 'Structure and flow.',
    bands: [
      { label: 'Excellent', score: 10, description: 'Clear throughout.' },
      { label: 'Good', score: 6, description: 'Mostly clear.' },
      { label: 'Needs Improvement', score: 2, description: 'Hard to follow.' },
    ],
  },
];

describe('a banded school rubric can be published', () => {
  it('accepts one whose weights do not total 100', async () => {
    prismaFake.rubricTemplate.create.mockResolvedValue({ id: 'rubric-1', name: 'Narrative Writing' });

    const res = await post({ name: 'Narrative Writing', type: 'range', criteria: BANDED });

    expect(res.status).toBe(200);
    expect(prismaFake.rubricTemplate.create).toHaveBeenCalled();
  });

  it('stores the bands, so the ladder survives the round trip', async () => {
    // The bands ride inside the criteria JSON. Dropped here, the rubric would
    // come back to the teacher as a bare 10/10 split with the ladder — the
    // whole content of the rubric — silently gone.
    prismaFake.rubricTemplate.create.mockResolvedValue({ id: 'rubric-1' });

    await post({ name: 'Narrative Writing', type: 'range', criteria: BANDED });

    const stored = JSON.parse(prismaFake.rubricTemplate.create.mock.calls[0][0].data.criteria);
    expect(stored[0].bands).toHaveLength(3);
    expect(stored[0].bands[0]).toMatchObject({ label: 'Excellent', score: 10 });
  });

  it('works out the shape from the bands when no type is sent', async () => {
    // The curriculum-rubric route shares this guard and does not always carry a
    // type. Inferring 'standard' there would refuse a valid ladder.
    prismaFake.rubricTemplate.create.mockResolvedValue({ id: 'rubric-1' });

    const res = await post({ name: 'Narrative Writing', criteria: BANDED });

    expect(res.status).toBe(200);
  });
});

describe('the 100% rule still holds for the standard shape', () => {
  it('refuses weights that do not total 100', async () => {
    const res = await post({
      name: 'Essay',
      type: 'standard',
      criteria: [
        { name: 'Content', points: 60, description: '' },
        { name: 'Grammar', points: 30, description: '' },
      ],
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/100/);
    expect(prismaFake.rubricTemplate.create).not.toHaveBeenCalled();
  });

  it('accepts weights that do', async () => {
    prismaFake.rubricTemplate.create.mockResolvedValue({ id: 'rubric-2' });

    const res = await post({
      name: 'Essay',
      type: 'standard',
      criteria: [
        { name: 'Content', points: 60, description: '' },
        { name: 'Grammar', points: 40, description: '' },
      ],
    });

    expect(res.status).toBe(200);
  });

  it('still refuses a criterion with no name, whichever shape it is', async () => {
    // An unnamed criterion tells neither the AI nor the learner what was
    // marked, and it is the one malformed shape an editor can produce by
    // accident — adding a row and not filling it in.
    const res = await post({
      name: 'Essay',
      type: 'range',
      criteria: [{ name: '  ', points: 10, bands: BANDED[0].bands }],
    });

    expect(res.status).toBe(400);
    expect(prismaFake.rubricTemplate.create).not.toHaveBeenCalled();
  });

  it('still refuses an empty criteria list', async () => {
    const res = await post({ name: 'Essay', type: 'range', criteria: [] });

    expect(res.status).toBe(400);
    expect(prismaFake.rubricTemplate.create).not.toHaveBeenCalled();
  });
});
