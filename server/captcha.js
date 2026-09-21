/**
 * captcha.js — Cloudflare Turnstile on the school registration form.
 *
 * /api/auth/register is the expensive public endpoint: it accepts up to 8MB of
 * ID photograph plus a logo and a proof document, creates a School and its
 * first admin, and drops the result into a PENDING queue that a TulongGuro
 * operator reads by hand. The rate limiters in auth.js cap it at 5 an hour and
 * 10 a day per address, which is a real limit on bandwidth and a weak one on
 * the thing that actually costs — reviewer attention — because addresses are
 * cheap to rotate and the limit resets for each new one. A challenge is the
 * part a rotating address pool does not solve.
 *
 * Turnstile rather than reCAPTCHA: no volume cap, no Google account tied to
 * the deployment, and it is usually invisible rather than a grid of traffic
 * lights, which matters when the user is a principal on a school connection.
 *
 * ── Why the token arrives in a header ──
 *
 * The obvious place is the request body, and for this route the body does not
 * exist yet. Registration is multipart/form-data, so nothing in it is readable
 * until multer has finished parsing — by which point the 8MB upload has
 * already crossed the wire and been written to disk, which is exactly the cost
 * the challenge exists to refuse. X-Captcha-Token is readable on the first
 * byte, so requireCaptcha can sit ahead of the multer branch and turn a bot
 * away before it is allowed to spend anything. CORS needs no change for this:
 * cors() is configured without `allowedHeaders`, so it reflects whatever the
 * preflight asks for, the same way Authorization already works.
 *
 * ── What happens when verification cannot happen ──
 *
 * Two different failures, deliberately handled in opposite directions.
 *
 * No token, or a token Cloudflare rejects, is refused. The alternative — wave
 * through anyone who omits the header — makes the whole thing decorative,
 * since a bot omits it for free. A registrant whose browser could not load the
 * widget therefore gets an explicit, actionable message rather than a silent
 * pass, and CAPTCHA_ERROR is a distinct code so the form can say which thing
 * went wrong.
 *
 * Cloudflare itself being unreachable is let through, and logged. That is our
 * dependency failing, not the registrant's; it is not attacker-controllable;
 * and the honest trade for a Philippine public school on an intermittent line
 * is that an outage at a third party must not be the reason a school cannot
 * sign up. The manual approval queue is still behind this either way.
 *
 * ── Unconfigured means off ──
 *
 * With no TURNSTILE_SECRET_KEY the check is a no-op, the same shape as the
 * Gemini keys: local development and the test suite must not need a Cloudflare
 * account to run the registration form. The boot log says which mode is live
 * so "the captcha is not working" is answerable from the logs.
 */

/**
 * Trim and unquote an env value. Same reasoning as envValue() in server.js —
 * a key pasted from a Render dashboard field into a .env arrives wrapped in
 * quotes, and a trailing newline from a copy does the same damage. Duplicated
 * rather than imported because server.js is the application and importing it
 * from a module it loads would be a cycle.
 */
function envValue(name) {
  const raw = process.env[name];
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/^["'](.*)["']$/s, '$1').trim();
}

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** The header the widget's token travels in. Lowercase: Node normalises
 *  incoming header names, and req.headers is keyed that way. */
const CAPTCHA_HEADER = 'x-captcha-token';

/**
 * How long to wait on Cloudflare before treating it as unreachable.
 *
 * Cloudflare answers in well under a second in normal operation. The timeout
 * is not tuned to that — it is tuned to how long a principal should be left
 * looking at a spinner before we stop making them wait for something that is
 * not their fault. Five seconds, then fail open.
 */
const VERIFY_TIMEOUT_MS = 5_000;

/** Whether a secret is configured at all. Read through a function rather than
 *  captured at load so a test can set the variable and see it take effect. */
const captchaConfigured = () => !!envValue('TURNSTILE_SECRET_KEY');

/**
 * Turn a siteverify response body into a decision.
 *
 * Split out from the request so the interesting half is testable without a
 * network. Cloudflare returns { success, "error-codes": [...] }; the codes are
 * for our logs, never for the registrant, who can do nothing with
 * "invalid-input-secret" except be confused by it.
 */
function interpretSiteverify(payload) {
  if (payload && payload.success === true) return { ok: true };
  const codes = Array.isArray(payload?.['error-codes']) ? payload['error-codes'] : [];
  // A secret we got wrong is our bug, not the registrant's, and it would
  // otherwise present as every school on earth failing the challenge. Named
  // separately so it is greppable in the logs.
  const ours = codes.includes('invalid-input-secret') || codes.includes('missing-input-secret');
  return { ok: false, codes, misconfigured: ours };
}

/**
 * Check one token with Cloudflare.
 *
 * Resolves to { ok: true } when the challenge passed, when nothing is
 * configured, or when the verifier could not be reached — see the header note
 * on why those last two are passes. `skipped` says which, for the caller's log.
 */
async function verifyCaptcha(token, ip) {
  if (!captchaConfigured()) return { ok: true, skipped: 'unconfigured' };
  if (!token) return { ok: false, reason: 'missing' };

  const body = new URLSearchParams({ secret: envValue('TURNSTILE_SECRET_KEY'), response: token });
  // Cloudflare uses the address to spot one token being replayed from many
  // places. Omitted rather than guessed when we do not have a clean one.
  if (ip && ip !== 'unknown') body.set('remoteip', ip);

  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    // A 5xx from the verifier is the verifier being down, which is the
    // fail-open case — not a failed challenge.
    if (!res.ok) return { ok: true, skipped: 'verifier-unreachable', status: res.status };
    const verdict = interpretSiteverify(await res.json());
    if (verdict.ok) return { ok: true };
    if (verdict.misconfigured) {
      console.error('⚠ Turnstile rejected our own secret — check TURNSTILE_SECRET_KEY:', verdict.codes);
    }
    return { ok: false, reason: 'rejected', codes: verdict.codes };
  } catch (err) {
    // Timeout, DNS, TLS, a malformed body — all of them mean we did not get an
    // answer, none of them mean this registrant is a bot.
    return { ok: true, skipped: 'verifier-unreachable', error: err?.message || String(err) };
  }
}

/**
 * Express middleware for the registration route. Must be mounted after the
 * rate limiters (they are free, this makes a network call) and before the
 * multer branch (see the header note on why).
 */
async function requireCaptcha(req, res, next) {
  const token = req.headers[CAPTCHA_HEADER];
  const result = await verifyCaptcha(
    typeof token === 'string' ? token.trim() : '',
    req.ip || req.socket?.remoteAddress || '',
  );

  if (result.ok) {
    if (result.skipped === 'verifier-unreachable') {
      console.warn('⚠ Turnstile unreachable — registration allowed through unverified:', result.error || result.status);
    }
    return next();
  }

  // One code and one message for both refusals. Which of "you sent nothing"
  // and "Cloudflare said no" it was does not change what the registrant should
  // do, and the form needs a single branch to handle it.
  return res.status(400).json({
    success: false,
    code: 'CAPTCHA_FAILED',
    error: 'We could not confirm you are a person. Please complete the verification box and try again — if it did not appear, check your connection or any ad blocker and reload the page.',
  });
}

module.exports = {
  CAPTCHA_HEADER,
  VERIFY_URL,
  VERIFY_TIMEOUT_MS,
  captchaConfigured,
  interpretSiteverify,
  verifyCaptcha,
  requireCaptcha,
};
