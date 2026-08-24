/**
 * push.js — Web Push delivery for the notifications the app already records.
 *
 * ── Why this exists ──
 * NotificationBell polls /api/notifications every 60 seconds, which means a
 * notification can only reach someone who already has the app open and is
 * looking at it. The event this system most needs to announce — a grade being
 * released — happens hours after the student closed the app. Before this, they
 * found out by chance.
 *
 * ── Why Web Push and not FCM ──
 * VAPID is self-hosted: a keypair generated once with `npx web-push
 * generate-vapid-keys`, no account, no SDK, no vendor project, no bill, and
 * nothing to keep paying for. The browser's own push service (Google's for
 * Chrome, Mozilla's for Firefox, Apple's for Safari) does the delivery, and
 * because the payload is encrypted to keys the *browser* generated, that
 * service relays ciphertext it cannot read. For a school system holding
 * children's grades that property is worth more than the convenience of an SDK.
 *
 * It also means one implementation covers every surface this project ships:
 * the browser, the installed PWA, and the Android APK — the APK is a Trusted
 * Web Activity, so it runs Chrome's engine and receives these exact pushes.
 * The alternative (Capacitor + FCM) would have needed a second delivery path,
 * a Firebase project, and a native build to test.
 *
 * ── Never breaks the flow ──
 * Same contract as createNotification and logGradingEvent: a push that fails
 * is logged and dropped. Releasing a class's grades must not fail because a
 * push service returned 503.
 */
const webpush = require('web-push');

const PUBLIC_KEY = (process.env.VAPID_PUBLIC_KEY || '').trim();
const PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || '').trim();

/**
 * Who the push service should complain to about us. It must be a mailto: or
 * https: URL — push services reject a bare string, and Apple's in particular
 * refuses a subject it cannot route. Defaulted rather than required so a
 * deployment that sets only the two keys still works.
 */
const SUBJECT = (process.env.VAPID_SUBJECT || '').trim() || 'mailto:carepanionph@gmail.com';

/**
 * Push is optional. Without keys the app behaves exactly as it did before this
 * file existed: the bell still polls, notifications still land in the table,
 * nothing is sent, and nothing anywhere has to branch on it. That is what makes
 * this safe to merge before the keys are set on Render, and what keeps the test
 * suite from needing a push service.
 */
const configured = Boolean(PUBLIC_KEY && PRIVATE_KEY);

if (configured) {
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
} else if (process.env.NODE_ENV !== 'test') {
  console.log('ℹ Web Push disabled — VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set. In-app notifications still work.');
}

const isPushConfigured = () => configured;
const getPublicKey = () => (configured ? PUBLIC_KEY : null);

/**
 * How long the push service should hold a message for a phone that is off or
 * out of signal. A day: a grade released Friday afternoon is still worth
 * showing when the phone comes back on Saturday, and a week-old one has been
 * overtaken by the student simply opening the app.
 */
const TTL_SECONDS = 24 * 60 * 60;

/**
 * Status codes that mean "this subscription is dead, stop keeping it".
 *
 * 404/410 is the push service telling us the browser has thrown the
 * subscription away — the user cleared site data, uninstalled the PWA, or the
 * browser rotated it. These accumulate quietly, and every stale row is one more
 * pointless HTTPS round trip on every future notification, so they are deleted
 * on sight rather than swept later.
 */
const DEAD_STATUS = new Set([404, 410]);

/** Web Push caps the encrypted payload at 4KB; bodies are trimmed well under
 *  that so a long AI feedback excerpt can never silently fail the send. */
const MAX_BODY = 300;
const MAX_TITLE = 120;

const clip = (text, max) => {
  if (typeof text !== 'string') return undefined;
  const t = text.trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/**
 * Deliver one notification to every device a user has registered.
 *
 * `prisma` is passed in rather than required at the top of this file so the
 * tests can drive it with a stub and so this module stays free of the database
 * wiring in server.js.
 *
 * Resolves to a small summary ({ sent, failed, pruned }) rather than throwing,
 * so a caller may await it for reporting but is never obliged to handle it.
 */
async function sendPushToUser(prisma, userId, { type, title, body, link }) {
  if (!configured || !userId) return { sent: 0, failed: 0, pruned: 0 };

  let subscriptions;
  try {
    subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
  } catch (err) {
    console.log(`⚠ Could not read push subscriptions for ${userId}: ${err.message?.slice(0, 100)}`);
    return { sent: 0, failed: 0, pruned: 0 };
  }
  if (!subscriptions.length) return { sent: 0, failed: 0, pruned: 0 };

  // `tag` collapses repeats on the device: a student whose six papers are
  // released together should see one line in their tray that updates, not six
  // identical rows to swipe away. Grouped by type rather than per-notification
  // so two *different* kinds of event still both show.
  const payload = JSON.stringify({
    title: clip(title, MAX_TITLE) || 'TulongGuro',
    body: clip(body, MAX_BODY),
    link: typeof link === 'string' && link.startsWith('/') ? link : '/',
    tag: `tg-${type || 'general'}`,
    type: type || 'general',
  });

  const dead = [];
  const alive = [];
  let failed = 0;

  await Promise.all(subscriptions.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: TTL_SECONDS, urgency: 'normal' },
      );
      alive.push(sub.id);
    } catch (err) {
      if (DEAD_STATUS.has(err.statusCode)) {
        dead.push(sub.id);
      } else {
        failed += 1;
        // Not pruned: a 429 or a 503 is the push service having a bad minute,
        // and deleting a working subscription over it would silence that device
        // permanently with no way for the user to know why.
        console.log(`⚠ Push send failed (${err.statusCode || 'no status'}) for ${userId}: ${String(err.message).slice(0, 100)}`);
      }
    }
  }));

  if (dead.length) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: dead } } }).catch(() => {});
  }
  if (alive.length) {
    await prisma.pushSubscription
      .updateMany({ where: { id: { in: alive } }, data: { lastSeenAt: new Date() } })
      .catch(() => {});
  }

  return { sent: alive.length, failed, pruned: dead.length };
}

/**
 * In-flight sends, so a test (or a shutdown) can wait for them.
 *
 * The request path deliberately does NOT await delivery — see the note in
 * server.js's createNotification. Releasing a class of forty means forty
 * notifications, each fanning out to every device that student owns, and making
 * a teacher's "Release all" sit through all of that before the page responds
 * would turn a fast action into a slow one for no benefit to anybody. But
 * "not awaited" and "unobservable" are different things, and an unobservable
 * promise is one a test can only sleep on and hope.
 */
const inFlight = new Set();

function trackPush(promise) {
  const p = promise.catch(() => {});
  inFlight.add(p);
  p.finally(() => inFlight.delete(p));
  return p;
}

/** Resolve once every push started so far has settled. */
const flushPushes = () => Promise.all([...inFlight]);

module.exports = {
  isPushConfigured,
  getPublicKey,
  sendPushToUser,
  trackPush,
  flushPushes,
  // Exported for the tests, which assert the trimming rules above without
  // standing up a push service.
  __test__: { clip, MAX_BODY, MAX_TITLE, TTL_SECONDS },
};
