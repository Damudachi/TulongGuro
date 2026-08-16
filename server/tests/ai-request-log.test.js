import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

/**
 * The per-request observation log, and the rule that it can never cost anyone a
 * grade.
 *
 * AiRequestLog exists so the Alpha-stage technical observation can report real
 * request latency and real consumption against the daily allowance — neither of
 * which was recoverable before, since timing was never measured and the quota
 * tally is an in-memory counter that resets on restart.
 *
 * The property that matters most here is not what it records but what it must
 * never do: a teacher's grading run cannot fail, stall or roll back because a
 * measurement row could not be written. So the write is fire-and-forget, and
 * every failure mode — a rejected insert, a table that does not exist yet on a
 * server whose migration has not been applied, a client that throws
 * synchronously — has to be swallowed. These tests are that guarantee.
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

process.env.AUTH_SECRET = 'ai-request-log-test-secret';
process.env.NODE_ENV = 'test';

let logAiRequest;
let outcomeOf;
let restoreClient;

beforeAll(() => {
  restoreClient = require('../db.js').__setClientForTests(prismaFake);
  ({ logAiRequest, outcomeOf } = require('../server.js'));
}, 60000);

afterAll(() => { if (restoreClient) restoreClient(); });

beforeEach(() => resetPrisma());

/** The row the log would have written, or undefined if it wrote nothing. */
const written = () => prismaFake.aiRequestLog.create.mock.calls[0]?.[0]?.data;

describe('what one request records', () => {
  it('records the call site, the model, the attempt and the latency', () => {
    logAiRequest({ purpose: 'GRADING', model: 'gemini-3.6-flash#1', attempt: 1, latencyMs: 1234, ok: true, outcome: 'OK' });

    expect(written()).toMatchObject({
      purpose: 'GRADING', model: 'gemini-3.6-flash#1', attempt: 1,
      latencyMs: 1234, ok: true, outcome: 'OK', detail: null,
    });
  });

  it('rounds latency and never records a negative one', () => {
    // A clock that steps backwards mid-request would otherwise put a negative
    // duration into the study's latency distribution.
    logAiRequest({ purpose: 'ASSIST', latencyMs: 12.7, ok: true });
    expect(written().latencyMs).toBe(13);

    resetPrisma();
    logAiRequest({ purpose: 'ASSIST', latencyMs: -5, ok: true });
    expect(written().latencyMs).toBe(0);
  });

  it('truncates the provider message rather than storing it whole', () => {
    logAiRequest({ purpose: 'GRADING', latencyMs: 10, ok: false, outcome: 'ERROR', detail: 'x'.repeat(5000) });
    expect(written().detail).toHaveLength(300);
  });

  it('defaults an unlabelled call rather than writing a half-row', () => {
    logAiRequest({ latencyMs: 1, ok: false });
    expect(written()).toMatchObject({ purpose: 'OTHER', model: null, attempt: 0, outcome: 'ERROR' });
  });
});

describe('observation cannot break grading', () => {
  it('swallows a rejected insert', async () => {
    prismaFake.aiRequestLog.create.mockRejectedValue(new Error('relation "AiRequestLog" does not exist'));
    // Both halves matter: the call must not throw, and the rejected promise it
    // creates must not surface as an unhandled rejection either.
    expect(() => logAiRequest({ purpose: 'GRADING', latencyMs: 5, ok: true })).not.toThrow();
    await new Promise(r => setImmediate(r));
  });

  it('swallows a client that throws synchronously', () => {
    prismaFake.aiRequestLog.create.mockImplementation(() => { throw new Error('no client'); });
    expect(() => logAiRequest({ purpose: 'GRADING', latencyMs: 5, ok: true })).not.toThrow();
  });

  it('returns nothing to await, so no caller can accidentally block on it', () => {
    expect(logAiRequest({ purpose: 'GRADING', latencyMs: 5, ok: true })).toBeUndefined();
  });
});

describe('how a failure is classified', () => {
  // The buckets the study reports against. A daily cap and a per-minute 429 are
  // both "quota" to the retry logic but very different facts about the service,
  // so they stay distinct here.
  it('separates a daily cap from an ordinary rate limit', () => {
    expect(outcomeOf({ quota: true, dailyQuota: true })).toBe('DAILY_QUOTA');
    expect(outcomeOf({ quota: true, dailyQuota: false })).toBe('QUOTA');
  });

  it('names an image the model refused, which is not a service failure at all', () => {
    expect(outcomeOf({ badImage: true })).toBe('BAD_IMAGE');
  });

  it('separates a transient blip from an unexplained failure', () => {
    expect(outcomeOf({ transient: true })).toBe('TRANSIENT');
    expect(outcomeOf({})).toBe('ERROR');
  });
});
