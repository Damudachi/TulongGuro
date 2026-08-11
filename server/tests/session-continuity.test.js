import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

/**
 * Staying signed in.
 *
 * Sessions lasted twelve hours and did not renew, so a teacher using the app
 * daily on their own phone was asked to sign in again every morning. On a
 * device only they touch that is friction with nothing bought by it.
 *
 * A flat long expiry would fix the symptom and lose the property worth having:
 * a session nobody is using should still lapse. So the window slides instead.
 * The server verifies a token on every request already; when one is more than
 * halfway through its life it issues a fresh one alongside the response, and
 * apiFetch — which every call in the app goes through — swaps it in. Use the
 * app inside a week and you are never asked again; leave it for eight days and
 * you are asked once.
 *
 * The renewal decision is a pure function so it can be checked at the
 * boundaries, where an off-by-one would either renew on every single request
 * or never renew at all — both silent.
 */

const require = createRequire(import.meta.url);

function makePrismaFake() {
  const models = new Map();
  const defaults = {
    findUnique: null, findFirst: null, findMany: [], count: 0,
    create: {}, createMany: { count: 0 }, update: {}, updateMany: { count: 0 },
    delete: {}, deleteMany: { count: 0 }, aggregate: {}, groupBy: [], upsert: {},
  };
  const makeModel = () => {
    const model = {};
    for (const [m, v] of Object.entries(defaults)) model[m] = vi.fn().mockResolvedValue(v);
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
      for (const [m, v] of Object.entries(defaults)) model[m].mockReset().mockResolvedValue(v);
    }
    rawQuery.mockReset().mockResolvedValue([]);
  };
  return { fake, reset };
}

const { fake: prismaFake, reset: resetPrisma } = makePrismaFake();

process.env.AUTH_SECRET = 'session-continuity-test-secret';
process.env.NODE_ENV = 'test';

let baseUrl, server, auth, restoreClient;

beforeAll(async () => {
  restoreClient = require('../db.js').__setClientForTests(prismaFake);
  const { app } = require('../server.js');
  auth = require('../auth.js');
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}, 60000);

afterAll(async () => {
  if (server) await new Promise(r => server.close(r));
  if (restoreClient) restoreClient();
});

beforeEach(() => {
  resetPrisma();
  prismaFake.user.findUnique.mockResolvedValue({ sessionsValidFrom: null });
});

const HEADER = 'x-renewed-token';

describe('a session lasts long enough to be worth keeping', () => {
  it('runs for a week rather than a school day', () => {
    expect(auth.TOKEN_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
  });
});

describe('dueForRenewal decides at the halfway mark', () => {
  const TTL = 7 * 24 * 60 * 60;
  const at = (secondsOld) => {
    const now = Math.floor(Date.now() / 1000);
    return { claims: { iat: now - secondsOld, exp: now - secondsOld + TTL }, now };
  };

  it('leaves a token issued moments ago alone', () => {
    const { claims, now } = at(5);
    expect(auth.dueForRenewal(claims, now)).toBe(false);
  });

  it('leaves a token just short of halfway alone', () => {
    const { claims, now } = at(TTL / 2 - 60);
    expect(auth.dueForRenewal(claims, now)).toBe(false);
  });

  it('renews once past halfway', () => {
    const { claims, now } = at(TTL / 2 + 60);
    expect(auth.dueForRenewal(claims, now)).toBe(true);
  });

  it('renews a token close to expiring', () => {
    const { claims, now } = at(TTL - 60);
    expect(auth.dueForRenewal(claims, now)).toBe(true);
  });

  it('refuses to renew a token with no timestamps rather than guessing', () => {
    // A malformed payload must not be handed a brand-new full-length session.
    expect(auth.dueForRenewal({}, Math.floor(Date.now() / 1000))).toBe(false);
    expect(auth.dueForRenewal({ iat: 1 }, Math.floor(Date.now() / 1000))).toBe(false);
  });
});

describe('the server renews a session in the background', () => {
  const call = (token) =>
    fetch(`${baseUrl}/api/notifications`, { headers: { Authorization: `Bearer ${token}` } });

  /** A token as it would look after `age` seconds, signed for real. */
  const agedToken = (ageSeconds) => {
    const spy = vi.spyOn(Date, 'now').mockReturnValue((Math.floor(Date.now() / 1000) - ageSeconds) * 1000);
    const token = auth.signToken({ id: 'teacher-1', role: 'TEACHER', schoolId: 'school-1' });
    spy.mockRestore();
    return token;
  };

  it('sends no renewal for a fresh token', async () => {
    const res = await call(agedToken(60));
    expect(res.status).toBe(200);
    expect(res.headers.get(HEADER)).toBeNull();
  });

  it('sends a renewed token once the old one is past halfway', async () => {
    const res = await call(agedToken(5 * 24 * 60 * 60));
    expect(res.status).toBe(200);
    expect(res.headers.get(HEADER)).toBeTruthy();
  });

  it('renews into a token that is valid and carries the same identity', async () => {
    const res = await call(agedToken(5 * 24 * 60 * 60));
    const claims = auth.verifyToken(res.headers.get(HEADER));

    expect(claims).not.toBeNull();
    expect(claims.sub).toBe('teacher-1');
    expect(claims.role).toBe('TEACHER');
    expect(claims.schoolId).toBe('school-1');
    // The point of the exercise: the new one must outlive the old one.
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000) + 6 * 24 * 60 * 60);
  });

  it('never renews for a request that was refused', async () => {
    const res = await fetch(`${baseUrl}/api/notifications`);
    expect(res.status).toBe(401);
    expect(res.headers.get(HEADER)).toBeNull();
  });

  it('exposes the header to the browser', async () => {
    // Frontend and API are on different origins in production. Without this on
    // the CORS response the header arrives and the browser refuses to let
    // JavaScript read it — the feature would silently never fire.
    const res = await call(agedToken(5 * 24 * 60 * 60));
    const exposed = (res.headers.get('access-control-expose-headers') || '').toLowerCase();
    expect(exposed).toContain(HEADER);
  });
});

describe('login hands the client what its route guard needs', () => {
  it('keeps role on the returned user', async () => {
    // RequireRole reads `role` out of the stored user blob to decide whether an
    // area may render. If login ever stopped returning it, every signed-in user
    // would be bounced to /login forever — so the coupling is pinned here.
    const bcrypt = require('bcryptjs');
    prismaFake.user.findFirst.mockResolvedValue({
      id: 'teacher-1', username: 'teach', role: 'TEACHER', schoolId: 'school-1',
      name: 'A Teacher', password: bcrypt.hashSync('pw', 4), sessionsValidFrom: null,
      school: { status: 'APPROVED' },
    });

    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'teach', password: 'pw', role: 'TEACHER' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.user.role).toBe('TEACHER');
    expect(body.user.id).toBeTruthy();
    expect(body.token).toBeTruthy();
    expect(body.user.password).toBeUndefined();
  });
});
