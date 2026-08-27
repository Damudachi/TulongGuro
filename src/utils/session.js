/**
 * ── Where a session is kept ──
 *
 * Two stores, and which one holds the token is the whole of "keep me signed in".
 *
 * localStorage outlives the app being closed. sessionStorage does not: the
 * browser drops it when the tab goes, and an installed PWA closing counts as
 * the tab going. So a token in localStorage is a session that survives to the
 * next launch, and a token in sessionStorage is one that ends when the person
 * walks away from the device — which is the right default in a classroom where
 * one phone is passed along a row.
 *
 * Only the *token* moves. The user blob stays in localStorage always, because
 * forty-odd screens read it inline with their own
 * `JSON.parse(localStorage.getItem('user'))` and a leftover blob authenticates
 * nothing: the token is what the server checks, sessionFor refuses to call it a
 * session without one, and the guard refuses to render without sessionFor. What
 * is left behind is a name and an id belonging to someone who was here — worth
 * knowing, not worth a forty-file refactor to hide.
 *
 * Every access is wrapped: storage throws outright in some in-app browsers and
 * in Safari's private mode, and a sign-in that explodes on a quota error rather
 * than simply not persisting would be a worse bug than the one this fixes.
 */

import { clearActivitySnapshots } from './offlineSnapshot';

const TOKEN_KEY = 'tg_token';
const USER_KEY = 'user';

const localStore = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const sessionStore = () => { try { return globalThis.sessionStorage ?? null; } catch { return null; } };

const read = (store, key) => { try { return store?.getItem(key) ?? null; } catch { return null; } };
const write = (store, key, value) => { try { store?.setItem(key, value); } catch { /* blocked or full */ } };
const drop = (store, key) => { try { store?.removeItem(key); } catch { /* blocked */ } };

/**
 * Which store currently holds the token, or null when nobody is signed in.
 *
 * sessionStorage is asked first so a "just this once" sign-in always wins over
 * a remembered token that a previous user left on a shared device.
 */
function tokenStore() {
  if (read(sessionStore(), TOKEN_KEY)) return 'session';
  if (read(localStore(), TOKEN_KEY)) return 'local';
  return null;
}

/** The session token, wherever it was put. */
export function readToken() {
  return read(sessionStore(), TOKEN_KEY) ?? read(localStore(), TOKEN_KEY);
}

/**
 * Record a sign-in.
 *
 * `remember` left undefined means "leave it where it already is" rather than
 * "no": the settings screens re-issue a token after a password change, and
 * defaulting those to a one-off session would quietly sign a remembered user
 * out at their next launch as a side effect of changing their password.
 */
export function storeSession(user, token, { remember } = {}) {
  write(localStore(), USER_KEY, JSON.stringify(user));
  if (!token) return;
  const kind = remember === undefined
    ? (tokenStore() ?? 'local')
    : (remember ? 'local' : 'session');
  // Cleared from both first: the token must exist in exactly one place, or
  // tokenStore() starts answering with a stale one.
  drop(localStore(), TOKEN_KEY);
  drop(sessionStore(), TOKEN_KEY);
  write(kind === 'local' ? localStore() : sessionStore(), TOKEN_KEY, token);
}

/**
 * Forget everything, in both stores — including the offline activity list, so
 * the next person to open a shared phone finds nothing of the last one's.
 *
 * Not the upload queue. Work saved offline belongs to the student who made it
 * rather than to the session, and dropping it here would silently destroy an
 * essay that was never sent. See clearActivitySnapshots().
 */
export function clearStoredSession() {
  for (const store of [localStore(), sessionStore()]) {
    drop(store, TOKEN_KEY);
    drop(store, USER_KEY);
  }
  clearActivitySnapshots();
}

/**
 * Swap in a token the server reissued mid-session, keeping it in the store it
 * was already in — a renewal must not promote a one-off session into a
 * remembered one.
 *
 * A renewal with no session to renew is dropped. The header can only arrive on
 * an authenticated response, so this means the session was cleared while the
 * request was in flight — signing out during a slow call is exactly that — and
 * writing the token back would undo the sign-out.
 */
export function renewStoredToken(token) {
  const kind = tokenStore();
  if (!kind || !token) return;
  write(kind === 'local' ? localStore() : sessionStore(), TOKEN_KEY, token);
}

/** Whether this session is set to survive the app being closed. */
export function isRemembered() {
  return tokenStore() === 'local';
}

/**
 * The signed-in user, as the app has always stored it: a JSON blob in
 * localStorage written at login.
 *
 * Every page read it inline with its own `JSON.parse(localStorage.getItem(...)
 * || '{}')`, which is fine until a page needs the answer *before* its first
 * render — to decide whether it is going to load anything at all. Doing that
 * from inside an effect means rendering a spinner first and then synchronously
 * setting state to take it away, so this is here to be callable from a
 * useState initialiser instead.
 *
 * Returns `{}` rather than null when there is no user or the blob is corrupt,
 * so `getStoredUser().id` is always safe to reach for.
 */
export function getStoredUser() {
  try {
    return JSON.parse(read(localStore(), USER_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

/** The event `updateStoredUser` fires. Subscribe to re-read the blob. */
export const USER_UPDATED_EVENT = 'tg-user-updated';

/**
 * Patch fields on the stored user blob, leaving the token alone.
 *
 * The blob is read inline by forty-odd screens, so a value that changes after
 * login — a name the admin just edited — has to be written back here or those
 * screens keep showing the value from sign-in until the next one.
 *
 * Fires `tg-user-updated` afterwards. A component that read the blob during
 * its own render has no way to learn it moved: nothing it subscribes to
 * changed, and the browser's own `storage` event only fires in *other* tabs.
 * Listeners of this event re-read and re-render in the tab that made the edit.
 */
export function updateStoredUser(patch) {
  const next = { ...getStoredUser(), ...patch };
  write(localStore(), USER_KEY, JSON.stringify(next));
  try { globalThis.dispatchEvent?.(new Event(USER_UPDATED_EVENT)); } catch { /* no DOM, e.g. under test */ }
  return next;
}

/** Where each role belongs when it finds itself somewhere it does not. */
const HOME_FOR = {
  ADMIN: '/admin/dashboard',
  TEACHER: '/teacher/dashboard',
  STUDENT: '/student/dashboard',
};

/**
 * What this browser is actually holding.
 *
 * The token is what authenticates, so it is what decides — a user blob on its
 * own is not a session. Both have to be there, because a page restored from
 * the browser's cache can hold one without the other, and because a one-off
 * session ending leaves the blob behind by design.
 */
export function sessionFor() {
  const token = readToken();
  const user = getStoredUser();
  if (!token || !user.id) return { signedIn: false, role: null, id: null };
  return { signedIn: true, role: user.role ?? null, id: user.id };
}

/**
 * Whether a role's screens may render, and where to go instead.
 *
 * This existed nowhere. Every role area rendered for anyone who reached the
 * URL, and being signed out was caught only when a page happened to call the
 * API and got a 401 back. Sign out and press the browser's forward button and
 * nothing calls anything — each page skips its fetch because there is no user
 * id — so no 401 arrives and the dashboard sits there looking signed in.
 *
 * A signed-in caller in the wrong area is sent to their own home rather than
 * to /login: they are authenticated, and offering a login they can already
 * pass explains nothing and loses whatever they were doing. Same reasoning
 * apiFetch uses when it deliberately leaves a 403 alone.
 */
export function guardVerdict(requiredRole) {
  const { signedIn, role } = sessionFor();
  if (!signedIn) return { allow: false, to: '/login' };
  if (role === requiredRole) return { allow: true };
  return { allow: false, to: HOME_FOR[role] ?? '/login' };
}

/**
 * Where a public entry page should send someone who is already signed in, or
 * null to render itself as normal.
 *
 * The entry half of the guard, and it was missing entirely. Sessions last a
 * week and renew while in use, but nothing ever *resumed* one: the landing page
 * rendered its marketing copy regardless of what was in storage, so the only
 * route back into the app was typing a password — which then overwrote the
 * perfectly good token that had been sitting there the whole time.
 *
 * In a browser tab that hid, because people return to a bookmarked
 * /teacher/dashboard and the guard waves them through. An installed PWA has no
 * address bar and no bookmarks: every cold launch opens the manifest's
 * start_url, which is '/', so every launch met the front door. Reported as
 * "I still need to log in every time", and that is precisely what it was.
 *
 * An unrecognised role returns null rather than guessing a home — the same
 * reading guardVerdict takes, and the log-in form is the way out of a stale
 * blob.
 */
export function resumeTo() {
  const { signedIn, role } = sessionFor();
  if (!signedIn) return null;
  return HOME_FOR[role] ?? null;
}
