import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

/**
 * What happens to the grading pool when one of its CREDENTIALS is refused.
 *
 * This matters because of how the pool is now fed. It used to hold one key the
 * operator owned; it now holds up to eleven, and on this deployment the eight
 * in use were cut from eight different Google accounts belonging to eight
 * different people. Any one of them can revoke, regenerate, or exhaust the
 * free tier of their own project without telling anyone, and the server finds
 * out only when a call fails.
 *
 * A refused key is a category of its own: unlike a quota it will never succeed
 * on retry, and unlike a bad image it says nothing about the paper. Before it
 * was classified, such an error fell into the generic "ERROR" bucket, which
 * meant the entry was never rested — so the dead key was dialled again on the
 * next paper, and the next, forever. Each doomed attempt still has to take a
 * slot from the rate gate (one start per GEMINI_MIN_SPACING_MS), so on a
 * two-model pool a single revoked key taxed every paper for the rest of the
 * process's life.
 *
 * Harness matches ai-check-throughput.test.js: db.js is swapped through Node's
 * own CJS cache before server.js is required, and global fetch is intercepted
 * so the fake Google can answer differently per credential. The SDK sends the
 * key in the x-goog-api-key header, which is what lets one bucket be poisoned
 * while its siblings stay healthy.
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

const DEAD_KEY = 'test-key-revoked';
const LIVE_KEY = 'test-key-working';

process.env.AUTH_SECRET = 'ai-credential-test-secret';
process.env.NODE_ENV = 'test';
// Every credential slot is set explicitly, including the ones this test does
// not want. server.js loads server/.env, and dotenv does not overwrite a value
// already on process.env — so leaving a slot alone does not empty it, it hands
// it whatever the developer running the tests happens to have configured. On
// this machine that quietly turned a deliberate two-bucket pool into an
// eight-bucket one and made the assertions below depend on a gitignored file.
// Blanking them is what makes the pool a fixture rather than a local accident.
for (const name of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', ...Array.from({ length: 9 }, (_, i) => `GEMINI_API_KEY${i + 1}`)]) {
  process.env[name] = '';
}
// Two credentials x two models = a four-bucket pool. Two of each is the
// smallest arrangement that can tell the two failure granularities apart: a
// quota belongs to one bucket, a refused key belongs to every bucket holding
// that key. A one-model pool would pass either way.
process.env.GEMINI_API_KEY1 = DEAD_KEY;
process.env.GEMINI_API_KEY2 = LIVE_KEY;
process.env.GEMINI_GRADING_MODELS = 'gemini-3.6-flash,gemini-3.5-flash-lite';
// The sweep is exercised directly below; leaving the boot timer to fire it
// would race the assertions.
process.env.AI_CREDENTIAL_SELFCHECK = 'on';
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
/** Every key the fake Google was called with, in order. */
let keysSeen = [];

/** Google's real 400 body for a key that has been revoked or mistyped. */
const refused = () => new Response(JSON.stringify({
  error: {
    code: 400,
    message: 'API key not valid. Please pass a valid API key.',
    status: 'INVALID_ARGUMENT',
    details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID', domain: 'googleapis.com' }],
  },
}), { status: 400, headers: { 'Content-Type': 'application/json' } });

const ok = () => new Response(JSON.stringify({
  candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(CANNED_RESULT) }] }, finishReason: 'STOP' }],
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

/** The SDK puts the credential in x-goog-api-key; headers may be a plain
 *  object or a Headers instance depending on SDK version, so read both. */
function keyOf(init) {
  const h = init?.headers;
  if (!h) return null;
  if (typeof h.get === 'function') return h.get('x-goog-api-key');
  return h['x-goog-api-key'] || h['X-Goog-Api-Key'] || null;
}

beforeAll(async () => {
  restoreClient = require('../db.js').__setClientForTests(prismaFake);
  const { app } = require('../server.js');
  ({ signToken } = require('../auth.js'));

  const uploadsDir = path.join(__dirname, '..', 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  for (let i = 0; i < 4; i++) {
    const p = path.join(uploadsDir, `ai-credential-test-${process.pid}-${i}.jpg`);
    fs.writeFileSync(p, ONE_PIXEL_JPEG);
    uploadPaths.push(p);
  }

  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    if (!url.includes('generativelanguage.googleapis.com')) return realFetch(input, init);
    const key = keyOf(init);
    keysSeen.push(key);
    return key === DEAD_KEY ? refused() : ok();
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
  keysSeen = [];
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

describe('a refused credential is taken out of the rotation', () => {
  it('still grades the paper, by moving to a credential that works', async () => {
    const res = await analyze(0);
    expect(res.status).toBe(200);
    // The dead key was tried (it is first in the pool) and the live one paid.
    expect(keysSeen).toContain(DEAD_KEY);
    expect(keysSeen).toContain(LIVE_KEY);
    // Asserted here, in the first test to run, because this is the only point
    // at which the pool has not yet rested the bad bucket. Exactly one attempt:
    // not the two `retries: 1` would give a transient failure (a refused key is
    // refused a millisecond later too), and not the two a two-model pool would
    // cost if only the bucket that failed were rested instead of the key.
    expect(keysSeen.filter((k) => k === DEAD_KEY)).toHaveLength(1);
  }, 20000);

  it('does not dial the dead key again on later papers', async () => {
    await analyze(1);   // discovers the bad credential and rests that bucket
    keysSeen = [];

    await analyze(2);
    await analyze(3);

    // The assertion that fails without the credential classification: an
    // unrested entry stays in gradingRotation() and is retried on every paper.
    expect(keysSeen).not.toContain(DEAD_KEY);
    expect(keysSeen.every((k) => k === LIVE_KEY)).toBe(true);
  }, 30000);

  it('rests every bucket holding that key, not just the one that failed', async () => {
    await analyze(0);
    const res = await call('GET', '/api/teacher/ai-capacity');
    const { capacity } = await res.json();

    const dead = capacity.models.filter((m) => m.key === 'GEMINI_API_KEY1');
    const live = capacity.models.filter((m) => m.key === 'GEMINI_API_KEY2');

    expect(capacity.credentials).toBe(2);
    expect(capacity.buckets).toBe(4);

    // Google refused the KEY, so what it said is true of both models it is
    // paired with. Resting only the discovering bucket would leave the sibling
    // live to prove the same thing again on the next paper.
    expect(dead).toHaveLength(2);
    expect(dead.every((m) => m.exhausted)).toBe(true);
    // "Out of budget" and "key refused" both empty a bucket; only one of them
    // is fixed by waiting, so the snapshot has to tell them apart.
    expect(dead.every((m) => m.restReason === 'CREDENTIAL')).toBe(true);

    expect(live).toHaveLength(2);
    expect(live.every((m) => !m.exhausted)).toBe(true);
    expect(live.every((m) => m.restReason === null)).toBe(true);
  }, 20000);

  it('finds the dead key in the daily sweep, before a teacher does', async () => {
    // The sweep is what closes the window in which a revoked key is invisible.
    // Without it the pool learns a key is dead only when a real paper is sent
    // to it, so the first teacher of the day pays the discovery — and on a pool
    // fed by eight people's personal Google accounts, keys go away without
    // anyone announcing it.
    const { runDailyQuotaSelfCheck, gradingCapacitySnapshot } = require('../server.js');

    await runDailyQuotaSelfCheck();

    // One probe per CREDENTIAL, not per bucket: a refused key is refused on
    // every model, so asking each model separately would double the cost of the
    // sweep to learn nothing extra. Four buckets, two keys, two probes.
    expect(keysSeen).toHaveLength(2);
    expect(new Set(keysSeen)).toEqual(new Set([DEAD_KEY, LIVE_KEY]));

    const snapshot = gradingCapacitySnapshot();
    const dead = snapshot.models.filter((m) => m.key === 'GEMINI_API_KEY1');
    expect(dead.every((m) => m.restReason === 'CREDENTIAL')).toBe(true);
    // The good credential is untouched by its neighbour's failure.
    expect(snapshot.models.filter((m) => m.key === 'GEMINI_API_KEY2').every((m) => !m.exhausted)).toBe(true);
  }, 20000);

  it('classifies the refusal as BAD_CREDENTIAL rather than a generic error', () => {
    const { outcomeOf } = require('../server.js');
    // classifyAiError is not exported, so its decision is read through the one
    // thing that consumes it, as in ai-check-throughput.test.js.
    expect(outcomeOf({ credential: true })).toBe('BAD_CREDENTIAL');
    // A quota error must not be mistaken for a dead key: it comes back on its
    // own, and resting it for the credential cooldown would throw away most of
    // a day's budget every time a per-minute limit was hit.
    expect(outcomeOf({ quota: true, dailyQuota: true })).toBe('DAILY_QUOTA');
  });
});
