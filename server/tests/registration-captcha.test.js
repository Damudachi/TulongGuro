import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const {
  CAPTCHA_HEADER, VERIFY_URL,
  captchaConfigured, interpretSiteverify, verifyCaptcha, requireCaptcha,
} = require('../captcha.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_JS = join(HERE, '..', 'server.js');
const REGISTER_PAGE = join(HERE, '..', '..', 'src', 'pages', 'Register.jsx');
const CAPTCHA_COMPONENT = join(HERE, '..', '..', 'src', 'components', 'CaptchaGate.jsx');

const SECRET = 'TURNSTILE_SECRET_KEY';
let savedSecret;

beforeEach(() => { savedSecret = process.env[SECRET]; });
afterEach(() => {
  if (savedSecret === undefined) delete process.env[SECRET];
  else process.env[SECRET] = savedSecret;
  vi.unstubAllGlobals();
});

/** A minimal Express double: enough to see which way the middleware went. */
function runMiddleware(headers = {}) {
  const req = { headers, ip: '203.0.113.7', socket: {} };
  const res = {
    statusCode: 0, body: null, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    set(k, v) { this.headers[k] = v; return this; },
  };
  let passed = false;
  return requireCaptcha(req, res, () => { passed = true; })
    .then(() => ({ passed, status: res.statusCode, body: res.body }));
}

/**
 * The bot challenge on school registration.
 *
 * Registration is the public endpoint that costs something to abuse: an 8MB ID
 * upload, a School row, and a place in a queue a TulongGuro operator reads by
 * hand. The rate limiters cap it per address and addresses rotate cheaply, so
 * a challenge is the part they do not cover.
 *
 * The two failure directions below are the whole design, and they point
 * opposite ways on purpose:
 *
 *   • A missing or rejected token is REFUSED. Waving through anyone who omits
 *     the header would make the feature decorative — a bot omits it for free.
 *   • Cloudflare being unreachable is ALLOWED THROUGH. That is our dependency
 *     failing, not the registrant's, it is not attacker-controllable, and an
 *     outage at a third party must not be why a school cannot sign up.
 *
 * Unconfigured is off, so `npm run dev` and this suite need no Cloudflare
 * account. That is also the state most likely to be true by accident, which is
 * why the boot log says which mode is live.
 */
describe('reading Cloudflare’s verdict', () => {
  it('passes a success', () => {
    expect(interpretSiteverify({ success: true })).toEqual({ ok: true });
  });

  it('refuses a failure and keeps the codes for our logs', () => {
    const verdict = interpretSiteverify({ success: false, 'error-codes': ['invalid-input-response'] });
    expect(verdict.ok).toBe(false);
    expect(verdict.codes).toContain('invalid-input-response');
    expect(verdict.misconfigured).toBe(false);
  });

  it('separates "our secret is wrong" from "this caller failed"', () => {
    // Otherwise a mistyped key presents as every school on earth being a bot.
    for (const code of ['invalid-input-secret', 'missing-input-secret']) {
      expect(interpretSiteverify({ success: false, 'error-codes': [code] }).misconfigured).toBe(true);
    }
  });

  it('treats anything malformed as a failure, not a pass', () => {
    expect(interpretSiteverify(null).ok).toBe(false);
    expect(interpretSiteverify({}).ok).toBe(false);
    expect(interpretSiteverify({ success: 'true' }).ok).toBe(false);
  });
});

describe('verifying a token', () => {
  it('is a no-op when no secret is configured', async () => {
    delete process.env[SECRET];
    expect(captchaConfigured()).toBe(false);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(verifyCaptcha('', '1.2.3.4')).resolves.toMatchObject({ ok: true, skipped: 'unconfigured' });
    // And it does not reach out to Cloudflare to find that out.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a missing token once a secret is configured', async () => {
    process.env[SECRET] = 'test-secret';
    await expect(verifyCaptcha('', '1.2.3.4')).resolves.toMatchObject({ ok: false, reason: 'missing' });
  });

  it('posts the secret and the token to the siteverify endpoint', async () => {
    process.env[SECRET] = 'test-secret';
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(verifyCaptcha('a-token', '203.0.113.7')).resolves.toMatchObject({ ok: true });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(VERIFY_URL);
    const sent = new URLSearchParams(init.body.toString());
    expect(sent.get('secret')).toBe('test-secret');
    expect(sent.get('response')).toBe('a-token');
    expect(sent.get('remoteip')).toBe('203.0.113.7');
  });

  it('omits remoteip rather than guessing one', async () => {
    process.env[SECRET] = 'test-secret';
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal('fetch', fetchSpy);
    await verifyCaptcha('a-token', 'unknown');
    expect(new URLSearchParams(fetchSpy.mock.calls[0][1].body.toString()).has('remoteip')).toBe(false);
  });

  it('refuses a token Cloudflare rejects', async () => {
    process.env[SECRET] = 'test-secret';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: false, 'error-codes': ['timeout-or-duplicate'] }),
    }));
    await expect(verifyCaptcha('stale', '1.2.3.4')).resolves.toMatchObject({ ok: false, reason: 'rejected' });
  });

  it('lets the registrant through when Cloudflare cannot be reached', async () => {
    process.env[SECRET] = 'test-secret';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ETIMEDOUT')));
    await expect(verifyCaptcha('a-token', '1.2.3.4'))
      .resolves.toMatchObject({ ok: true, skipped: 'verifier-unreachable' });
  });

  it('treats a 5xx from the verifier as unreachable, not as a failed challenge', async () => {
    process.env[SECRET] = 'test-secret';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) }));
    await expect(verifyCaptcha('a-token', '1.2.3.4'))
      .resolves.toMatchObject({ ok: true, skipped: 'verifier-unreachable' });
  });
});

describe('the middleware on the registration route', () => {
  it('reads the token from a header, not the body', async () => {
    // The body does not exist until multer has parsed it, by which point the
    // 8MB upload has already landed — which is the cost being refused.
    expect(CAPTCHA_HEADER).toBe('x-captcha-token');
    process.env[SECRET] = 'test-secret';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }));
    const result = await runMiddleware({ [CAPTCHA_HEADER]: 'a-token' });
    expect(result.passed).toBe(true);
  });

  it('answers a refusal with 400 and CAPTCHA_FAILED', async () => {
    process.env[SECRET] = 'test-secret';
    const result = await runMiddleware({});
    expect(result.passed).toBe(false);
    expect(result.status).toBe(400);
    expect(result.body.code).toBe('CAPTCHA_FAILED');
  });

  it('tells the person what to do about it', async () => {
    process.env[SECRET] = 'test-secret';
    const { body } = await runMiddleware({});
    // A blocked widget is the likeliest cause and the one they can act on.
    expect(body.error).toMatch(/blocker|connection/i);
    // Never leak Cloudflare's own codes to a principal.
    expect(body.error).not.toMatch(/invalid-input|error-codes/);
  });

  it('passes everything through when unconfigured', async () => {
    delete process.env[SECRET];
    const result = await runMiddleware({});
    expect(result.passed).toBe(true);
  });
});

describe('where it is wired in', () => {
  const source = readFileSync(SERVER_JS, 'utf8');
  const registerRoute = source.slice(
    source.indexOf("app.post('/api/auth/register'"),
    source.indexOf("app.post('/api/auth/register'") + 400,
  );

  it('guards registration', () => {
    expect(registerRoute).toContain('requireCaptcha');
  });

  it('runs after the rate limiters and before multer', () => {
    // After the limiters because they are free and this makes a network call;
    // before multer because the whole point is to refuse a bot before it is
    // allowed to spend an upload.
    const limiterAt = registerRoute.indexOf('registerDailyRateLimit');
    const captchaAt = registerRoute.indexOf('requireCaptcha');
    const multerAt = registerRoute.indexOf('registrationUpload');
    expect(limiterAt).toBeLessThan(captchaAt);
    expect(captchaAt).toBeLessThan(multerAt);
  });

  it('leaves login alone', () => {
    // Login is capped per account and per address already, and a challenge in
    // front of every teacher on a school connection is a real cost for very
    // little. If this ever changes it should be a decision, not a drift.
    const loginRoute = source.slice(
      source.indexOf("app.post('/api/auth/login'"),
      source.indexOf("app.post('/api/auth/login'") + 300,
    );
    expect(loginRoute).not.toContain('requireCaptcha');
  });
});

describe('the form that carries the token', () => {
  const page = readFileSync(REGISTER_PAGE, 'utf8');
  const component = readFileSync(CAPTCHA_COMPONENT, 'utf8');

  it('sends it as the header the server reads', () => {
    expect(page).toContain("'X-Captcha-Token'");
  });

  it('re-arms the widget after a refused submit', () => {
    // A Turnstile token verifies once, so any refusal spends it — including
    // one that had nothing to do with the challenge. Without this, fixing the
    // real problem and pressing register again fails as "not a person".
    expect(page).toContain('setCaptchaReset');
    expect(component).toContain('resetKey');
  });

  it('never names the secret key in frontend code', () => {
    // Anything VITE_* is compiled into the public bundle.
    for (const src of [page, component]) {
      expect(src).not.toContain('TURNSTILE_SECRET');
    }
    expect(component).toContain('VITE_TURNSTILE_SITE_KEY');
  });

  it('renders nothing when no site key is configured', () => {
    // Local development and the suite run without a Cloudflare account, and
    // the server half is off in the same situation, so the two agree.
    expect(component).toMatch(/status === 'disabled'[\s\S]{0,40}return null/);
  });
});
