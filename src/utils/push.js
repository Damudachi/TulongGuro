/**
 * push.js — turning the in-app bell into something a closed phone can show.
 *
 * NotificationBell polls every 60 seconds, which reaches exactly the people who
 * are already looking at it. A released grade is the opposite case: it happens
 * while the app is shut. This module is the browser half of server/push.js —
 * it asks for permission, hands the resulting subscription to our own server,
 * and can take it back.
 *
 * The transport is Web Push with VAPID: no Firebase, no SDK, no account, and
 * the payload is encrypted to keys this browser generated, so the push service
 * relaying it (Google's, Mozilla's, Apple's) cannot read a child's grade out of
 * it. The same code path serves the browser, the installed PWA, and the Android
 * APK — the APK is a Trusted Web Activity running Chrome's engine, so it
 * registers this very service worker and receives these very pushes.
 */
import { API_URL, apiFetch } from '../config';

/**
 * VAPID keys travel as base64url and PushManager wants raw bytes.
 *
 * The padding matters: base64url strips '=' and atob refuses a string whose
 * length is not a multiple of four, so a key that happened to need padding
 * would throw here and nowhere else — an intermittent-looking failure that is
 * actually deterministic per key.
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * Whether this browser can do push at all.
 *
 * All three checks are needed and they fail in different places: desktop Safari
 * has Notification without PushManager, and iOS Safari has both but only once
 * the app has been added to the Home Screen — in a plain tab the subscribe call
 * rejects rather than the API being absent.
 */
export const pushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

/** The browser's own answer: 'granted' | 'denied' | 'default'. */
export const permissionState = () => (pushSupported() ? Notification.permission : 'denied');

/**
 * Ask the server whether push is switched on for this deployment, and for the
 * key to subscribe with.
 *
 * Fetched rather than bundled because the keypair belongs to the running
 * backend, not to the build: Vercel serves one dist/ to the browser and to the
 * APK, and requiring a frontend redeploy every time the backend's keys change
 * would couple two things that have no reason to be coupled. It also gives an
 * honest `enabled: false` on a deployment with no keys set, which is what lets
 * the UI hide the switch instead of offering one that cannot work.
 */
export async function fetchPushConfig() {
  try {
    const res = await apiFetch(`${API_URL}/api/push/public-key`);
    const data = await res.json();
    if (!data?.success || !data.enabled || !data.publicKey) return null;
    return data.publicKey;
  } catch {
    return null;
  }
}

/** The live subscription for this browser, or null. */
async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

/** Whether this browser is already registered for notifications. */
export async function isPushEnabled() {
  if (permissionState() !== 'granted') return false;
  return Boolean(await currentSubscription());
}

/**
 * Turn notifications on for this browser.
 *
 * MUST be called from a click. Chrome and Safari both refuse
 * requestPermission() outside a user gesture, and Chrome additionally holds a
 * grudge: a site that prompts without one can have the prompt suppressed for
 * good. That is why there is a button for this and not an effect.
 *
 * Returns { ok, reason } rather than throwing, because every failure here is
 * something the user needs a sentence about — "you blocked it", "this browser
 * can't", "add it to your Home Screen first" — and an exception would flatten
 * those into one catch.
 */
export async function enablePush() {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };

  const publicKey = await fetchPushConfig();
  if (!publicKey) return { ok: false, reason: 'unavailable' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: permission === 'denied' ? 'denied' : 'dismissed' };

  // `ready` rather than getRegistration(): on a first visit the worker may still
  // be installing, and subscribing against a registration that has no active
  // worker fails. registerSW.js has already kicked it off by the time any of
  // this is reachable.
  const reg = await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();

  // An existing subscription signed with a *different* server key is worse than
  // none: the push service will accept our sends and the browser will silently
  // discard every one, because it cannot verify them. That happens whenever the
  // backend's VAPID keypair is rotated, and it looks exactly like "push is
  // broken for some users and nobody knows why". So compare and re-subscribe.
  if (sub) {
    const existing = sub.options?.applicationServerKey;
    const wanted = urlBase64ToUint8Array(publicKey);
    const matches =
      existing &&
      new Uint8Array(existing).length === wanted.length &&
      new Uint8Array(existing).every((b, i) => b === wanted[i]);
    if (!matches) {
      await sub.unsubscribe().catch(() => {});
      sub = null;
    }
  }

  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        // Non-negotiable on Chrome: a subscription that is allowed to deliver
        // without showing anything is a background channel, and Chrome will not
        // issue one.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    } catch {
      return { ok: false, reason: 'failed' };
    }
  }

  const json = sub.toJSON();
  try {
    const res = await apiFetch(`${API_URL}/api/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
    });
    const data = await res.json();
    if (!data?.success) throw new Error('rejected');
  } catch {
    // The browser now holds a subscription the server does not know about,
    // which would leave the toggle reading "on" while nothing is ever
    // delivered. Roll it back so the state the user sees is the true one.
    await sub.unsubscribe().catch(() => {});
    return { ok: false, reason: 'failed' };
  }

  return { ok: true };
}

/**
 * Turn notifications off for this browser.
 *
 * The server is told first. If the order were reversed, a failed API call after
 * a successful local unsubscribe would strand a row that can never be matched
 * again — the endpoint is gone from this browser, so nothing would ever clean
 * it up, and the user's phone would keep receiving until the push service
 * eventually returned 410.
 */
export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return { ok: true };

  const { endpoint } = sub.toJSON();
  await apiFetch(`${API_URL}/api/push/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});

  await sub.unsubscribe().catch(() => {});
  return { ok: true };
}
