import { useState, useEffect, useRef, useCallback } from 'react';
import { ShieldCheck, ShieldAlert } from 'lucide-react';

/**
 * The Cloudflare Turnstile box on the registration form.
 *
 * Only the school-registration form has one. It is the public endpoint that
 * costs something to abuse — an 8MB ID upload, a School row, and a place in a
 * queue a person reads by hand — and it is the one a rotating address pool
 * walks straight through the rate limiter on. Login is not gated this way: it
 * is already capped per account and per address, and a challenge in front of
 * every teacher on a school connection would buy very little for what it costs
 * them. See server/captcha.js.
 *
 * ── Unconfigured renders nothing ──
 *
 * With no VITE_TURNSTILE_SITE_KEY this component reports itself ready and
 * draws nothing, which is what makes `npm run dev` work without a Cloudflare
 * account. The server half is off in the same situation, so the two agree.
 *
 * ── Why the script is loaded here and not in index.html ──
 *
 * Registration is one route out of dozens. A tag in index.html would have
 * every pupil opening their dashboard pay for a third-party script they will
 * never be shown, on connections where that is a real cost. The loader below
 * is idempotent — a second mount finds the existing tag and waits on it rather
 * than adding another.
 */

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

/**
 * Whether a challenge is in play at all, for callers that need to refuse to
 * submit without a token. Exported rather than re-derived at the call site so
 * "is the captcha on" has one answer on the client, the way captchaConfigured()
 * is the one answer on the server.
 */
export const CAPTCHA_ENABLED = !!SITE_KEY;
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const SCRIPT_ID = 'cf-turnstile-script';

/**
 * How long to wait for Cloudflare's script before calling it a failure.
 *
 * A blocked request usually errors quickly, but a captive portal or a very
 * slow link can leave it pending indefinitely, and a registrant staring at a
 * box that never appears has no way to know whether to keep waiting. Ten
 * seconds, then say so and offer a retry.
 */
const LOAD_TIMEOUT_MS = 10_000;

/** Resolves when window.turnstile exists, rejects if it never arrives. Shared
 *  across mounts so the tag is only ever added once. */
let loaderPromise = null;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // Let a later attempt start clean — a retry after the connection comes
      // back should not inherit this rejection forever.
      loaderPromise = null;
      reject(new Error('Turnstile script timed out'));
    }, LOAD_TIMEOUT_MS);

    const done = () => {
      clearTimeout(timer);
      // onload fires when the file has run; the global appears in the same
      // tick in practice, but resolving on its absence would hand back
      // undefined and fail further away from the cause.
      if (window.turnstile) resolve(window.turnstile);
      else { loaderPromise = null; reject(new Error('Turnstile loaded without its global')); }
    };
    const failed = () => {
      clearTimeout(timer);
      loaderPromise = null;
      reject(new Error('Turnstile script blocked or unreachable'));
    };

    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      existing.addEventListener('load', done);
      existing.addEventListener('error', failed);
      return;
    }
    const tag = document.createElement('script');
    tag.id = SCRIPT_ID;
    tag.src = SCRIPT_SRC;
    tag.async = true;
    tag.defer = true;
    tag.addEventListener('load', done);
    tag.addEventListener('error', failed);
    document.head.appendChild(tag);
  });
  return loaderPromise;
}

/**
 * `onToken` receives the solved token, or '' whenever the current one stops
 * being usable — expired, errored, or the widget was reset. The parent holds
 * it and sends it as a header; this component never talks to our API.
 *
 * `onUnavailable` is called when the script could not be loaded at all, so the
 * form can explain that rather than presenting a submit button that is
 * guaranteed to be refused.
 *
 * `resetKey` re-arms the widget when it changes. A Turnstile token is good for
 * one verification, so *any* refused registration spends it — including one
 * refused for a reason that has nothing to do with the challenge, like a
 * School ID the server could not find. Without a reset the person fixes the
 * real problem, presses register again, and is told they are not a human.
 */
export default function CaptchaGate({ onToken, onUnavailable, resetKey = 0 }) {
  const holder = useRef(null);
  const widgetId = useRef(null);
  // Held in refs so re-rendering the parent form on every keystroke does not
  // tear the widget down and re-render it — Turnstile manages its own DOM, and
  // remounting it mid-challenge loses whatever the person had already solved.
  const onTokenRef = useRef(onToken);
  const onUnavailableRef = useRef(onUnavailable);
  useEffect(() => { onTokenRef.current = onToken; }, [onToken]);
  useEffect(() => { onUnavailableRef.current = onUnavailable; }, [onUnavailable]);

  const [status, setStatus] = useState(SITE_KEY ? 'loading' : 'disabled');
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setStatus('loading');
    setAttempt(n => n + 1);
  }, []);

  useEffect(() => {
    if (!SITE_KEY) return;
    let cancelled = false;

    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !holder.current) return;
        // Clear anything a previous attempt left behind, so a retry does not
        // stack two boxes in the same container.
        holder.current.innerHTML = '';
        widgetId.current = turnstile.render(holder.current, {
          sitekey: SITE_KEY,
          // Matches the form's light cream surface; the widget's own dark
          // theme would sit oddly on it.
          theme: 'light',
          callback: (token) => { setStatus('solved'); onTokenRef.current?.(token); },
          // A token is good for a few minutes. Someone filling in three steps
          // of a registration form can easily outlast it, so an expiry has to
          // clear the parent's copy — otherwise the form submits a token the
          // server will reject and the person is told they are not a human.
          'expired-callback': () => { setStatus('ready'); onTokenRef.current?.(''); },
          'error-callback': () => { setStatus('ready'); onTokenRef.current?.(''); },
        });
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('unavailable');
        onTokenRef.current?.('');
        onUnavailableRef.current?.();
      });

    return () => {
      cancelled = true;
      // Turnstile keeps timers and an iframe per widget; leaving them behind
      // on unmount leaks both and can fire a callback into a dead component.
      if (widgetId.current && window.turnstile) {
        try { window.turnstile.remove(widgetId.current); } catch { /* already gone */ }
        widgetId.current = null;
      }
    };
  }, [attempt, resetKey]);

  // Nothing configured: the server is not checking either, so there is nothing
  // to show and nothing to wait for.
  if (status === 'disabled') return null;

  if (status === 'unavailable') {
    return (
      <div role="alert" className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-3.5 flex items-start gap-2.5">
        <ShieldAlert className="w-5 h-5 shrink-0 text-amber-600 mt-0.5" />
        <div className="text-sm">
          <p className="font-bold text-amber-800">The verification box could not load.</p>
          <p className="text-amber-700 mt-0.5">
            Check your internet connection, or turn off any ad blocker for this page.
            Registration cannot be sent until this loads.
          </p>
          <button
            type="button"
            onClick={retry}
            className="mt-2 rounded-full px-4 py-2 text-xs font-extrabold text-white bg-amber-600
                       hover:bg-amber-700 active:translate-y-0.5 transition-all"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-bold text-navy-500">
        <ShieldCheck className="w-4 h-4" />
        {status === 'solved' ? 'Verified — you can submit.' : 'Confirm you are a person'}
      </p>
      {/* Turnstile renders its iframe in here. Kept out of React's way: the
          library owns this node's children, so nothing else may write to it. */}
      <div ref={holder} />
      {status === 'loading' && (
        <p className="text-xs text-navy-400">Loading verification…</p>
      )}
    </div>
  );
}
