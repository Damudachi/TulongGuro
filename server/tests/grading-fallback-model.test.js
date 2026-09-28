import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

/**
 * WHICH MODEL SITS IN THE FALLBACK SLOT — pinned, because it is a decision and
 * not an implementation detail.
 *
 * The fallback was gemini-3.5-flash-lite until 2026-09-28. It was chosen on
 * price: Lite is ~5x cheaper on input, which is what made retrying a whole
 * essay image affordable. Changed to gemini-3.5-flash on panel review, and the
 * reasoning that moved it is the reasoning this file exists to keep true —
 *
 *   a paper only ever reaches the fallback because the PRIMARY could not read
 *   it. So the papers most at risk of being mis-transcribed were precisely the
 *   ones being handed to the lighter reader, and a pupil's mark came to depend
 *   on which side of 3.6's daily quota their paper happened to land on.
 *
 * That makes "the fallback is a full Flash model" a property of the gradebook's
 * fairness, not a config preference, and the kind of thing a later edit can
 * undo silently while every other test stays green — every other AI test in
 * this suite sets GEMINI_GRADING_MODELS to a literal fixture, so none of them
 * would notice the DEFAULT moving. This file is the one that leaves the model
 * env vars unset on purpose and asserts what the code itself falls back to.
 *
 * Harness follows document-model-rotation.test.js: db.js is swapped through
 * Node's CJS cache before server.js is required, and global fetch answers as a
 * fake Google. The model id is in the request URL
 * (…/models/<id>:generateContent), which is what lets these assert on the
 * reader that actually answered rather than on what a log row claimed.
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
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop === 'then') return undefined;
      if (prop === '$transaction') return (a) => (typeof a === 'function' ? a(fake) : Promise.all(a));
      if (prop === '$queryRaw') return () => Promise.resolve([]);
      if (prop.startsWith('$')) return () => Promise.resolve(undefined);
      if (!models.has(prop)) models.set(prop, makeModel());
      return models.get(prop);
    },
  });
  return { fake };
}

const { fake: prismaFake } = makePrismaFake();

/** What this file is pinning. Written out rather than imported, so that moving
 *  the constant in server.js fails here instead of silently agreeing. */
const PRIMARY = 'gemini-3.6-flash';
const FALLBACK = 'gemini-3.5-flash';

const KEY1 = 'fallback-key-1';
const KEY2 = 'fallback-key-2';

process.env.AUTH_SECRET = 'grading-fallback-test-secret';
process.env.NODE_ENV = 'test';
// Every credential slot set explicitly — server.js loads server/.env and dotenv
// leaves an already-set value alone, so a slot left untouched inherits whatever
// the developer running the tests happens to have configured. See the same note
// in ai-credential-rotation.test.js: blanking them is what makes this a fixture.
for (const name of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', ...Array.from({ length: 9 }, (_, i) => `GEMINI_API_KEY${i + 1}`)]) {
  process.env[name] = '';
}
process.env.GEMINI_API_KEY1 = KEY1;
process.env.GEMINI_API_KEY2 = KEY2;
// THE POINT OF THIS FILE: the model vars are blanked, not set. Blank rather
// than deleted, because deleting them would let dotenv fill them from a
// developer's own server/.env and the defaults would go untested — while an
// empty string is falsy, so server.js falls through to the ids compiled into
// it. Do not give these fixtures here; every assertion below is about what the
// code chooses when a deployment says nothing.
process.env.GEMINI_MODEL = '';
process.env.GEMINI_LITE_MODEL = '';
process.env.GEMINI_GRADING_MODELS = '';
process.env.GEMINI_DOCUMENT_MODELS = '';
process.env.GEMINI_MIN_SPACING_MS = '0';
process.env.GEMINI_REQUEST_TIMEOUT_MS = '2000';
process.env.GEMINI_DOCUMENT_TIMEOUT_MS = '2000';
process.env.AI_CREDENTIAL_SELFCHECK = 'off';

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

const RUBRIC_JSON = {
  criteria: [{ name: 'Content', description: 'Ideas are clear.', points: 100, bands: [] }],
  totalPoints: 100,
  rubricType: 'standard',
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

/** Google's own body for the capacity dip a fallback tier exists for. */
const overloaded = () => new Response(JSON.stringify({
  error: { code: 503, message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary.', status: 'UNAVAILABLE' },
}), { status: 503, headers: { 'Content-Type': 'application/json' } });

const ok = (payload) => new Response(JSON.stringify({
  candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(payload) }] }, finishReason: 'STOP' }],
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

function keyOf(init) {
  const h = init?.headers;
  if (!h) return null;
  if (typeof h.get === 'function') return h.get('x-goog-api-key');
  return h['x-goog-api-key'] || h['X-Goog-Api-Key'] || null;
}

/** The model id Google was asked for, read off the request URL. */
function modelOf(url) {
  return (/\/models\/([^:?]+)/.exec(url) || [])[1] || null;
}

let baseUrl, server, signToken, restoreClient, realFetch;
let uploadPath;
/** Every model call the fake Google saw, in order. */
let calls = [];
/** Which model ids answer 503 rather than OK, so a test can empty the primary
 *  tier and watch where the work actually lands. */
let isOverloaded = () => false;
/** What a successful call returns — grading JSON or rubric JSON. */
let payload = CANNED_RESULT;

beforeAll(async () => {
  restoreClient = require('../db.js').__setClientForTests(prismaFake);
  const { app } = require('../server.js');
  ({ signToken } = require('../auth.js'));

  const uploadsDir = path.join(__dirname, '..', 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  uploadPath = path.join(uploadsDir, `grading-fallback-test-${process.pid}.jpg`);
  fs.writeFileSync(uploadPath, ONE_PIXEL_JPEG);

  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    if (!url.includes('generativelanguage.googleapis.com')) return realFetch(input, init);
    const call = { key: keyOf(init), model: modelOf(url) };
    calls.push(call);
    return isOverloaded(call) ? overloaded() : ok(payload);
  };

  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}, 60000);

afterAll(async () => {
  if (realFetch) globalThis.fetch = realFetch;
  if (server) await new Promise((r) => server.close(r));
  if (restoreClient) restoreClient();
  try { fs.unlinkSync(uploadPath); } catch { /* already gone */ }
});

beforeEach(() => {
  calls = [];
  isOverloaded = () => false;
  payload = CANNED_RESULT;
  prismaFake.user.findUnique.mockResolvedValue({ sessionsValidFrom: null });
  prismaFake.activity.findUnique.mockResolvedValue(activityFixture());
  prismaFake.submission.update.mockResolvedValue({ id: 'submission-1' });
});

const token = () => signToken({ id: T1, role: 'TEACHER', schoolId: 'school-a' });

const analyze = () => {
  prismaFake.submission.findUnique.mockResolvedValue({
    id: 'submission-1', studentId: 'student-1', activityId: ACTIVITY,
    imageUrl: `/uploads/${path.basename(uploadPath)}`,
    status: 'PENDING', activity: { class: { teacherId: T1 } },
  });
  return realFetch(`${baseUrl}/api/teacher/submissions/submission-1/analyze`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}` },
  });
};

/** Upload a rubric image to the extraction route the Curriculum tab calls. */
async function extractRubric() {
  const form = new FormData();
  form.append('rubricFile', new Blob([ONE_PIXEL_JPEG], { type: 'image/jpeg' }), 'rubric.jpg');
  return realFetch(`${baseUrl}/api/teacher/rubric/extract`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}` },
    body: form,
  });
}

describe('the fallback model a deployment gets when it configures nothing', () => {
  it('is 3.5 Flash — a full Flash model, not a Lite one', async () => {
    const res = await realFetch(`${baseUrl}/api/teacher/ai-capacity`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    expect(res.status).toBe(200);
    const { capacity } = await res.json();

    // One tier per model, in preference order, each spread over both keys.
    expect([...new Set(capacity.models.map(m => m.id))]).toEqual([PRIMARY, FALLBACK]);
    // Stated separately from the equality above so a failure says WHICH thing
    // broke: a Lite model anywhere in the checking pool is the specific
    // regression this file was written to catch.
    expect(capacity.models.filter(m => /lite/i.test(m.id))).toEqual([]);
    // Two models x two credentials — the fallback is a separate daily budget,
    // which is the other half of why it is a different model at all.
    expect(capacity.buckets).toBe(4);
  });

  it('grades a real paper on 3.5 Flash once the primary has no capacity left', async () => {
    isOverloaded = ({ model }) => model === PRIMARY;

    const res = await analyze();
    expect(res.status).toBe(200);

    // Every 3.6 bucket was spent first — the fallback is a fallback, not a share.
    expect(calls.filter(c => c.model === PRIMARY).map(c => c.key)).toContain(KEY1);
    expect(calls.filter(c => c.model === PRIMARY).map(c => c.key)).toContain(KEY2);
    // And the call that actually produced the mark went to 3.5 Flash.
    expect(calls[calls.length - 1].model).toBe(FALLBACK);
    expect(calls.some(c => /lite/i.test(c.model))).toBe(false);
    // The paper was graded rather than failed — a fallback that is never
    // reached would also pass the assertions above.
    expect(prismaFake.submission.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ aiScore: CANNED_RESULT.score }) })
    );
  });

  it('reads a rubric on 3.5 Flash too — both pools share the one fallback constant', async () => {
    payload = RUBRIC_JSON;
    isOverloaded = ({ model }) => model === PRIMARY;

    const res = await extractRubric();
    expect(res.status).toBe(200);

    // Document reads have their own rotation (credentials first, then models),
    // but they take the same default pair. Changing the fallback in one place
    // and not the other is the mistake this asserts against.
    expect(calls.map(c => c.model)).toEqual([PRIMARY, PRIMARY, FALLBACK]);
  });
});
