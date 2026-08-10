/* eslint-env serviceworker */
/**
 * TulongGuro service worker.
 *
 * What this is for: a school on a weak connection can open the app at all,
 * and a phone that drops signal mid-lesson keeps the shell it already has.
 * It is deliberately NOT a general offline mode — see the API rule below.
 *
 * ── The one rule that matters ──
 * Nothing under /api/ or /uploads/ is ever cached, read from cache, or served
 * stale. (/uploads/ is the scanned papers themselves — those stay off a shared
 * classroom device's disk on top of everything else that follows.) A
 * grade, a deadline, a roster and a submission's release state are the whole
 * point of this app, and a teacher shown yesterday's answer would have no way
 * to tell. Requests to the API either reach the server or fail honestly, and
 * the offline upload queue (src/utils/offlineQueue.js) is what carries work
 * across a dropout — not this file.
 *
 * Everything else is static and content-hashed by Vite, so it can be cached
 * hard and replaced wholesale when the hash changes.
 */

const VERSION = 'v1';
const SHELL = `tg-shell-${VERSION}`;    // index.html + icons + manifest
const ASSETS = `tg-assets-${VERSION}`;  // /assets/* — content-hashed, immutable
const FONTS = `tg-fonts-${VERSION}`;    // Google Fonts, cross-origin

const SHELL_URLS = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      // Individually, so one 404 doesn't fail the whole install and leave the
      // app with no worker at all.
      .then((cache) => Promise.allSettled(SHELL_URLS.map((u) => cache.add(u))))
  );
});

self.addEventListener('activate', (event) => {
  const keep = new Set([SHELL, ASSETS, FONTS]);
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/**
 * The page asks for this after it has told the user an update is ready.
 * Without it a new worker sits waiting until every tab is closed, which on a
 * phone means a teacher can run a stale build for days.
 */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

const isApi = (url) => url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/');
const isFont = (url) =>
  url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GET is ever cacheable, and a submission upload is a POST — leaving
  // those alone also keeps them out of the worker's way entirely.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // The API, wherever it lives. In production it is a different origin
  // (VITE_API_URL on Render), so this is matched on path, not origin.
  if (isApi(url)) return;

  // Navigations: network first so a released grade is never a refresh behind,
  // falling back to the cached shell so the app still boots offline. React
  // Router takes it from there; the screens themselves will show their empty
  // states until the network is back.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put('/', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/', { ignoreSearch: true }))
    );
    return;
  }

  // Vite's build output. The filename carries a content hash, so a hit is
  // always the right bytes and a miss is a genuinely new file.
  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(ASSETS).then((c) => c.put(request, copy)).catch(() => {});
        }
        return res;
      }))
    );
    return;
  }

  // Fonts: serve what we have and refresh behind it. index.html already
  // declares a system fallback stack, so a miss here costs nothing.
  if (isFont(url)) {
    event.respondWith(
      caches.match(request).then((hit) => {
        const live = fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(FONTS).then((c) => c.put(request, copy)).catch(() => {});
          }
          return res;
        }).catch(() => hit);
        return hit || live;
      })
    );
    return;
  }

  // Same-origin static extras (icons, the demo image). Cache-first: these are
  // not hashed, but they change about once a year and the shell cache is
  // dropped wholesale on every version bump above.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(request, copy)).catch(() => {});
        }
        return res;
      }))
    );
  }
});
