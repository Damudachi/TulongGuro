import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

/**
 * Which model each paper in a class is actually checked by.
 *
 * The bug this file exists for is visible in this deployment's own live request
 * log: a run of GRADING rows alternating between gemini-3.6-flash and
 * gemini-3.5-flash-lite, every one of them OK. Nothing had failed, no bucket was
 * resting, and no quota had been hit — the pool simply stepped a round-robin
 * cursor across the FLAT pool [3.6@k1, 3.6@k2, lite@k1, lite@k2], so two papers
 * in every four opened on the cheaper reader.
 *
 * That offset was written to spread load across independent daily BUDGETS,
 * which is a real goal — but the flat pool mixes two axes into one index, and
 * moving along it changes the MODEL as readily as the credential. The result is
 * children in one class marked by different readers on nothing but their
 * position in the queue.
 *
 * So: the tier order is a promise, and it is the promise these tests hold.
 * Every credential on the best model is tried before the next model is touched;
 * the offset moves along credentials inside a tier.
 *
 * Harness matches ai-credential-rotation.test.js — db.js swapped through Node's
 * CJS cache before server.js is required, global fetch intercepted. Dispatch is
 * on the model id in the URL as well as the key header, because the model is
 * the axis under test here.
 */

const require = createRequire(import.meta.url);
const path = require('node:path');
const fs = require('node:fs');

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

const KEY_A = 'test-key-a';
const KEY_B = 'test-key-b';
const PRIMARY = 'gemini-3.6-flash';
const LITE = 'gemini-3.5-flash-lite';

process.env.AUTH_SECRET = 'grading-tiering-test-secret';
process.env.NODE_ENV = 'test';
// Blanked for the same reason as ai-credential-rotation.test.js: server.js loads
// server/.env and dotenv will not overwrite a value already present, so an unset
// slot inherits whatever the developer running the tests has configured. The
// pool has to be a fixture, not a local accident — and this file's assertions
// count buckets.
for (const name of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', ...Array.from({ length: 9 }, (_, i) => `GEMINI_API_KEY${i + 1}`)]) {
  process.env[name] = '';
}
// Two credentials x two models. Two of each is the smallest pool in which
// "spread across credentials" and "spread across models" give visibly different
// answers — with one credential the two axes collapse and the old behaviour
// would pass.
process.env.GEMINI_API_KEY1 = KEY_A;
process.env.GEMINI_API_KEY2 = KEY_B;
process.env.GEMINI_GRADING_MODELS = `${PRIMARY},${LITE}`;
process.env.AI_CREDENTIAL_SELFCHECK = 'off';
process.env.GEMINI_MIN_SPACING_MS = '0';
process.env.GEMINI_REQUEST_TIMEOUT_MS = '2000';

const T1 = 'teacher-t1';
const ACTIVITY = 'activity-1';

const ONE_PIXEL_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'
  + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA'
  + 'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

const CANNED_RESULT = {
  score: 80,
  rubricScores: [{ criterionName: 'Content', score: 40, maxPoints: 50, bandDescription: 'Adequate' }],
  strengths: 'States a position.',
  areasForGrowth: [], actionableSteps: [],
  readingStrategy: 'N/A', noTextDetected: false,
};

const activityFixture = () => ({
  id: ACTIVITY,
  title: 'Persuasive Essay',
  type: 'Essay',
  instructions: 'Write four paragraphs.',
  topic: null,
  classLessonId: null,
  classId: 'class-1',
  additionalFiles: null,
  rubric: JSON.stringify({ criteria: [{ name: 'Content', points: 100, description: 'Ideas are clear.' }] }),
  class: { teacherId: T1, subject: 'English', gradeLevel: 'Grade 6', sectionId: null },
  classLesson: null,
});

let baseUrl, server, signToken, restoreClient, realFetch;
const uploadPaths = [];
/** Every (model, key) the fake Google was called with, in order. */
let callsSeen = [];
/** Models the fake should answer with a daily-quota 429 instead of a result. */
let exhausted = new Set();

/** Google's real 429 body for a spent per-day bucket — the PerDay quotaId is
 *  what classifyAiError keys `dailyQuota` on, and a daily cap is the thing that
 *  cannot be waited out inside one request. */
const dailyQuota = () => new Response(JSON.stringify({
  error: {
    code: 429,
    message: 'You exceeded your current quota. quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier, quotaValue: 20',
    status: 'RESOURCE_EXHAUSTED',
  },
}), { status: 429, headers: { 'Content-Type': 'application/json' } });

const ok = () => new Response(JSON.stringify({
  candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(CANNED_RESULT) }] }, finishReason: 'STOP' }],
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

function keyOf(init) {
  const h = init?.headers;
  if (!h) return null;
  if (typeof h.get === 'function') return h.get('x-goog-api-key');
  return h['x-goog-api-key'] || h['X-Goog-Api-Key'] || null;
}

/** The SDK puts the model in the path: /v1beta/models/<id>:generateContent */
function modelOf(url) {
  const m = /\/models\/([^:/?]+)/.exec(url);
  return m ? m[1] : null;
}

beforeAll(async () => {
  restoreClient = require('../db.js').__setClientForTests(prismaFake);
  const { app } = require('../server.js');
  ({ signToken } = require('../auth.js'));

  const uploadsDir = path.join(__dirname, '..', 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  for (let i = 0; i < 8; i++) {
    const p = path.join(uploadsDir, `grading-tiering-test-${process.pid}-${i}.jpg`);
    fs.writeFileSync(p, ONE_PIXEL_JPEG);
    uploadPaths.push(p);
  }

  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    if (!url.includes('generativelanguage.googleapis.com')) return realFetch(input, init);
    const model = modelOf(url);
    callsSeen.push({ model, key: keyOf(init) });
    return exhausted.has(model) ? dailyQuota() : ok();
  };

  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}, 60000);

afterAll(async () => {
  if (realFetch) globalThis.fetch = realFetch;
  if (server) await new Promise((r) => server.close(r));
  if (restoreClient) restoreClient();
  uploadPaths.forEach((p) => { try { fs.unlinkSync(p); } catch { /* already gone */ } });
});

beforeEach(() => {
  resetPrisma();
  callsSeen = [];
  exhausted = new Set();
  prismaFake.user.findUnique.mockResolvedValue({ sessionsValidFrom: null });
  prismaFake.activity.findUnique.mockResolvedValue(activityFixture());
  prismaFake.submission.update.mockResolvedValue({ id: 'x' });
});

const token = () => signToken({ id: T1, role: 'TEACHER', schoolId: 'school-a' });
const call = (method, url, body) => realFetch(`${baseUrl}${url}`, {
  method,
  headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

const analyze = (n) => {
  prismaFake.submission.findUnique.mockResolvedValue({
    id: `submission-${n}`, studentId: `student-${n}`, activityId: ACTIVITY,
    imageUrl: `/uploads/${path.basename(uploadPaths[n])}`,
    status: 'PENDING', activity: { class: { teacherId: T1 } },
  });
  return call('POST', `/api/teacher/submissions/submission-${n}/analyze`);
};

describe('every paper in a class is read by the same model while that model is healthy', () => {
  it('never opens on the fallback model just because it is the next slot', async () => {
    // Four papers is the length that failed before: the flat cursor's period is
    // the size of the pool, so papers three and four are exactly the ones that
    // used to land on lite.
    for (let n = 0; n < 4; n++) {
      const res = await analyze(n);
      expect(res.status).toBe(200);
    }

    expect(callsSeen).toHaveLength(4);
    expect(callsSeen.map((c) => c.model)).toEqual([PRIMARY, PRIMARY, PRIMARY, PRIMARY]);
  }, 60000);

  it('still spreads consecutive papers across credentials, which is what the offset was for', async () => {
    await analyze(0);
    const first = callsSeen[0].key;
    await analyze(1);
    const second = callsSeen[1].key;

    // Two independent daily budgets of the SAME reader. Spreading here costs
    // nothing in quality, which is the whole distinction between the two axes.
    expect(first).not.toBe(second);
    expect([first, second].sort()).toEqual([KEY_A, KEY_B]);
  }, 30000);
});

describe('the fallback model is reached only when the primary genuinely cannot answer', () => {
  it('tries every credential on the primary before touching the fallback', async () => {
    exhausted.add(PRIMARY);

    const res = await analyze(0);
    expect(res.status).toBe(200);

    // Both primary buckets are asked and refuse; only then does lite answer.
    // The assertion that fails on a flat walk is the ORDER: lite must not
    // appear before the primary list is finished.
    const models = callsSeen.map((c) => c.model);
    const firstLite = models.indexOf(LITE);
    expect(firstLite).toBeGreaterThan(-1);
    expect(models.slice(0, firstLite)).toEqual([PRIMARY, PRIMARY]);
    expect(callsSeen.slice(0, firstLite).map((c) => c.key).sort()).toEqual([KEY_A, KEY_B]);
  }, 30000);

  it('stops dialling a primary bucket that reported its daily quota is gone', async () => {
    exhausted.add(PRIMARY);
    await analyze(0);          // discovers both primary buckets are spent
    callsSeen = [];

    await analyze(1);

    // A daily cap rests the bucket, so the next paper should not spend a
    // rate-gate slot re-proving it. Straight to the reader that still has
    // budget.
    expect(callsSeen.every((c) => c.model === LITE)).toBe(true);
  }, 30000);
});
