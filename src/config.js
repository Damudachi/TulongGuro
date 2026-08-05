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

const TOKEN_KEY = 'tg_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);

/** Called on login. The token, not the user id, is what authenticates calls. */
export const setSession = (user, token) => {
  localStorage.setItem('user', JSON.stringify(user));
  if (token) localStorage.setItem(TOKEN_KEY, token);
};

export const clearSession = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem('user');
};

/**
 * Sign out everywhere, then locally.
 *
 * Dropping the token from this browser is enough for the person at the
 * keyboard, but a token that has been copied elsewhere stays valid until it
 * expires. Telling the server first ends every session for this account, which
 * is what signing out of a shared classroom machine has to mean.
 *
 * The local clear happens regardless — if the network call fails, the user
 * still gets signed out of this browser rather than being stuck.
 */
export const logout = async () => {
  const token = getToken();
  if (token) {
    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        keepalive: true,   // survives the navigation that follows
      });
    } catch { /* offline, or the token was already dead — clear locally anyway */ }
  }
  clearSession();
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

  // The operator approvals page authenticates with PLATFORM_ADMIN_KEY, not a
  // user session, so a 401 there means "wrong key" — not "your session ended".
  // Treating it as the latter signed the operator out of an unrelated admin
  // account in the same browser and bounced them to /login, where the page's
  // own "that key was wrong" handling never got to run.
  const isPlatformCall = String(input).includes('/api/platform/');

  if (res.status === 401 && !isPlatformCall) {
    clearSession();
    if (!redirecting && !window.location.pathname.startsWith('/login')) {
      redirecting = true;
      window.location.assign('/login?expired=1');
    }
  }
  return res;
}
