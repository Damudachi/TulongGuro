/**
 * Light / dark / follow-the-system, and the one place that decides.
 *
 * The colours themselves are not here — every palette in tailwind.config.js is
 * emitted as a CSS variable with its light value as the fallback, and the dark
 * block in index.css re-points those variables. All this module does is set
 * `data-theme` on <html>, which is the selector that block hangs off.
 *
 * Three preferences, not two. "Dark" and "light" are choices the learner or
 * teacher has made and must survive their phone switching to night mode at
 * sunset; "system" is the deliberate absence of a choice, and has to keep
 * tracking the OS afterwards. Collapsing that to a boolean loses the difference
 * between "I want light" and "I have not said".
 */

import { reapplySchoolTheme } from './schoolTheme';

export const THEME_KEY = 'tg-theme';
export const THEMES = ['light', 'dark', 'system'];
export const DEFAULT_THEME = 'system';

/**
 * The stored preference, or "system" for anyone who has never chosen.
 *
 * Reads defensively: this runs before anything else on the very first paint,
 * and a corrupted or blocked localStorage must not be able to stop the app
 * rendering at all. An unrecognised value is treated as no value.
 */
export function readThemePreference() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return THEMES.includes(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
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
 * installed app. Left alone and it stays brand blue over a black page, which is
 * the one part of a dark theme a user cannot dismiss.
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
  const root = document.documentElement;
  root.dataset.theme = resolved;
  paintBrowserChrome(resolved);
  reapplySchoolTheme();
}

/* ── The store the React hook subscribes to ────────────────────────────────
 *
 * A plain module-level store rather than context: the theme is read by three
 * layouts and two settings screens that share no common provider below <App>,
 * and it also has to be settable from outside React (the pre-paint script in
 * index.html sets the attribute before React exists). One store both can see is
 * simpler than threading a provider through every route.
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

export function setThemePreference(next) {
  if (!THEMES.includes(next)) return;
  preference = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Private browsing, or storage disabled. The choice still applies for this
    // session; it just will not survive a reload, which is a far better outcome
    // than refusing to switch at all.
  }
  applyResolvedTheme(resolveTheme(next));
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
  applyResolvedTheme(resolveTheme(preference));
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
