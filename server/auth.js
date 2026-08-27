/**
 * auth.js — signed sessions and per-route authorisation.
 *
 * Before this, every endpoint took the acting user's id straight out of the
 * URL and believed it. `/api/admin/<any-uuid>/analytics` returned that school's
 * data to anyone who asked; `/api/student/<any-uuid>/dashboard` returned a
 * child's grades and feedback. There was nothing to steal a session from
 * because there were no sessions — the id *was* the credential, and ids are
 * handed out in URLs, logs and React props.
 *
 * ── Why a hand-rolled token and not jsonwebtoken ──
 * The token is an HMAC-SHA256 over a JSON payload, with one hardcoded
 * algorithm. That is deliberately less than JWT, not a reimplementation of it:
 * with no `alg` field there is no algorithm-confusion attack to get wrong, and
 * it adds no dependency. The payload is signed, not encrypted — it is readable
 * by anyone holding the token, so nothing secret goes in it.
 *
 * ── What this does and does not give you ──
 * Tokens are stateless and cannot be revoked before they expire; a compromised
 * token is valid for its remaining life, and "log out everywhere" would need a
 * server-side session store. Expiry is therefore short-ish, and rotating
 * AUTH_SECRET invalidates every session at once as the emergency lever.
 */

const crypto = require('crypto');

/**
 * How long a session lasts without being used.
 *
 * Was twelve hours — a school day plus an evening of marking — which meant a
 * teacher using the app daily on their own phone signed in again every
 * morning. Sessions renew while they are in use now (see dueForRenewal), so
 * this is no longer "how long you may stay signed in" but "how long the app
 * may sit untouched before asking again". A week covers a half-term break's
 * worth of weekends without leaving an abandoned session alive for months.
 */
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Past this fraction of its life, a token is reissued on the next request. */
const RENEW_AFTER = 0.5;

/**
 * Where a renewed session arrives. Must also be listed in the CORS
 * `exposedHeaders` — frontend and API are separate origins in production, and
 * a header the browser will not let JavaScript read is a feature that never
 * fires while looking perfectly correct on the wire.
 */
const RENEWED_TOKEN_HEADER = 'X-Renewed-Token';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/**
 * The signing key. Fails closed and loudly: a server that silently fell back to
 * a default secret would issue tokens anyone could forge, which is worse than
 * not starting. In development an ephemeral key is generated instead, so a
 * fresh clone runs — at the cost of invalidating sessions on every restart.
 */
function authSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'AUTH_SECRET is not set. Refusing to sign sessions with a guessable key. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  if (!authSecret._dev) {
    authSecret._dev = crypto.randomBytes(32).toString('hex');
    console.warn('⚠  AUTH_SECRET not set — using a random development key. Sessions end when the server restarts.');
  }
  return authSecret._dev;
}

const sign = (data) => b64url(crypto.createHmac('sha256', authSecret()).update(data).digest());

/** A session token for a freshly authenticated user. */
function signToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({
    sub: user.id,
    role: user.role,
    schoolId: user.schoolId || null,
    // When this session began. Compared against the user's sessionsValidFrom so
    // a session can be ended before its expiry — see isRevoked.
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  }));
  return `${payload}.${sign(payload)}`;
}

/**
 * Whether this token has lived long enough to be worth replacing.
 *
 * The sliding half of the session. Renewing on every request would re-sign
 * constantly and write to localStorage on every call; renewing only at the
 * brink would miss anyone who closes the app for a day. Halfway costs one
 * signature per few days of use.
 *
 * A payload missing either timestamp gets nothing. It cannot be reasoned
 * about, and the failure mode of guessing is handing out a brand-new
 * full-length session on the strength of a malformed token.
 */
function dueForRenewal(claims, now = Math.floor(Date.now() / 1000)) {
  if (!claims || typeof claims.iat !== 'number' || typeof claims.exp !== 'number') return false;
  const lifetime = claims.exp - claims.iat;
  if (lifetime <= 0) return false;
  return (now - claims.iat) > lifetime * RENEW_AFTER;
}

/** The payload of a valid, unexpired token, or null. Never throws. */
function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const payload = token.slice(0, dot);
  const supplied = token.slice(dot + 1);
  const expected = sign(payload);

  // Compare over fixed-length digests: timingSafeEqual throws on a length
  // mismatch, which would otherwise leak signature length through an exception.
  const h = (v) => crypto.createHash('sha256').update(v).digest();
  if (!crypto.timingSafeEqual(h(supplied), h(expected))) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!claims?.sub || typeof claims.exp !== 'number') return null;
    if (claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch { return null; }
}

/**
 * Routes reachable without a session. Everything else under /api requires one.
 *
 * An allowlist rather than a blocklist on purpose: a route added later is
 * protected by default, and forgetting to list it fails visibly at the first
 * request instead of silently leaving it open.
 */
const PUBLIC_PATHS = [
  /^\/$/,                                  // health probe for the host
  /^\/api\/auth\/login$/,
  /^\/api\/auth\/register$/,
  /^\/api\/auth\/school-lookup$/,           // reads DepEd's own published list
  // Suggests and checks a school code while the registration form is open.
  // Necessarily public: nobody registering a school has a session yet. Left off
  // this list it answered 401, and apiFetch reads a 401 as "your session
  // ended" — so filling in a DepEd School ID bounced the registrant to the
  // login screen with an expiry notice, mid-registration.
  /^\/api\/auth\/school-code$/,
  /^\/api\/health(\/|$)/,
  /^\/api\/topics$/,                       // static DepEd reference data
  /^\/api\/rubric-templates\/builtin$/,    // static sample rubrics
  /^\/api\/platform\//,                    // guarded by PLATFORM_ADMIN_KEY instead
  /^\/api\/dev\//,                         // guarded by DEV_ACCESS_KEY instead
  /^\/api\/admin\/(retention-report|backfill-retention|archive-grades|purge-grades)$/,
  /^\/uploads\//,                          // static files served by express
];

const isPublic = (path) => PUBLIC_PATHS.some(re => re.test(path));

/**
 * ── Revocation ──
 *
 * A signature check alone can only say the token was issued by us and hasn't
 * expired. It cannot say the session is still wanted. `User.sessionsValidFrom`
 * closes that: anything issued before it is dead, so signing out, an admin
 * resetting a password, or a school being refused can all end a session now
 * rather than up to twelve hours from now.
 *
 * That costs one lookup per request, so it is memoised briefly. The window is
 * short deliberately — it is the longest a revoked token can still work, and
 * seconds of exposure is a reasonable price for not querying on every call.
 * On a single instance a revoke also writes straight into the cache, so it
 * takes effect immediately; across several instances the others catch up
 * within REVOCATION_CACHE_MS.
 */
const REVOCATION_CACHE_MS = 15_000;
const revocationCache = new Map();   // userId -> { validFrom: number|null, at: number }

/** Called by the app to look up a user's revocation mark. Injected to keep this module free of Prisma. */
let loadSessionsValidFrom = async () => null;
function configureRevocation(loader) { loadSessionsValidFrom = loader; }

/** Record that every session for this user is now invalid. */
function markRevoked(userId, when = new Date()) {
  revocationCache.set(userId, { validFrom: when.getTime(), at: Date.now() });
}

async function isRevoked(claims) {
  const now = Date.now();
  let entry = revocationCache.get(claims.sub);
  if (!entry || now - entry.at > REVOCATION_CACHE_MS) {
    let validFrom = null;
    try {
      const value = await loadSessionsValidFrom(claims.sub);
      validFrom = value ? new Date(value).getTime() : null;
    } catch {
      // A database blip must not log the whole school out. Fall back to the
      // signature and expiry we already verified.
      return false;
    }
    entry = { validFrom, at: now };
    revocationCache.set(claims.sub, entry);
  }
  if (!entry.validFrom) return false;
  // Both sides are compared in whole seconds. `iat` only has second precision,
  // while the revocation mark is a millisecond timestamp, and mixing the two
  // broke the most ordinary case there is: signing out at 10:00:00.5 and back
  // in at 10:00:00.7 produced a token whose iat floored to 10:00:00, which read
  // as older than the mark and was refused. Users would have been unable to log
  // back in for a second after logging out.
  //
  // The cost is that a token issued in the same second as the revocation
  // survives it. That sub-second window is the right trade against breaking
  // every sign-out-then-sign-in.
  //
  // Tokens predating this feature carry no iat and are treated as revoked by
  // any mark, which is the safe reading of "end existing sessions".
  if (typeof claims.iat !== 'number') return true;
  return claims.iat < Math.floor(entry.validFrom / 1000);
}

/** Populates req.auth from the bearer token, or refuses the request. */
async function authenticate(req, res, next) {
  if (isPublic(req.path)) return next();

  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const claims = token && verifyToken(token);
  if (!claims || await isRevoked(claims)) {
    // 401 with a stable code so the client can tell "log in again" apart from
    // "you may not do this" and avoid bouncing the user out on the latter.
    return res.status(401).json({ success: false, code: 'UNAUTHENTICATED', error: 'Please sign in again.' });
  }
  req.auth = claims;

  // The sliding window, done where every authenticated request already passes.
  // Sent as a header rather than in the body because the body belongs to the
  // route — there is no shape shared across a hundred handlers to add a field
  // to, and a header needs no handler to cooperate. apiFetch picks it up.
  if (dueForRenewal(claims)) {
    res.set(RENEWED_TOKEN_HEADER, signToken({
      id: claims.sub, role: claims.role, schoolId: claims.schoolId,
    }));
  }

  next();
}

/**
 * ── Rate limiting ──
 *
 * Password guessing was unthrottled: bcrypt makes each attempt slow, but slow
 * is not the same as bounded, and an attacker with a common-password list and
 * a known username had all night. This caps attempts per window.
 *
 * In-process and therefore per-instance. On one Render service that is the
 * whole application; behind several instances the effective limit multiplies by
 * the instance count, and a shared store (Redis) would be the fix. Said plainly
 * because an in-memory limiter that quietly stops working when you scale is
 * worse than none at all.
 */
const rateBuckets = new Map();   // key -> { count, resetAt }

/**
 * `name` separates two limiters that guard the same path with the same key.
 * Without it the bucket is `path|key`, so stacking an hourly and a daily limit
 * on one route keyed by IP would have them share one counter and quietly
 * enforce whichever is tighter. Defaults to the path, which is what every
 * limiter that does not stack already relies on.
 */
function rateLimit({ windowMs, max, key, name }) {
  return (req, res, next) => {
    const bucketKey = `${name || req.path}|${key(req)}`;
    const now = Date.now();
    let bucket = rateBuckets.get(bucketKey);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      rateBuckets.set(bucketKey, bucket);
    }
    bucket.count++;
    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        success: false,
        code: 'RATE_LIMITED',
        error: `Too many attempts. Please wait ${Math.ceil(retryAfter / 60)} minute(s) and try again.`,
      });
    }
    next();
  };
}

// Unbounded growth would be a memory leak an attacker controls, so expired
// buckets are swept periodically. unref() so this timer never holds the
// process open on shutdown.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [k, b] of rateBuckets) if (now > b.resetAt) rateBuckets.delete(k);
  for (const [k, e] of revocationCache) if (now - e.at > REVOCATION_CACHE_MS * 4) revocationCache.delete(k);
}, 60_000);
if (typeof sweeper.unref === 'function') sweeper.unref();

/** Client address, honouring Render's proxy — see `trust proxy` in server.js. */
const clientIp = (req) => req.ip || req.socket?.remoteAddress || 'unknown';

/**
 * Two limits on login, doing different jobs: one username under attack is
 * stopped by the first, and an attacker spraying one password across many
 * usernames from one address is stopped by the second.
 */
const loginRateLimit = [
  rateLimit({ windowMs: 15 * 60_000, max: 10, key: r => `${clientIp(r)}:${String(r.body?.username || '').toLowerCase()}` }),
  rateLimit({ windowMs: 15 * 60_000, max: 50, key: r => clientIp(r) }),
];
/**
 * Registration creates a School and an admin, so it is worth throttling harder.
 *
 * Two windows, because one cannot do both jobs. The hourly limit is generous on
 * purpose — a principal who mistypes their School ID three times is not an
 * attacker and must not be locked out for a day — and every rejected attempt
 * counts against it, so it has to leave room to fumble. That generosity is
 * exactly what makes it useless as a flood limit: five an hour is a hundred and
 * twenty a day. The daily window is the one that caps the damage.
 */
const registerRateLimit = rateLimit({ windowMs: 60 * 60_000, max: 5, key: clientIp, name: 'register:hour' });
const registerDailyRateLimit = rateLimit({ windowMs: 24 * 60 * 60_000, max: 10, key: clientIp, name: 'register:day' });

/**
 * Confirming a School ID is a read against a list DepEd publishes, so there is
 * nothing to keep secret here. The limit is about cost, not confidentiality:
 * without it the lookup is free CPU over a 60,000-row map.
 */
const schoolLookupRateLimit = rateLimit({ windowMs: 15 * 60_000, max: 60, key: clientIp, name: 'school-lookup' });
/**
 * Changing a password takes the current one, so it is a second place a password
 * can be guessed at. Keyed on the account rather than the address: the caller is
 * already authenticated, so who they claim to be is known and worth limiting
 * directly. Generous enough that genuinely mistyping the old password a few
 * times is not a lockout.
 */
const changePasswordRateLimit = rateLimit({
  windowMs: 15 * 60_000, max: 10, key: r => r.auth?.sub || clientIp(r),
});
/** The operator key is a single secret with no lockout behind it. */
const platformRateLimit = rateLimit({ windowMs: 15 * 60_000, max: 20, key: clientIp });
/** Higher than platformRateLimit: a live dashboard polls its aggregate endpoints on an interval. */
const devRateLimit = rateLimit({ windowMs: 15 * 60_000, max: 120, key: clientIp });

/**
 * Segments that come straight after /api/teacher or /api/student and name a
 * *route*, not a user. Everything else in that position is an id that has to
 * match the caller.
 */
const TEACHER_ROUTE_SEGMENTS = new Set([
  // 'assistant' is the AI Teacher Assistant chat; 'refine' is its legacy alias,
  // kept while older frontend builds are still loaded in browsers. Neither
  // reads a resource by id — both act on feedback text passed in the body —
  // so there is nothing here for an ownership check to compare against. The
  // rename shipped without adding 'assistant' here, which made every chat
  // message 403 with "You can only access your own classes."
  // 'sections', 'quick-setup' and 'extract-students' were here while teachers
  // built their own rosters and course shells. Creating a section or a class,
  // enrolling a learner, renaming one and resetting their password are all the
  // admin's now, and the teacher routes behind those three literals are gone —
  // so the literals go too, rather than sitting here keeping a door open onto
  // nothing. /api/teacher/:teacherId/sections is unaffected: seg[2] there is
  // the caller's own id, which is the case this set exists to except.
  'classes', 'activities', 'rubric-templates', 'rubric', 'upload', 'assistant', 'refine',
  'submissions', 'demo-data', 'student',
  // Batch AI checking: 'ai-jobs' addresses a job id and 'ai-capacity' takes no
  // id at all, so neither is a teacher id. Ownership of the underlying activity
  // and job is checked in the handlers.
  'ai-jobs', 'ai-capacity',
  // Teacher-authored badges. The list takes no id (it is always the caller's
  // own), and the update/delete shapes address a *badge* id, so ownership is
  // checked in those handlers against teacherId.
  'badges',
]);
const STUDENT_ROUTE_SEGMENTS = new Set(['submit']);

const deny = (res, error) => res.status(403).json({ success: false, code: 'FORBIDDEN', error });

/**
 * Enforces that the id in the URL belongs to the caller.
 *
 * This is the check that actually closes the hole. Authentication alone only
 * proves *someone* is signed in — without this, any logged-in student could
 * still read any other student's grades by changing a uuid in the path.
 */
function authorizePath(req, res, next) {
  if (isPublic(req.path)) return next();
  const { sub, role } = req.auth;
  const seg = req.path.split('/').filter(Boolean);   // e.g. ['api','admin','<id>','analytics']
  const area = seg[1];
  const own = (id) => id === sub;

  if (area === 'admin') {
    if (role !== 'ADMIN') return deny(res, 'This area is for school admins.');
    if (seg[2] && !own(seg[2])) return deny(res, 'You can only manage your own school.');
    return next();
  }

  if (area === 'teacher') {
    if (role !== 'TEACHER') return deny(res, 'This area is for teachers.');
    // GET /api/teacher/rubric-templates/<teacherId> lists a teacher's own
    // templates; PUT and DELETE on the same shape address a *template* id and
    // are checked against ownership in the handler instead.
    if (seg[2] === 'rubric-templates' && req.method === 'GET' && seg[3] && !own(seg[3])) {
      return deny(res, 'You can only read your own rubric templates.');
    }
    if (seg[2] && !TEACHER_ROUTE_SEGMENTS.has(seg[2]) && !own(seg[2])) {
      return deny(res, "You can only access your own classes.");
    }
    return next();
  }

  if (area === 'student') {
    // Teachers and admins legitimately read student data — the teacher
    // analytics screen charts a selected student's skill progress through the
    // same endpoint the student's own dashboard uses.
    if (role === 'STUDENT' && seg[2] && !STUDENT_ROUTE_SEGMENTS.has(seg[2]) && !own(seg[2])) {
      return deny(res, 'You can only see your own work.');
    }
    return next();
  }

  // A user's own school branding, whatever their role.
  if (area === 'users') {
    if (seg[2] && !own(seg[2])) return deny(res, 'You can only read your own profile.');
    return next();
  }

  // Class and activity rosters are staff-facing; students reach their work
  // through /api/student/... instead.
  if (area === 'classes' || area === 'activities') {
    if (role === 'STUDENT') return deny(res, 'This area is for teachers.');
    return next();
  }

  return next();
}

module.exports = {
  TOKEN_TTL_SECONDS,
  RENEWED_TOKEN_HEADER,
  dueForRenewal,
  signToken,
  verifyToken,
  authenticate,
  authorizePath,
  isPublic,
  configureRevocation,
  markRevoked,
  loginRateLimit,
  registerRateLimit,
  registerDailyRateLimit,
  schoolLookupRateLimit,
  platformRateLimit,
  devRateLimit,
  changePasswordRateLimit,
  // Exported so scripts/verify-route-authorization.js can check every
  // registered route against the same allowlist authorizePath() itself uses,
  // instead of keeping a second copy that can drift out of sync.
  TEACHER_ROUTE_SEGMENTS,
  STUDENT_ROUTE_SEGMENTS,
};
