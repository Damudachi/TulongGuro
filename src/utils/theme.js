/**
 * Light / dark / follow-the-system, per account.
 *
 * The colours themselves are not here — every palette in tailwind.config.js is
 * emitted as a CSS variable with its light value as the fallback, and the dark
 * block in index.css re-points those variables. All this module does is set
 * `data-theme` on <html>, which is the selector that block hangs off.
 *
 * ── Why the preference belongs to the account and not the browser ──
 *
 * TulongGuro runs on shared hardware. A computer lab where thirty learners sign
 * into the same twenty machines; one classroom phone passed down a row; a
 * teacher's laptop borrowed by whoever is covering their class. Kept in one
 * browser-wide key, the first person to turn dark mode on turned it on for
 * every account that signed in after them — they had chosen for strangers.
 *
 * So the preference is stored twice, and the two do different jobs:
 *
 *   • On the User row, which is what makes it the account's — it follows a
 *     teacher from the lab PC to their own phone, and is the source of truth
 *     when the two disagree.
 *   • Cached in localStorage under a key carrying the account's id, which is
 *     what lets the theme be correct *before the first paint*. The server value
 *     cannot be known until an API call has returned, and a dark-mode user
 *     watching a white page for a second on every launch is the single worst
 *     thing a dark mode can do.
 *
 * Signed out, the key is `:guest` — a separate slot, so the login screen never
 * inherits the last person's choice. That is the leak this whole design exists
 * to close, and it would be silly to reintroduce it on the way out.
 */

import { sessionFor } from './session';
import { reapplySchoolTheme } from './schoolTheme';

const KEY_PREFIX = 'tg-theme';
/**
 * The browser-wide key this feature originally shipped with, now cleaned up on
 * sight. Deliberately never adopted into an account: there is no way to know
 * whose choice it was, and guessing would hand one person's setting to whoever
 * happened to sign in first — the exact bug.
 */
const LEGACY_KEY = 'tg-theme';

export const THEMES = ['light', 'dark', 'system'];
export const DEFAULT_THEME = 'system';

/** Which slot this account's preference lives in. */
export function storageKeyFor(userId) {
  return `${KEY_PREFIX}:${userId || 'guest'}`;
}

/**
 * Whose preference applies right now.
 *
 * `sessionFor()` and not the stored user blob: a one-off sign-in that ended
 * with the tab leaves the blob behind by design (see session.js), so reading
 * the blob alone would keep applying a departed user's theme to the login
 * screen the next person sees.
 */
const currentUserId = () => sessionFor().id;

const store = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const readRaw = (k) => { try { return store()?.getItem(k) ?? null; } catch { return null; } };
const writeRaw = (k, v) => { try { store()?.setItem(k, v); } catch { /* blocked or full */ } };
const dropRaw = (k) => { try { store()?.removeItem(k); } catch { /* blocked */ } };

/** The cached preference for one account, or "system" if they never chose. */
export function readThemePreference(userId = currentUserId()) {
  const stored = readRaw(storageKeyFor(userId));
  return THEMES.includes(stored) ? stored : DEFAULT_THEME;
}

const systemPrefersDark = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches;

/** Which of the two themes a preference actually resolves to right now. */
export function resolveTheme(preference) {
  if (preference === 'dark') return 'dark';
  if (preference === 'light') return 'light';
  return systemPrefersDark() ? 'dark' : 'light';
}

/**
 * The browser chrome colour — the Android status bar, and the title bar of the
 * installed app. Left alone it stays brand blue over a black page, which is the
 * one part of a dark theme a user cannot dismiss.
 */
function paintBrowserChrome(resolved) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0B1120' : '#2B59C3');
}

/**
 * Put a resolved theme on the document.
 *
 * `reapplySchoolTheme` is what keeps a branded school in step: its ramp is
 * written as inline styles on <html>, which beat anything in a stylesheet, so
 * the dark block in index.css cannot correct a school's own colours. Rebuilding
 * the ramp for the new theme is the only way those two can agree.
 */
export function applyResolvedTheme(resolved) {
  // No document in a unit test or any non-browser context. Returning quietly
  // keeps this module importable from those — config.js now calls into it on
  // every sign-out, so a throw here would take the session tests down with it.
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = resolved;
  paintBrowserChrome(resolved);
  reapplySchoolTheme();
}

/* ── The store the React hook subscribes to ────────────────────────────────
 *
 * A plain module-level store rather than context: the theme is read by three
 * layouts and two settings screens that share no common provider below <App>,
 * and it also has to be settable from outside React — the pre-paint script in
 * index.html sets the attribute before React exists, and config.js tells this
 * module when the session changes.
 */

let preference = readThemePreference();
const listeners = new Set();
const notify = () => listeners.forEach(fn => fn());

/** Subscribe to preference changes. Returns the unsubscribe function. */
export function subscribeToTheme(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getThemePreference = () => preference;

/** What the app is actually showing right now — 'light' or 'dark'. */
export const getResolvedTheme = () => resolveTheme(preference);

/**
 * How the choice reaches the account's row on the server.
 *
 * Injected rather than imported. config.js imports this module so a sign-in can
 * re-read the theme, so importing apiFetch back from config.js would close that
 * loop — and calling bare `fetch()` instead is exactly what this codebase's
 * lint rule forbids, for the good reason that it drops the auth token and the
 * session-renewal header. config.js installs the real one at module scope, and
 * it is imported by every screen, so the no-op default only ever survives in a
 * test.
 */
let persistToAccount = () => {};

export function configureThemePersistence(fn) {
  persistToAccount = typeof fn === 'function' ? fn : () => {};
}

export function setThemePreference(next) {
  if (!THEMES.includes(next)) return;
  const userId = currentUserId();
  preference = next;
  writeRaw(storageKeyFor(userId), next);
  applyResolvedTheme(resolveTheme(next));
  notify();
  // Fire-and-forget, and failure is swallowed by the installed function. The
  // local cache is already written and the screen has already changed, so a
  // failed sync costs this preference following the person to another device —
  // not the switch they just flipped. The next change retries it.
  if (userId) persistToAccount(userId, next);
}

/**
 * Re-read the theme for whoever is signed in now.
 *
 * Called by config.js on sign-in and on sign-out. Without it, signing out of a
 * dark account would leave the login screen dark for the next person, and
 * signing in would keep showing the previous account's theme until a reload.
 *
 * `serverPreference` is what the account's own User row says, which arrives on
 * the login response. It wins over the local cache and is written into it,
 * because it may have been set on a different device — and because a device
 * this account has never used before has no cache to read.
 */
export function refreshThemeForSession(serverPreference = null) {
  const userId = currentUserId();
  if (userId && THEMES.includes(serverPreference)) {
    writeRaw(storageKeyFor(userId), serverPreference);
  }
  preference = readThemePreference(userId);
  applyResolvedTheme(resolveTheme(preference));
  notify();
}

/**
 * Start tracking the OS setting.
 *
 * Only matters while the preference is "system", but the listener is attached
 * unconditionally and checks at fire time — attaching and detaching it as the
 * preference changes is more moving parts for the same result.
 *
 * Called once from main.jsx. Returns a teardown so it can be torn down in a
 * test without leaking a listener between cases.
 */
export function startThemeSync() {
  // The browser-wide key from before this was per-account. Removed rather than
  // migrated, for the reason given at LEGACY_KEY.
  dropRaw(LEGACY_KEY);
  refreshThemeForSession();

  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};

  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const onSystemChange = () => {
    if (preference !== 'system') return;
    applyResolvedTheme(resolveTheme(preference));
    notify();
  };

  // addEventListener on a MediaQueryList is comparatively recent; addListener
  // is the older spelling and is what some of the Android WebViews this app is
  // installed into still ship. Falling back costs two lines and is the
  // difference between the OS setting being followed and being ignored there.
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', onSystemChange);
    return () => query.removeEventListener('change', onSystemChange);
  }
  query.addListener(onSystemChange);
  return () => query.removeListener(onSystemChange);
}
