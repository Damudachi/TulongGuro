import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  storeSession, clearStoredSession, renewStoredToken, readToken, isRemembered, sessionFor,
} from '../../src/utils/session.js';
import { logout, getToken, setSession } from '../../src/config.js';

/**
 * Staying signed in, and stopping being signed in.
 *
 * Two complaints from the same afternoon of real use, which turned out to be
 * the two ends of one thing — where the token lives and when it goes away:
 *
 *   "I still need to log in every time" (installed PWA)
 *   "when I log out but paste /teacher/dashboard I get back in" (production)
 *
 * The first is answered by keeping the token somewhere that survives the app
 * closing, but only when the person asked for that. The second is answered by
 * clearing it before the network call rather than after — see logout().
 */

const storage = () => {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
};

beforeEach(() => {
  globalThis.localStorage = storage();
  globalThis.sessionStorage = storage();
});

afterEach(() => {
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
  vi.unstubAllGlobals();
});

const USER = { id: 'teacher-1', role: 'TEACHER', name: 'Ms Reyes' };

describe('"Keep me signed in" decides which store holds the token', () => {
  it('puts a remembered token where it survives the app closing', () => {
    storeSession(USER, 'tok', { remember: true });
    expect(globalThis.localStorage.getItem('tg_token')).toBe('tok');
    expect(globalThis.sessionStorage.getItem('tg_token')).toBe(null);
    expect(isRemembered()).toBe(true);
  });

  it('puts an unremembered token where the browser drops it on close', () => {
    storeSession(USER, 'tok', { remember: false });
    expect(globalThis.sessionStorage.getItem('tg_token')).toBe('tok');
    expect(globalThis.localStorage.getItem('tg_token')).toBe(null);
    expect(isRemembered()).toBe(false);
  });

  it('signs in either way — the store is about persistence, not access', () => {
    storeSession(USER, 'tok', { remember: false });
    expect(sessionFor()).toEqual({ signedIn: true, role: 'TEACHER', id: 'teacher-1' });
  });

  it('leaves no remembered token behind when the next sign-in declines to be remembered', () => {
    // The shared-phone case: a teacher stayed signed in, a student then signs
    // in for one lesson. If the old token stayed in localStorage it would
    // outlive the student's session and be found at the next launch.
    storeSession(USER, 'teacher-token', { remember: true });
    storeSession({ id: 's-1', role: 'STUDENT' }, 'student-token', { remember: false });
    expect(globalThis.localStorage.getItem('tg_token')).toBe(null);
    expect(readToken()).toBe('student-token');
  });

  it('prefers a one-off session over a remembered token left in the other store', () => {
    // Belt and braces for the case above: even if a stale remembered token
    // survived somehow, the session in front of us wins.
    globalThis.localStorage.setItem('tg_token', 'stale-remembered');
    globalThis.sessionStorage.setItem('tg_token', 'current');
    expect(readToken()).toBe('current');
  });

  it('keeps the user blob readable by the screens that read it inline', () => {
    // Forty-odd screens do their own JSON.parse(localStorage.getItem('user')).
    // Only the token moves between stores; moving the blob would blank them.
    storeSession(USER, 'tok', { remember: false });
    expect(JSON.parse(globalThis.localStorage.getItem('user')).id).toBe('teacher-1');
  });
});

describe('a token re-issued mid-session stays where it was', () => {
  it('does not promote a one-off session into a remembered one', () => {
    // The settings screens re-issue a token after a password change and pass
    // no preference. Defaulting that to "remember" would sign someone in for a
    // week on a borrowed phone as a side effect of changing their password.
    storeSession(USER, 'tok', { remember: false });
    setSession(USER, 'new-tok');
    expect(globalThis.sessionStorage.getItem('tg_token')).toBe('new-tok');
    expect(globalThis.localStorage.getItem('tg_token')).toBe(null);
  });

  it('does not demote a remembered session either', () => {
    storeSession(USER, 'tok', { remember: true });
    setSession(USER, 'new-tok');
    expect(globalThis.localStorage.getItem('tg_token')).toBe('new-tok');
    expect(globalThis.sessionStorage.getItem('tg_token')).toBe(null);
  });

  it('keeps a server renewal in the same store', () => {
    storeSession(USER, 'tok', { remember: false });
    renewStoredToken('renewed');
    expect(globalThis.sessionStorage.getItem('tg_token')).toBe('renewed');
    expect(globalThis.localStorage.getItem('tg_token')).toBe(null);
  });

  it('ignores a renewal that arrives after the session was cleared', () => {
    // A sign-out during a slow request. The response still carries a renewal
    // header, and writing it back would undo the sign-out.
    storeSession(USER, 'tok', { remember: true });
    clearStoredSession();
    renewStoredToken('renewed');
    expect(readToken()).toBe(null);
  });
});

describe('signing out drops the token before it talks to the server', () => {
  it('is signed out immediately, not when the API answers', async () => {
    // The bug, exactly: logout() awaited the server and only then cleared
    // localStorage. On a cold instance that is tens of seconds during which
    // the token is still here, and a full page load in that window — pasting
    // /teacher/dashboard into the address bar — throws away the pending clear
    // along with the page. The guard then found a valid session and let the
    // person back into the account they had just signed out of.
    let release;
    const inFlight = new Promise((resolve) => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(() => inFlight));

    storeSession(USER, 'tok', { remember: true });
    const pending = logout();

    // Before the server has answered anything at all.
    expect(getToken()).toBe(null);
    expect(sessionFor().signedIn).toBe(false);

    release({ ok: true });
    await pending;
    expect(getToken()).toBe(null);
  });

  it('still tells the server, with the token it just dropped', async () => {
    // Clearing locally is not enough on its own: a token that has been copied
    // elsewhere stays valid until it expires, so the revoke must still go out
    // — and it needs the bearer token that has already been cleared locally.
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    storeSession(USER, 'tok', { remember: true });
    await logout();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/auth/logout');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('signs out of this browser even when the server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    storeSession(USER, 'tok', { remember: true });
    await expect(logout()).resolves.toBeUndefined();
    expect(getToken()).toBe(null);
  });

  it('clears an unremembered session too', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true })));
    storeSession(USER, 'tok', { remember: false });
    await logout();
    expect(globalThis.sessionStorage.getItem('tg_token')).toBe(null);
    expect(globalThis.localStorage.getItem('user')).toBe(null);
  });

  it('does not call the server when there was no session to end', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await logout();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
