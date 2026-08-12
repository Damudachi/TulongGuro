import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { registerSW } from '../../src/utils/registerSW.js';

/**
 * Whether the service worker is registered at all.
 *
 * Registration is deferred to the load event so it does not compete with the
 * first paint. The trap: registerSW runs from a React effect, and on a fully
 * cached PWA cold start the load event has already fired by the time React
 * mounts. A load listener added after load never runs, so on exactly those
 * launches — the fast ones, the ones a phone does every morning — register()
 * was never called, the browser never re-checked sw.js, and a shipped fix had
 * no way to reach the device.
 *
 * Reported as "the student still gets the browser's offline page", on the same
 * phone and same build where the teacher side worked.
 */

let listeners;

const swRegistration = () => ({
  waiting: null,
  installing: null,
  addEventListener: vi.fn(),
});

beforeEach(() => {
  vi.stubEnv('DEV', false);
  listeners = new Map();

  // stubGlobal rather than assignment: navigator is getter-only in Node.
  vi.stubGlobal('document', { readyState: 'loading' });
  vi.stubGlobal('window', {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
    location: { reload: vi.fn() },
  });
  vi.stubGlobal('navigator', {
    serviceWorker: {
      register: vi.fn(() => Promise.resolve(swRegistration())),
      addEventListener: vi.fn(),
      controller: null,
      getRegistrations: vi.fn(() => Promise.resolve([])),
    },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('registering the service worker', () => {
  it('registers immediately when the page has already finished loading', () => {
    document.readyState = 'complete';

    registerSW(() => {});

    // No load event will ever come — it is already past.
    expect(navigator.serviceWorker.register).toHaveBeenCalledWith('/sw.js');
    expect(listeners.has('load')).toBe(false);
  });

  it('waits for load when the page is still loading', () => {
    document.readyState = 'loading';

    registerSW(() => {});
    expect(navigator.serviceWorker.register).not.toHaveBeenCalled();

    listeners.get('load')();
    expect(navigator.serviceWorker.register).toHaveBeenCalledWith('/sw.js');
  });

  it('registers exactly once when load does fire', () => {
    document.readyState = 'loading';
    registerSW(() => {});

    listeners.get('load')();
    listeners.get('load')();

    // The listener is registered with { once: true }; this asserts the handler
    // itself is not also doing the work a second time through another path.
    expect(navigator.serviceWorker.register).toHaveBeenCalledTimes(2);
  });

  it('does nothing at all in a browser with no service worker support', () => {
    vi.stubGlobal('navigator', {});
    document.readyState = 'complete';

    expect(() => registerSW(() => {})).not.toThrow();
    expect(listeners.has('load')).toBe(false);
  });

  it('unregisters instead of installing under a dev build', async () => {
    vi.stubEnv('DEV', true);
    document.readyState = 'complete';

    registerSW(() => {});
    await Promise.resolve();

    // A worker left over from a previous build would serve yesterday's code
    // back at the dev server, so dev tears them down rather than adding one.
    expect(navigator.serviceWorker.getRegistrations).toHaveBeenCalled();
    expect(navigator.serviceWorker.register).not.toHaveBeenCalled();
  });
});
