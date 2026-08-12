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

const VERSION = 'v2';
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

/**
 * Put the shell in the cache, tolerating individual failures so one 404 does
 * not fail the whole install and leave the app with no worker at all.
 *
 * Called again on activate, and again after any successful navigation, because
 * tolerating a failure is only safe if something later repairs it. It did not,
 * and a phone whose very first install ran on a flaky connection was left
 * permanently without '/' in the cache — which is a device that can never open
 * offline no matter how many times it is used online afterwards.
 */
function cacheShell() {
  return caches.open(SHELL)
    .then((cache) => Promise.allSettled(SHELL_URLS.map((u) => cache.add(u))));
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheShell());
});

self.addEventListener('activate', (event) => {
  const keep = new Set([SHELL, ASSETS, FONTS]);
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k))))
      .then(() => cacheShell())
      .then(() => self.clients.claim())
  );
});

/**
 * The floor under the navigation fallback. Reached only by a device with an
 * empty cache — a first launch that went straight offline, or a cache the
 * browser evicted under storage pressure.
 *
 * It exists because respondWith(undefined) is a network error, and a network
 * error on a navigation is the browser's own "You're offline" page: our icon,
 * somebody else's words, and no hint that the work saved on the device is
 * safe. Inline and tiny, since by definition nothing else can be fetched.
 */
const OFFLINE_FALLBACK = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TulongGuro — offline</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F7F3E9;color:#1B2559;
       font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:2rem;text-align:center}
  .c{max-width:22rem}h1{font-size:1.25rem;margin:0 0 .5rem}p{font-size:.9rem;line-height:1.6;color:#4A5578;margin:0 0 1.5rem}
  button{background:#2B59C3;color:#fff;border:0;border-radius:999px;padding:.75rem 1.75rem;font-size:.9rem;font-weight:700}
</style></head>
<body><div class="c">
  <h1>You're offline</h1>
  <p>TulongGuro can't open right now. Connect to the internet once and it will keep working without a signal after that.</p>
  <button onclick="location.reload()">Try again</button>
</div></body></html>`;

const offlineResponse = () => new Response(OFFLINE_FALLBACK, {
  status: 200,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
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
          // Refreshes the shell, and repairs a device whose install missed it.
          caches.open(SHELL).then((c) => c.put('/', copy)).catch(() => {});
          return res;
        })
        // Every step here can resolve to undefined, and respondWith(undefined)
        // is a network error — which is the browser's offline page, not ours.
        // So the chain ends in a response that always exists.
        .catch(() => caches.match('/', { ignoreSearch: true })
          .then((hit) => hit || caches.match('/index.html', { ignoreSearch: true }))
          .then((hit) => hit || offlineResponse())
          .catch(() => offlineResponse()))
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
