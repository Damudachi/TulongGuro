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
    return JSON.parse(localStorage.getItem('user') || '{}') || {};
  } catch {
    return {};
  }
}

/** Where each role belongs when it finds itself somewhere it does not. */
const HOME_FOR = {
  ADMIN: '/admin/teachers',
  TEACHER: '/teacher/dashboard',
  STUDENT: '/student/dashboard',
};

/**
 * What this browser is actually holding.
 *
 * The token is what authenticates, so it is what decides — a user blob on its
 * own is not a session. Both have to be there, because a page restored from
 * the browser's cache can hold one without the other.
 */
export function sessionFor() {
  const token = localStorage.getItem('tg_token');
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
