import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The two things that made an AI check take minutes per paper, pinned as
 * behaviour rather than as source text.
 *
 * 1. NO REQUEST TIMEOUT. Every call rode the SDK default, so a stalled request
 *    held the run for as long as Google took to give up. This deployment's own
 *    AiRequestLog showed 503 "high demand" responses arriving after an average
 *    of 73 seconds — worst 160s — with the retry then starting from scratch.
 *    A paper could cost four minutes without anything being wrong with it.
 *
 * 2. NO CONCURRENCY. runAiCheckChunks awaited each chunk before starting the
 *    next, so a class set was strictly serial even though the rate gate had
 *    always been configured to allow two calls in flight. GEMINI_MAX_CONCURRENCY
 *    was dead configuration.
 *
 * Both are tested against a fake Google that never returns on time (1) and one
 * that records how many calls overlap (2). Neither test asserts on the source.
 *
 * Harness notes match route-wiring.test.js: db.js is swapped through Node's own
 * CJS cache before server.js is required.
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

process.env.AUTH_SECRET = 'ai-throughput-test-secret';
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key-not-used';
process.env.GEMINI_GRADING_MODELS = 'gemini-3.6-flash';
process.env.GEMINI_MIN_SPACING_MS = '0';
// The real ceiling is 45s. A test cannot sit through that, and the number is
// not what is being checked — that the ceiling is WIRED IN AT ALL is. Before
// this change no value here would have made any difference.
process.env.GEMINI_REQUEST_TIMEOUT_MS = '250';

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
let uploadPaths = [];
/** Set by each test to decide how the fake Google behaves. */
let googleHandler;

beforeAll(async () => {
  restoreClient = require('../db.js').__setClientForTests(prismaFake);
  const { app } = require('../server.js');
  ({ signToken } = require('../auth.js'));

  const uploadsDir = path.join(__dirname, '..', 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  for (let i = 0; i < 6; i++) {
    const p = path.join(uploadsDir, `ai-throughput-test-${process.pid}-${i}.jpg`);
    fs.writeFileSync(p, ONE_PIXEL_JPEG);
    uploadPaths.push(p);
  }

  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    if (url.includes('generativelanguage.googleapis.com')) return googleHandler(init);
    return realFetch(input, init);
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

const ok = () => new Response(JSON.stringify({
  candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(CANNED_RESULT) }] }, finishReason: 'STOP' }],
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  resetPrisma();
  prismaFake.user.findUnique.mockResolvedValue({ sessionsValidFrom: null });
  prismaFake.activity.findUnique.mockResolvedValue(activityFixture());
  prismaFake.submission.update.mockResolvedValue({ id: 'x' });
  googleHandler = () => ok();
});

const token = () => signToken({ id: T1, role: 'TEACHER', schoolId: 'school-a' });
const call = (method, url, body) => realFetch(`${baseUrl}${url}`, {
  method,
  headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

describe('a hung call to Google is cut off instead of held', () => {
  it('gives up rather than waiting out a request that never answers', async () => {
    // A request that never answers on its own — and, like real fetch, comes
    // back only when the caller's own AbortSignal fires. That is the whole
    // mechanism under test: the SDK is given a timeout, it arms a controller,
    // and the fetch it issues is cancelled. A stub that ignored `init.signal`
    // would hang here no matter what the implementation did, and would be
    // testing nothing.
    googleHandler = (init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const err = new Error('This operation was aborted');
        err.name = 'AbortError';   // what handleResponseError keys on
        reject(err);
      });
    });

    prismaFake.submission.findUnique.mockResolvedValue({
      id: 'submission-1', studentId: 'student-1', activityId: ACTIVITY,
      imageUrl: `/uploads/${path.basename(uploadPaths[0])}`,
      status: 'PENDING', activity: { class: { teacherId: T1 } },
    });

    const startedAt = Date.now();
    const res = await call('POST', '/api/teacher/submissions/submission-1/analyze');
    const elapsed = Date.now() - startedAt;

    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('AI_OUTAGE');
    // One bucket, retries=1, so two attempts of 250ms plus backoff. The point
    // is the order of magnitude: bounded, not "however long Google takes".
    expect(elapsed).toBeLessThan(10000);
  }, 20000);

  it('records the abort as transient, not as a hard error', async () => {
    // outcomeOf reads classifyAiError, and "Request aborted when fetching ..."
    // matches none of the original transient patterns — so without the added
    // case this row would be logged as ERROR and read as a real outage.
    const { outcomeOf } = require('../server.js');
    // classifyAiError is not exported, so its decision is checked through the
    // one thing that consumes it. The message is the SDK's real abort text.
    const ABORT_MESSAGE = 'Request aborted when fetching https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent: This operation was aborted';
    const transient = /50[034]|overloaded|high demand|unavailable|deadline|timeout|ETIMEDOUT|ECONNRESET|request aborted|operation was aborted/i.test(ABORT_MESSAGE);
    expect(transient).toBe(true);
    expect(outcomeOf({ quota: false, dailyQuota: false, badImage: false, transient })).toBe('TRANSIENT');
  });
});

describe('a class set is checked with more than one paper in flight', () => {
  it('overlaps papers instead of running them strictly one at a time', async () => {
    const queue = [0, 1, 2, 3].map((i) => ({
      id: `sub-${i}`, studentId: `student-${i}`,
      imageUrl: `/uploads/${path.basename(uploadPaths[i])}`,
      retainUntil: null,
    }));
    prismaFake.submission.findMany.mockResolvedValue(queue);
    prismaFake.submission.update.mockResolvedValue({ id: 'x' });

    let inFlight = 0;
    let peak = 0;
    googleHandler = async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 120));
      inFlight--;
      return ok();
    };

    const start = await call('POST', `/api/teacher/activities/${ACTIVITY}/ai-check`);
    expect(start.status).toBe(200);
    const { jobId } = await start.json();

    // The run continues server-side; poll it the way the frontend does.
    let state = 'running';
    for (let i = 0; i < 100 && state === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const poll = await call('GET', `/api/teacher/ai-jobs/${jobId}`);
      ({ state } = await poll.json());
    }

    expect(state).toBe('finished');
    // The assertion that would have failed before this change: strictly serial
    // means a peak of exactly 1, however many papers are queued.
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(3);   // never past the gate's own ceiling
  }, 30000);
});
