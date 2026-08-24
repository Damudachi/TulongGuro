import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Web Push delivery — the half of the notification system that can reach a
 * phone with the app closed.
 *
 * Why this suite is worth its length: everything here fails silently in
 * production. A push that is never sent, sent to a dead subscription, or sent
 * twice to the same device produces no error anybody sees — the server logs a
 * line, the student simply is not told their grade is ready, and the symptom
 * ("notifications don't work on some phones") is indistinguishable from the
 * user having denied permission. So the rules are pinned here rather than
 * discovered later.
 *
 * Harness follows ai-credential-rotation.test.js: the module under test is CJS
 * and reads its configuration at require time, so it is swapped through Node's
 * own CJS cache with a fake web-push and re-required per scenario.
 */

const require = createRequire(import.meta.url);
const PUSH_PATH = require.resolve('../push.js');
const WEBPUSH_PATH = require.resolve('web-push');

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

let realWebPush;
let savedEnv;

/** A push service that always accepts. */
function acceptingService() {
  return {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }),
  };
}

/**
 * Load push.js fresh against a given environment and fake push service.
 *
 * Both caches have to be cleared, not just push.js's: setVapidDetails is called
 * at module scope, so a stale web-push would keep the previous test's
 * configuration and the "disabled without keys" case would pass for the wrong
 * reason.
 */
function loadPush({ publicKey, privateKey, subject } = {}, service = acceptingService()) {
  if (publicKey === undefined) delete process.env.VAPID_PUBLIC_KEY;
  else process.env.VAPID_PUBLIC_KEY = publicKey;
  if (privateKey === undefined) delete process.env.VAPID_PRIVATE_KEY;
  else process.env.VAPID_PRIVATE_KEY = privateKey;
  if (subject === undefined) delete process.env.VAPID_SUBJECT;
  else process.env.VAPID_SUBJECT = subject;

  require.cache[WEBPUSH_PATH] = {
    id: WEBPUSH_PATH, filename: WEBPUSH_PATH, loaded: true, exports: service,
  };
  delete require.cache[PUSH_PATH];
  return { push: require(PUSH_PATH), service };
}

/** A prisma stand-in holding a fixed set of subscriptions. */
function fakePrisma(subscriptions) {
  return {
    deleted: [],
    touched: [],
    pushSubscription: {
      findMany: vi.fn().mockResolvedValue(subscriptions),
      deleteMany: vi.fn(function ({ where }) {
        this.deleted?.push?.(...(where.id.in || []));
        return Promise.resolve({ count: where.id.in.length });
      }),
      updateMany: vi.fn().mockResolvedValue({ count: subscriptions.length }),
    },
  };
}

const sub = (n) => ({
  id: `sub-${n}`,
  endpoint: `https://push.example.test/${n}`,
  p256dh: `p256dh-${n}`,
  auth: `auth-${n}`,
});

// A real-looking VAPID pair. Never used to sign anything here — web-push is
// faked — but push.js only checks that both are non-empty, and using obviously
// fake values keeps this file from looking like it leaks a key.
const KEYS = { publicKey: 'test-public-key', privateKey: 'test-private-key' };

beforeEach(() => {
  savedEnv = {
    pub: process.env.VAPID_PUBLIC_KEY,
    priv: process.env.VAPID_PRIVATE_KEY,
    subj: process.env.VAPID_SUBJECT,
  };
  realWebPush = require.cache[WEBPUSH_PATH];
});

afterEach(() => {
  // Restore both the environment and the module cache. Without the second, a
  // later suite that requires server.js would get the fake push service.
  if (savedEnv.pub === undefined) delete process.env.VAPID_PUBLIC_KEY;
  else process.env.VAPID_PUBLIC_KEY = savedEnv.pub;
  if (savedEnv.priv === undefined) delete process.env.VAPID_PRIVATE_KEY;
  else process.env.VAPID_PRIVATE_KEY = savedEnv.priv;
  if (savedEnv.subj === undefined) delete process.env.VAPID_SUBJECT;
  else process.env.VAPID_SUBJECT = savedEnv.subj;

  if (realWebPush) require.cache[WEBPUSH_PATH] = realWebPush;
  else delete require.cache[WEBPUSH_PATH];
  delete require.cache[PUSH_PATH];
});

describe('push is optional', () => {
  it('reports itself disabled when no VAPID keys are set', () => {
    const { push } = loadPush({});
    expect(push.isPushConfigured()).toBe(false);
    expect(push.getPublicKey()).toBeNull();
  });

  it('sends nothing at all when disabled, rather than failing', async () => {
    const { push, service } = loadPush({});
    const prisma = fakePrisma([sub(1)]);

    const result = await push.sendPushToUser(prisma, 'user-1', { type: 'GRADE_RELEASED', title: 'Hi' });

    expect(service.sendNotification).not.toHaveBeenCalled();
    // Not even a database read: an unconfigured deployment should cost nothing
    // per notification, and every release writes one of these per student.
    expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, failed: 0, pruned: 0 });
  });

  it('half a keypair is still disabled', () => {
    expect(loadPush({ publicKey: 'only-public' }).push.isPushConfigured()).toBe(false);
    expect(loadPush({ privateKey: 'only-private' }).push.isPushConfigured()).toBe(false);
  });

  it('configures the push library once both keys are present', () => {
    const { push, service } = loadPush(KEYS);
    expect(push.isPushConfigured()).toBe(true);
    expect(push.getPublicKey()).toBe('test-public-key');
    expect(service.setVapidDetails).toHaveBeenCalledWith(
      expect.stringMatching(/^(mailto:|https:)/),
      'test-public-key',
      'test-private-key',
    );
  });
});

describe('delivering to a user', () => {
  it('sends to every device that user has registered', async () => {
    const { push, service } = loadPush(KEYS);
    const prisma = fakePrisma([sub(1), sub(2), sub(3)]);

    const result = await push.sendPushToUser(prisma, 'user-1', {
      type: 'GRADE_RELEASED', title: 'Your grade is ready', body: 'English 6', link: '/student/activity/9',
    });

    expect(service.sendNotification).toHaveBeenCalledTimes(3);
    expect(result.sent).toBe(3);

    const [subscription, payload] = service.sendNotification.mock.calls[0];
    expect(subscription).toEqual({
      endpoint: 'https://push.example.test/1',
      keys: { p256dh: 'p256dh-1', auth: 'auth-1' },
    });
    expect(JSON.parse(payload)).toMatchObject({
      title: 'Your grade is ready',
      body: 'English 6',
      link: '/student/activity/9',
    });
  });

  it('does not read the database when the user has no devices', async () => {
    const { push, service } = loadPush(KEYS);
    const prisma = fakePrisma([]);
    const result = await push.sendPushToUser(prisma, 'user-1', { type: 'X', title: 'T' });
    expect(service.sendNotification).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
  });

  it('tags by type so six papers released at once collapse into one tray entry', async () => {
    const { push, service } = loadPush(KEYS);
    await push.sendPushToUser(fakePrisma([sub(1)]), 'u', { type: 'GRADE_RELEASED', title: 'T' });
    expect(JSON.parse(service.sendNotification.mock.calls[0][1]).tag).toBe('tg-GRADE_RELEASED');
  });

  it('refuses a link that is not an in-app path', async () => {
    const { push, service } = loadPush(KEYS);
    // A notification is a thing the user taps; a payload that could carry an
    // absolute URL is a payload that could carry an off-site one.
    await push.sendPushToUser(fakePrisma([sub(1)]), 'u', {
      type: 'X', title: 'T', link: 'https://evil.example/steal',
    });
    expect(JSON.parse(service.sendNotification.mock.calls[0][1]).link).toBe('/');
  });

  it('trims a long body rather than letting the encrypted payload overflow', async () => {
    const { push, service } = loadPush(KEYS);
    const { MAX_BODY } = push.__test__;

    await push.sendPushToUser(fakePrisma([sub(1)]), 'u', {
      type: 'X', title: 'T', body: 'x'.repeat(MAX_BODY + 500),
    });

    const { body } = JSON.parse(service.sendNotification.mock.calls[0][1]);
    expect(body.length).toBe(MAX_BODY);
    expect(body.endsWith('…')).toBe(true);
  });

  it('falls back to the app name when a notification has no usable title', async () => {
    const { push, service } = loadPush(KEYS);
    await push.sendPushToUser(fakePrisma([sub(1)]), 'u', { type: 'X', title: '   ' });
    expect(JSON.parse(service.sendNotification.mock.calls[0][1]).title).toBe('TulongGuro');
  });

  it('asks the push service to hold the message for a day', async () => {
    const { push, service } = loadPush(KEYS);
    await push.sendPushToUser(fakePrisma([sub(1)]), 'u', { type: 'X', title: 'T' });
    const options = service.sendNotification.mock.calls[0][2];
    // A grade released on Friday afternoon should still arrive when the phone
    // is switched on over the weekend.
    expect(options.TTL).toBe(24 * 60 * 60);
  });
});

describe('subscriptions that have gone away', () => {
  /** A service that rejects one endpoint with the given status. */
  const rejectingService = (badEndpoint, statusCode) => ({
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn((subscription) => {
      if (subscription.endpoint === badEndpoint) {
        const err = new Error('push service says no');
        err.statusCode = statusCode;
        return Promise.reject(err);
      }
      return Promise.resolve({ statusCode: 201 });
    }),
  });

  it.each([404, 410])('deletes a subscription the push service reports gone (%i)', async (status) => {
    const { push } = loadPush(KEYS, rejectingService('https://push.example.test/2', status));
    const prisma = fakePrisma([sub(1), sub(2)]);

    const result = await push.sendPushToUser(prisma, 'u', { type: 'X', title: 'T' });

    expect(result).toMatchObject({ sent: 1, pruned: 1, failed: 0 });
    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['sub-2'] } } });
  });

  it('keeps a subscription that merely failed, so a bad minute is not permanent silence', async () => {
    const { push } = loadPush(KEYS, rejectingService('https://push.example.test/2', 503));
    const prisma = fakePrisma([sub(1), sub(2)]);

    const result = await push.sendPushToUser(prisma, 'u', { type: 'X', title: 'T' });

    expect(result).toMatchObject({ sent: 1, failed: 1, pruned: 0 });
    expect(prisma.pushSubscription.deleteMany).not.toHaveBeenCalled();
  });

  it('a rate-limited send is a failure, never a deletion', async () => {
    const { push } = loadPush(KEYS, rejectingService('https://push.example.test/1', 429));
    const prisma = fakePrisma([sub(1)]);
    const result = await push.sendPushToUser(prisma, 'u', { type: 'X', title: 'T' });
    expect(result.pruned).toBe(0);
    expect(prisma.pushSubscription.deleteMany).not.toHaveBeenCalled();
  });

  it('marks the devices that did accept, so dormant ones are identifiable later', async () => {
    const { push } = loadPush(KEYS);
    const prisma = fakePrisma([sub(1), sub(2)]);
    await push.sendPushToUser(prisma, 'u', { type: 'X', title: 'T' });
    expect(prisma.pushSubscription.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['sub-1', 'sub-2'] } },
      data: { lastSeenAt: expect.any(Date) },
    });
  });
});

describe('never breaks the flow that triggered it', () => {
  it('survives the subscription lookup failing', async () => {
    const { push } = loadPush(KEYS);
    const prisma = fakePrisma([]);
    prisma.pushSubscription.findMany = vi.fn().mockRejectedValue(new Error('db down'));

    await expect(push.sendPushToUser(prisma, 'u', { type: 'X', title: 'T' }))
      .resolves.toEqual({ sent: 0, failed: 0, pruned: 0 });
  });

  it('survives every single send rejecting', async () => {
    const { push } = loadPush(KEYS, {
      setVapidDetails: vi.fn(),
      sendNotification: vi.fn().mockRejectedValue(new Error('network gone')),
    });
    const result = await push.sendPushToUser(fakePrisma([sub(1), sub(2)]), 'u', { type: 'X', title: 'T' });
    expect(result).toMatchObject({ sent: 0, failed: 2 });
  });

  it('exposes in-flight sends so they can be awaited despite not being awaited inline', async () => {
    const { push } = loadPush(KEYS);
    let settle;
    const gate = new Promise((resolve) => { settle = resolve; });

    const tracked = push.trackPush(gate);
    let flushed = false;
    push.flushPushes().then(() => { flushed = true; });

    expect(flushed).toBe(false);
    settle();
    await tracked;
    await push.flushPushes();
    expect(flushed).toBe(true);
  });

  it('a tracked send that rejects does not become an unhandled rejection', async () => {
    const { push } = loadPush(KEYS);
    await expect(push.trackPush(Promise.reject(new Error('boom')))).resolves.toBeUndefined();
  });
});

describe('the service worker can receive what the server sends', () => {
  const sw = () => readFileSync(join(ROOT, 'public', 'sw.js'), 'utf8');

  it('handles the push event', () => {
    expect(sw()).toMatch(/addEventListener\(\s*'push'/);
  });

  it('always shows a notification, inside waitUntil', () => {
    const src = sw();
    // Chrome revokes push permission from a site that receives pushes without
    // showing anything, and a showNotification outside waitUntil can be killed
    // before it resolves — both end as "push stopped working" with no error.
    expect(src).toMatch(/event\.waitUntil\(self\.registration\.showNotification\(/);
  });

  it('handles a notification being opened', () => {
    expect(sw()).toMatch(/addEventListener\(\s*'notificationclick'/);
  });

  it('focuses an existing window rather than always opening a second copy', () => {
    const src = sw();
    expect(src).toMatch(/clients\.matchAll\(/);
    expect(src).toMatch(/client\.focus\(\)/);
  });

  it('was version-bumped, so installed phones actually activate the push handler', () => {
    // A device still running the previous worker receives nothing and gives no
    // sign why, so shipping push without a bump ships it to nobody.
    expect(sw()).toMatch(/const VERSION = 'v([7-9]|\d\d)'/);
  });

  it('still refuses to cache the API', () => {
    // The rule the whole worker is built around. Restated here because this
    // file is now edited for reasons unrelated to caching.
    expect(sw()).toMatch(/pathname\.startsWith\('\/api\/'\)/);
  });
});

describe('the server wires push into the notifications it already records', () => {
  const server = () => readFileSync(join(ROOT, 'server', 'server.js'), 'utf8');

  it('fans out from createNotification', () => {
    expect(server()).toMatch(/trackPush\(sendPushToUser\(prisma, userId,/);
  });

  it('does not await delivery in the request path', () => {
    const src = server();
    // Releasing a class of forty fans out to every device each of them owns.
    // Awaiting that would put the whole round trip inside the teacher's click.
    expect(src).not.toMatch(/await\s+sendPushToUser\(/);
  });

  it('does not buzz a phone about a notification it failed to save', () => {
    const src = server();
    const fn = src.slice(src.indexOf('async function createNotification'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    // The catch must bail out before the fan-out: a push whose notification row
    // is missing links to a bell that will never show it.
    expect(body.indexOf('return;')).toBeLessThan(body.indexOf('trackPush('));
  });

  it('serves the public key and an honest enabled flag', () => {
    const src = server();
    expect(src).toMatch(/app\.get\('\/api\/push\/public-key'/);
    expect(src).toMatch(/enabled: isPushConfigured\(\)/);
  });

  it('scopes every push route to the caller, never to an id from the request', () => {
    const src = server();
    const section = src.slice(src.indexOf("app.get('/api/push/public-key'"), src.indexOf('// STUDENT ROUTES'));

    // subscribe writes the caller's own id; unsubscribe matches on it.
    expect(section).toMatch(/userId: req\.auth\.sub/);
    expect(section).toMatch(/deleteMany\(\{ where: \{ endpoint, userId: req\.auth\.sub \} \}\)/);
    // Nothing in here may take a user id from the URL or the body.
    expect(section).not.toMatch(/req\.params\.userId|req\.body\.userId/);
  });

  it('upserts on endpoint so one device cannot collect duplicate rows', () => {
    const src = server();
    expect(src).toMatch(/prisma\.pushSubscription\.upsert\(\{\s*\n\s*where: \{ endpoint \}/);
  });

  it('reassigns an endpoint to whoever subscribed last, for shared classroom devices', () => {
    const src = server();
    const upsert = src.slice(src.indexOf('prisma.pushSubscription.upsert'));
    const update = upsert.slice(upsert.indexOf('update:'), upsert.indexOf('});'));
    // Without userId in the update branch, the next teacher to sign in on the
    // lab machine keeps receiving the previous teacher's notifications.
    expect(update).toMatch(/userId: req\.auth\.sub/);
  });

  it('refuses a subscription that is not a real https endpoint', () => {
    expect(server()).toMatch(/\/\^https:\\\/\\\/\/\.test\(endpoint\)/);
  });
});
