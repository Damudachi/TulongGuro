import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sessionFor, guardVerdict, resumeTo } from '../../src/utils/session.js';

/**
 * Who is allowed to render a role's screens.
 *
 * The app had no client-side guard at all. `<Route path="/teacher"
 * element={<TeacherLayout />}>` rendered for anyone who reached the URL, and
 * being signed out was enforced only as a side effect: a page would call the
 * API, get a 401, and apiFetch would redirect to /login.
 *
 * That holds right up until no call is made. Sign out, press the browser's
 * forward button, and the dashboard renders again — the layout reads a now
 * empty `user` from localStorage, every `if (user.id)` guard declines to fetch
 * anything, so no 401 ever arrives and nothing sends you back. The screen is a
 * shell with no data, but to the person at the keyboard it is indistinguishable
 * from being signed in, and on a shared staff-room machine that is the whole
 * problem. Found by hand, doing exactly that.
 *
 * The rule is pure so it can be tested without a DOM: the component that uses
 * it is three lines and has nothing to get wrong.
 */

const set = (key, value) => globalThis.localStorage.setItem(key, value);

beforeEach(() => {
  // A minimal localStorage. The real one is a browser API; the rule only ever
  // reads two keys from it.
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
});

afterEach(() => { delete globalThis.localStorage; });

const signedInAs = (role, id = 'user-1') => {
  set('tg_token', 'a.signed.token');
  set('user', JSON.stringify({ id, role }));
};

describe('sessionFor reports what the browser is actually holding', () => {
  it('is not signed in when there is nothing stored', () => {
    expect(sessionFor()).toEqual({ signedIn: false, role: null, id: null });
  });

  it('is not signed in with a user blob but no token', () => {
    // This is the state logout leaves behind if the user record is restored
    // from a cached page. The token is what authenticates, so it decides.
    set('user', JSON.stringify({ id: 'user-1', role: 'TEACHER' }));
    expect(sessionFor().signedIn).toBe(false);
  });

  it('is not signed in with a token but no user', () => {
    set('tg_token', 'a.signed.token');
    expect(sessionFor().signedIn).toBe(false);
  });

  it('survives a corrupt user blob without throwing', () => {
    set('tg_token', 'a.signed.token');
    set('user', '{not json');
    expect(sessionFor().signedIn).toBe(false);
  });

  it('reports the role and id when both are present', () => {
    signedInAs('ADMIN', 'admin-7');
    expect(sessionFor()).toEqual({ signedIn: true, role: 'ADMIN', id: 'admin-7' });
  });
});

describe('guardVerdict decides what a role area should do', () => {
  it('sends a signed-out visitor to the login page', () => {
    expect(guardVerdict('TEACHER')).toEqual({ allow: false, to: '/login' });
  });

  it('lets the matching role through', () => {
    signedInAs('TEACHER');
    expect(guardVerdict('TEACHER')).toEqual({ allow: true });
  });

  it('sends a signed-in student away from the teacher area', () => {
    // Not to /login — they are signed in, and bouncing them to a login they
    // can already pass explains nothing. Their own dashboard is the answer,
    // and it is the same reasoning apiFetch uses to leave a 403 alone.
    signedInAs('STUDENT');
    expect(guardVerdict('TEACHER')).toEqual({ allow: false, to: '/student/dashboard' });
  });

  it('sends a signed-in teacher away from the admin area', () => {
    signedInAs('TEACHER');
    expect(guardVerdict('ADMIN')).toEqual({ allow: false, to: '/teacher/dashboard' });
  });

  it('sends a signed-in admin away from the student area', () => {
    signedInAs('ADMIN');
    expect(guardVerdict('STUDENT')).toEqual({ allow: false, to: '/admin/dashboard' });
  });

  it('treats an unrecognised stored role as signed out', () => {
    // A blob from an older version, or one edited by hand. There is no home
    // to send them to, so the only safe answer is the login page.
    set('tg_token', 'a.signed.token');
    set('user', JSON.stringify({ id: 'x', role: 'SUPERUSER' }));
    expect(guardVerdict('TEACHER')).toEqual({ allow: false, to: '/login' });
  });
});

/**
 * The other half of the guard, and the one that was missing.
 *
 * guardVerdict answers "may this session be here?" for the role areas. Nothing
 * answered the entry question — "there is a session, why are we showing the
 * front door?" — so the public pages showed a log-in form to someone already
 * holding a valid week-long token. In a browser tab that is invisible, because
 * people return to a bookmarked /teacher/dashboard. An installed PWA always
 * cold-starts at the manifest's start_url, which is '/', so every single launch
 * landed on the marketing page whose only way in is the log-in form. Reported
 * as "I still need to log in every time", and that is exactly what it was.
 */
describe('resumeTo decides whether a public page should step aside', () => {
  it('renders the public page when there is no session', () => {
    expect(resumeTo()).toBe(null);
  });

  it('sends a signed-in teacher to their dashboard', () => {
    signedInAs('TEACHER');
    expect(resumeTo()).toBe('/teacher/dashboard');
  });

  it('sends a signed-in student to their dashboard', () => {
    signedInAs('STUDENT');
    expect(resumeTo()).toBe('/student/dashboard');
  });

  it('sends a signed-in admin to their own home', () => {
    signedInAs('ADMIN');
    expect(resumeTo()).toBe('/admin/dashboard');
  });

  it('renders the public page when the token is gone but the user blob is not', () => {
    // Half a session is not a session — the same rule sessionFor already
    // applies. Redirecting on the blob alone would bounce a signed-out user
    // into a dashboard that immediately 401s back to /login.
    set('user', JSON.stringify({ id: 'user-1', role: 'TEACHER' }));
    expect(resumeTo()).toBe(null);
  });

  it('renders the public page for an unrecognised stored role', () => {
    // There is nowhere to send them, and the log-in form is the way out.
    set('tg_token', 'a.signed.token');
    set('user', JSON.stringify({ id: 'x', role: 'SUPERUSER' }));
    expect(resumeTo()).toBe(null);
  });
});
