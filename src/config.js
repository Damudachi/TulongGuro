// Centralized API URL — reads from environment variable in production,
// falls back to localhost for local development.
// In Vercel, set VITE_API_URL to your Render.com backend URL.
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/**
 * Pages accepted for one student's submission. Must match MAX_SUBMISSION_PAGES
 * on the server, which is what actually enforces it — this copy only stops the
 * UI from letting a teacher stage pages that would be refused on arrival.
 *
 * 12 because the pages are stitched into one image before the AI sees them, and
 * the model rejects an image past roughly 62 megapixels — about 12 pages of a
 * phone photo once the pipeline has capped it at 1920px wide.
 */
export const MAX_SUBMISSION_PAGES = 12;

import { readToken, storeSession, clearStoredSession, renewStoredToken } from './utils/session';
import { refreshThemeForSession, configureThemePersistence } from './utils/theme';

export const getToken = () => readToken();

/**
 * Called on login. The token, not the user id, is what authenticates calls.
 *
 * `remember` decides whether the session outlives the app being closed — see
 * utils/session.js. Omitting it keeps an existing session where it already is,
 * which is what the password-change screens want.
 */
/**
 * How a theme choice reaches the server. Installed here rather than imported by
 * theme.js, which would make this module and that one import each other — and
 * routed through apiFetch so it carries the session token like every other call.
 */
configureThemePersistence((userId, themePreference) =>
  apiFetch(`${API_URL}/api/users/${userId}/theme`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ themePreference }),
  }).catch(() => {}));

export const setSession = (user, token, options) => {
  storeSession(user, token, options);
  // The theme belongs to the account, so signing in has to switch to that
  // account's. `user.themePreference` is what their User row says and comes
  // back on the login response; it wins over anything cached on this device,
  // which is how the choice follows someone to a machine they have never used.
  refreshThemeForSession(user?.themePreference ?? null);
};

export const clearSession = () => {
  clearStoredSession();
  // Back to the guest slot. Without this, signing out of a dark account leaves
  // the login screen dark for whoever sits down next — the same leak across
  // accounts that made the preference per-account in the first place, just
  // pointed at the front door.
  refreshThemeForSession();
};

/**
 * Sign out: locally first, then everywhere.
 *
 * The order is the entire point, and it used to be the other way round. This
 * awaited the server before touching localStorage, so between tapping Sign Out
 * and the API answering, the token was still sitting in this browser. On a cold
 * Render instance that is tens of seconds — and anything that ended the page in
 * that window took the pending `clearSession()` with it, because a promise
 * continuation does not survive a navigation. Sign out, paste
 * /teacher/dashboard into the address bar, and the guard found a valid session
 * and let you back in. Reported exactly that way, from production.
 *
 * `keepalive` was already here for that reason and only ever covered half of
 * it: it keeps the *request* alive across an unload, not the JavaScript waiting
 * on it. Clearing first needs no promise to survive at all.
 *
 * The server call still matters and still goes out — a token that has been
 * copied elsewhere stays valid until it expires, and /api/auth/logout ends
 * every session for the account. It is simply no longer what the local sign-out
 * waits on. Callers may still await this to know the revoke landed.
 */
export const logout = async () => {
  const token = getToken();
  clearSession();
  if (!token) return;
  try {
    await fetch(`${API_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      keepalive: true,   // survives the navigation that follows
    });
  } catch { /* offline, or the token was already dead — this browser is signed out either way */ }
};

/**
 * fetch, with the session token attached.
 *
 * Every call to our API goes through here. The server no longer takes the
 * caller's identity from the URL — an id in a path is checked against the
 * signed token now, so a request without one is refused.
 *
 * A 401 means the session is gone or expired: clear it and send them to the
 * login screen, once. A 403 is deliberately left alone — the caller is signed
 * in and simply may not do that, and bouncing them to a login they can already
 * pass would lose whatever they were working on and explain nothing.
 */
let redirecting = false;
export async function apiFetch(input, init = {}) {
  const token = getToken();
  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(input, { ...init, headers });

  // ── The sliding session ──
  // Sessions lapse after a week of not being used, but renew while they are.
  // The server reissues a token once the current one is past halfway through
  // its life and returns it here; swapping it in is the whole client side of
  // it, and it happens on whichever call the user happened to trigger. So a
  // teacher who opens the app at least weekly is never asked to sign in
  // again, and one who leaves it for eight days is asked once.
  //
  // Reading this header at all depends on the API listing it in the CORS
  // exposedHeaders — the two are a pair, and neither works alone.
  // Kept in whichever store the session is already in, so a renewal never
  // promotes a "just this once" sign-in into a remembered one — and never
  // resurrects a session that was signed out while this call was in flight.
  const renewed = res.headers.get('X-Renewed-Token');
  if (renewed) renewStoredToken(renewed);

  // The operator approvals and developer metrics pages authenticate with a
  // shared key, not a user session, so a 401 there means "wrong key" — not
  // "your session ended". Treating it as the latter signed the operator out
  // of an unrelated admin account in the same browser and bounced them to
  // /login, where the page's own "that key was wrong" handling never got to
  // run.
  const isKeyGatedCall = String(input).includes('/api/platform/') || String(input).includes('/api/dev/');

  if (res.status === 401 && !isKeyGatedCall) {
    clearSession();
    if (!redirecting && !window.location.pathname.startsWith('/login')) {
      redirecting = true;
      window.location.assign('/login?expired=1');
    }
  }
  return res;
}
