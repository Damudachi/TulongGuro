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
