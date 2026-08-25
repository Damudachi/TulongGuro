import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

/**
 * What the AI Teacher Assistant does when its model says it is busy.
 *
 * The bug this file exists for is in this deployment's own AiRequestLog. Every
 * ASSIST row between 16:06 and 16:25 on 2026-08-25 reads:
 *
 *     [503 Service Unavailable] This model is currently experiencing high
 *     demand. Spikes in demand are usually temporary.
 *
 * three attempts each, roughly five seconds apart, every one of them against
 * gemini-3.5-flash on the same credential — because that is all the assistant
 * had. generateContentWithRetry's backoff re-dials the SAME model, so the
 * retries were spent asking a model that had just reported it was out of
 * capacity whether it was still out of capacity. The teacher got "The AI
 * Teacher Assistant could not be reached" while seven other credentials and
 * every other model sat unused.
 *
 * A 503 of that kind is Google-side capacity for one MODEL. It follows a
 * credential wherever it goes, so the only lever that moves it is asking a
 * different model — which is the same reasoning that put a rotation pool
 * behind grading, applied to the caller that never got one.
 *
 * Harness matches ai-credential-rotation.test.js: db.js is swapped through
 * Node's CJS cache before server.js is required, and global fetch is
 * intercepted so the fake Google can answer differently per model. Dispatch is
 * on the model id in the URL rather than on the key header, because the model
 * is the axis that matters here.
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

const BUSY_MODEL = 'assist-busy-flash';
const LIVE_MODEL = 'assist-live-flash';

process.env.AUTH_SECRET = 'assist-rotation-test-secret';
process.env.NODE_ENV = 'test';
// Every credential slot explicitly, for the reason ai-credential-rotation.test.js
// spells out: server.js loads server/.env and dotenv does not overwrite what is
// already on process.env, so leaving a slot alone hands it whatever the
// developer running the tests happens to have configured.
for (const name of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', ...Array.from({ length: 9 }, (_, i) => `GEMINI_API_KEY${i + 1}`)]) {
  process.env[name] = '';
}
process.env.GEMINI_API_KEY1 = 'assist-key-1';
process.env.GEMINI_API_KEY2 = 'assist-key-2';
process.env.GEMINI_ASSIST_MODELS = `${BUSY_MODEL},${LIVE_MODEL}`;
process.env.GEMINI_MIN_SPACING_MS = '0';
process.env.GEMINI_REQUEST_TIMEOUT_MS = '2000';

const T1 = 'teacher-t1';

/** Google's real body for a model that is out of capacity. */
const busy = () => new Response(JSON.stringify({
  error: {
    code: 503,
    message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.',
    status: 'UNAVAILABLE',
  },
}), { status: 503, headers: { 'Content-Type': 'application/json' } });

const answered = () => new Response(JSON.stringify({
  candidates: [{
    content: {
      role: 'model',
      parts: [{ text: JSON.stringify({ action: 'answer', reply: 'The paper argues its point in three steps.', revisedFeedback: null }) }],
    },
    finishReason: 'STOP',
  }],
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

let baseUrl, server, signToken, restoreClient, realFetch;
/** Every (model, key) the fake Google was called with, in order. */
let callsSeen = [];
/** Which models the fake Google is currently refusing. */
let busyModels = new Set();

function keyOf(init) {
  const h = init?.headers;
  if (!h) return null;
  if (typeof h.get === 'function') return h.get('x-goog-api-key');
  return h['x-goog-api-key'] || h['X-Goog-Api-Key'] || null;
}

/** "…/models/assist-busy-flash:generateContent" → "assist-busy-flash" */
function modelOf(url) {
  return /\/models\/([^:/]+):/.exec(url)?.[1] || null;
}

beforeAll(async () => {
  restoreClient = require('../db.js').__setClientForTests(prismaFake);
  const { app } = require('../server.js');
  ({ signToken } = require('../auth.js'));

  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    if (!url.includes('generativelanguage.googleapis.com')) return realFetch(input, init);
    const model = modelOf(url);
    callsSeen.push({ model, key: keyOf(init) });
    return busyModels.has(model) ? busy() : answered();
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
  resetPrisma();
  callsSeen = [];
  busyModels = new Set([BUSY_MODEL]);
  prismaFake.user.findUnique.mockResolvedValue({ sessionsValidFrom: null });
});

const token = () => signToken({ id: T1, role: 'TEACHER', schoolId: 'school-a' });
const ask = (prompt = 'Why did this paper lose marks on organisation?') => realFetch(`${baseUrl}/api/teacher/assistant`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt, currentFeedback: 'The essay states a position.', isStructured: false }),
});

describe('a busy model does not take the assistant down with it', () => {
  it('answers anyway, on the next model in the pool', async () => {
    const res = await ask();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.refineFailed).toBe(false);
    expect(body.reply).toContain('three steps');
    // The assertion that fails on the old single-model assistant: something
    // other than the busy model was actually dialled.
    expect(callsSeen.map(c => c.model)).toContain(LIVE_MODEL);
  }, 20000);

  it('changes the MODEL before it changes the credential', async () => {
    await ask();
    // A 503 belongs to the model, not to the key, so re-asking the same model
    // on a second credential buys the same answer more slowly. First two tries
    // must be the two different models.
    expect(callsSeen[0].model).toBe(BUSY_MODEL);
    expect(callsSeen[1].model).toBe(LIVE_MODEL);
    expect(callsSeen[1].key).toBe(callsSeen[0].key);
  }, 20000);

  it('does not re-dial the model that just said it was busy', async () => {
    await ask();
    // retries: 0 per bucket. The old path spent its whole retry budget here —
    // three attempts at the one model — which is what produced the failure the
    // teacher saw.
    expect(callsSeen.filter(c => c.model === BUSY_MODEL)).toHaveLength(1);
  }, 20000);
});

describe('when every model in the pool is busy', () => {
  it('says the models are busy rather than that it could not be reached', async () => {
    busyModels = new Set([BUSY_MODEL, LIVE_MODEL]);
    const res = await ask();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.refineFailed).toBe(true);
    // "Could not be reached" is wrong for this and it is the wrong advice: the
    // model answered, promptly, to say it was busy. A teacher told the thing is
    // unreachable stops trying; one told it is busy tries again in a minute.
    expect(body.refineFailedReason).toMatch(/busy/i);
    expect(body.refineFailedReason).not.toMatch(/could not be reached/i);
  }, 30000);

  it('gives up after GEMINI_ASSIST_MAX_TRIES rather than walking the whole pool', async () => {
    busyModels = new Set([BUSY_MODEL, LIVE_MODEL]);
    await ask();
    // There is a teacher watching a spinner, and every try costs a rate-gate
    // slot. Four buckets is enough to prove a 503 is not just this model.
    expect(callsSeen.length).toBeLessThanOrEqual(4);
    expect(callsSeen.length).toBeGreaterThan(1);
  }, 30000);
});
