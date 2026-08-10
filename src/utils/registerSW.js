/**
 * Service worker registration.
 *
 * Registered only for real builds. Under `vite dev` the worker would sit in
 * front of the dev server's module graph and serve yesterday's code back at
 * you, which is a miserable way to lose an afternoon — and the browser keeps
 * a registration alive across restarts, so a worker installed once in dev
 * keeps doing it. The unregister call below is the cleanup for anyone whose
 * browser already has one from a previous build.
 *
 * A waiting worker means new code is downloaded but every open tab is still
 * running the old one. That matters more here than on most sites: teachers
 * leave the app open on a classroom machine for days, and a fix shipped this
 * morning would not reach them until they thought to close every tab. So the
 * app is told, and it asks.
 */
export function registerSW(onUpdateReady) {
  if (!('serviceWorker' in navigator)) return;

  if (import.meta.env.DEV) {
    navigator.serviceWorker.getRegistrations?.()
      .then((regs) => regs.forEach((r) => r.unregister()))
      .catch(() => {});
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // Already waiting when this tab opened.
      if (reg.waiting && navigator.serviceWorker.controller) {
        onUpdateReady(() => reg.waiting.postMessage('SKIP_WAITING'));
      }

      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          // `controller` is null on the very first install — that one is not
          // an update, it's the worker taking over a page that had none.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            onUpdateReady(() => installing.postMessage('SKIP_WAITING'));
          }
        });
      });
    }).catch(() => {
      // No worker means no offline shell. Everything else still works, so
      // there is nothing to tell the user about.
    });

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;   // Chrome can fire this more than once
      reloading = true;
      window.location.reload();
    });
  });
}
