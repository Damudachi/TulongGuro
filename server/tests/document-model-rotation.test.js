import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

/**
 * Which model actually reads a DOCUMENT — a rubric image, a curriculum guide,
 * a photo of a class list — when Google's capacity for the preferred one dips.
 *
 * Reported from the deployment's own Live Requests table, where an admin
 * uploading a rubric in the Curriculum tab watched this sequence go by:
 *
 *     EXTRACT gemini-3.6-flash         29.2s  TRANSIENT
 *     EXTRACT gemini-3.6-flash retry 1 28.3s  TRANSIENT
 *     EXTRACT gemini-3.6-flash retry 2 35.9s  TRANSIENT
 *     EXTRACT gemini-3.5-flash-lite     3.3s  OK
 *
 * Three attempts at one model on ONE credential, then the school's rubric was
 * transcribed by the cheaper reader. Both halves are wrong for this call. A 503
 * is Google-side capacity for a model on a project, so a second and third
 * attempt on the same key buys the same answer more slowly; and a rubric is
 * read once at set-up and then every grade in the class is measured against
 * what came back, so it is the last call in the system that should quietly
 * degrade to a weaker reader.
 *
 * Harness follows ai-credential-rotation.test.js: db.js is swapped through
 * Node's CJS cache before server.js is required, and global fetch answers as a
 * fake Google that can fail per credential. The model id is in the request URL
 * (…/models/<id>:generateContent), which is what lets these assert on the
 * reader rather than on the answer.
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

const KEY1 = 'doc-key-1';
const KEY2 = 'doc-key-2';
const KEY3 = 'doc-key-3';

process.env.AUTH_SECRET = 'document-rotation-test-secret';
process.env.NODE_ENV = 'test';
// Every slot set explicitly — server.js loads server/.env and dotenv leaves an
// already-set value alone, so a slot left untouched inherits whatever the
// developer running the tests happens to have configured. See the same note in
// ai-credential-rotation.test.js: blanking them is what makes this a fixture.
for (const name of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', ...Array.from({ length: 9 }, (_, i) => `GEMINI_API_KEY${i + 1}`)]) {
  process.env[name] = '';
}
process.env.GEMINI_API_KEY1 = KEY1;
process.env.GEMINI_API_KEY2 = KEY2;
process.env.GEMINI_API_KEY3 = KEY3;
process.env.GEMINI_DOCUMENT_MODELS = 'gemini-3.6-flash,gemini-3.5-flash-lite';
process.env.GEMINI_MIN_SPACING_MS = '0';
process.env.GEMINI_REQUEST_TIMEOUT_MS = '2000';
process.env.GEMINI_DOCUMENT_TIMEOUT_MS = '2000';
process.env.AI_CREDENTIAL_SELFCHECK = 'off';

const T1 = 'teacher-t1';

const ONE_PIXEL_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'
  + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA'
  + 'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

const RUBRIC_JSON = {
  criteria: [{ name: 'Content', description: 'Ideas are clear.', points: 100, bands: [] }],
  totalPoints: 100,
  rubricType: 'standard',
};

/** Google's own body for the capacity dip this rotation exists for. */
const overloaded = () => new Response(JSON.stringify({
  error: { code: 503, message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary.', status: 'UNAVAILABLE' },
}), { status: 503, headers: { 'Content-Type': 'application/json' } });

const ok = () => new Response(JSON.stringify({
  candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(RUBRIC_JSON) }] }, finishReason: 'STOP' }],
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
/** Every document call the fake Google saw, in order. */
let calls = [];
/** Which (credential, model) buckets answer 503 rather than OK. Both axes
 *  matter: a capacity dip belongs to a MODEL on a PROJECT, which is exactly why
 *  moving credential is the lever and re-dialling is not. */
let isOverloaded = () => false;

beforeAll(async () => {
  restoreClient = require('../db.js').__setClientForTests(prismaFake);
  const { app } = require('../server.js');
  ({ signToken } = require('../auth.js'));

  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    if (!url.includes('generativelanguage.googleapis.com')) return realFetch(input, init);
    const key = keyOf(init);
    calls.push({ key, model: modelOf(url) });
    return isOverloaded({ key, model: modelOf(url) }) ? overloaded() : ok();
  };

  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}, 60000);

afterAll(async () => {
  if (realFetch) globalThis.fetch = realFetch;
  if (server) await new Promise((r) => server.close(r));
  if (restoreClient) restoreClient();
});

beforeEach(() => {
  calls = [];
  isOverloaded = () => false;
  prismaFake.user.findUnique.mockResolvedValue({ sessionsValidFrom: null });
});

const token = () => signToken({ id: T1, role: 'TEACHER', schoolId: 'school-a' });

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

describe('a rubric is read by the preferred model, on whatever credential has capacity', () => {
  it('reads it on the preferred model when the first credential is healthy', async () => {
    const res = await extractRubric();

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    // The model this used to CLAIM in the request log while a hardcoded
    // 'gemini-3.5-flash' handle did the actual reading. One source of truth now.
    expect(calls[0].model).toBe('gemini-3.6-flash');
    expect(calls[0].key).toBe(KEY1);
  });

  it('moves to the next CREDENTIAL rather than re-dialling the busy one', async () => {
    isOverloaded = ({ key }) => key === KEY1;

    const res = await extractRubric();

    expect(res.status).toBe(200);
    // Two calls, two different keys — not the three-on-one-key the log showed.
    expect(calls.map(c => c.key)).toEqual([KEY1, KEY2]);
    // And the same reader both times. This is the assertion the whole change is
    // for: a busy 3.6 must not silently become a 3.5-flash-lite transcription
    // of the rubric every later grade in the class is measured against.
    expect(new Set(calls.map(c => c.model))).toEqual(new Set(['gemini-3.6-flash']));
  });

  it('spends every credential on the preferred model before it changes model', async () => {
    // 3.6 is out of capacity everywhere; the lighter model still has some.
    isOverloaded = ({ model }) => model === 'gemini-3.6-flash';

    const res = await extractRubric();

    expect(res.status).toBe(200);
    // Three credentials on 3.6 (GEMINI_DOCUMENT_MAX_TRIES defaults to 3), and
    // only then the fallback model — one try, on the far credential.
    expect(calls.map(c => c.model)).toEqual([
      'gemini-3.6-flash', 'gemini-3.6-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite',
    ]);
    expect(calls.slice(0, 3).map(c => c.key)).toEqual([KEY1, KEY2, KEY3]);
  });
});
