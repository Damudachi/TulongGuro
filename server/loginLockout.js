/**
 * loginLockout.js — consecutive-failure lockout for /api/auth/login.
 *
 * The rate limiters in auth.js cap how *fast* the login endpoint can be
 * called. They do not cap how many times one account can be guessed at: a
 * limiter keyed on IP+username refills every 15 minutes forever, so a patient
 * attacker with one address still gets 960 guesses a day against a known
 * username. This stops a run of failures against a single account, which is a
 * different question from how busy the endpoint is, and so it is a different
 * mechanism rather than a tighter number on the existing one.
 *
 * ── Why the two roles have very different thresholds ──
 *
 * A staff password is a real secret: passwordRule.js forces eight characters
 * with mixed case and a digit, and nobody but the account holder should know
 * it. Five wrong ones in a row is already well past a typo.
 *
 * A pupil's password is not a secret in the same sense. It is seeded from
 * their birthday (see the `birthdate` note on the User model), which the
 * schema itself records as "knowable by classmates", and their username is a
 * sequential ID copied off a printed slip. That inverts what a lockout is for.
 * Against a classmate who already knows the birthday it buys nothing, and a
 * long lock on a child's account is a weapon any bored seatmate can pick up —
 * type a wrong password often enough into somebody's ID and they are out of a
 * graded activity. So the student threshold is high and the lock is short:
 * enough to make scripted guessing pointless, not enough to be worth doing to
 * a classmate for fun. What actually protects those accounts is the
 * password-change prompt on the roster screen, not this file.
 *
 * ── In-process, and therefore per-instance ──
 *
 * Same caveat as the rate limiters, and said as plainly here: the counters
 * live in this process. On one Render service (`numInstances: 1` in
 * render.yaml) that is the whole application, but behind several instances
 * each would keep its own tally and the effective threshold would multiply by
 * the instance count. A deploy also restarts the process and clears every
 * counter. Persisting this would mean columns on User and a `prisma db push`
 * against the live table with no rollback path, which is not worth it for a
 * mechanism whose job is to blunt sustained automated guessing — an attacker
 * cannot make us deploy. A shared store (Redis) is the fix if this ever runs
 * on more than one instance.
 */

/** Five wrong passwords in a row, then a quarter of an hour. */
const STAFF_MAX_FAILURES = 5;
const STAFF_LOCKOUT_MS = 15 * 60_000;

/** Ten, then five minutes. See the note above on why a pupil is not a teacher. */
const STUDENT_MAX_FAILURES = 10;
const STUDENT_LOCKOUT_MS = 5 * 60_000;

/**
 * How long a run of failures stays a *run*.
 *
 * Without this the count is cumulative over the life of the process, so a
 * teacher who mistypes twice on Monday, twice on Wednesday and once on Friday
 * is locked out on Friday for no reason a human would recognise. "Consecutive"
 * has to mean consecutive in time as well as in sequence. Staff get the longer
 * memory because their threshold is lower and there is more to protect.
 */
const STAFF_COUNTER_IDLE_MS = 60 * 60_000;
const STUDENT_COUNTER_IDLE_MS = 30 * 60_000;

const STUDENT_POLICY = {
  maxFailures: STUDENT_MAX_FAILURES,
  lockoutMs: STUDENT_LOCKOUT_MS,
  idleMs: STUDENT_COUNTER_IDLE_MS,
};
const STAFF_POLICY = {
  maxFailures: STAFF_MAX_FAILURES,
  lockoutMs: STAFF_LOCKOUT_MS,
  idleMs: STAFF_COUNTER_IDLE_MS,
};

/** Anything that is not a pupil is held to the staff rule, including a role
 *  that arrived missing or unrecognised — the stricter of the two is the safe
 *  way to be wrong about who is knocking. */
const policyFor = (role) => (role === 'STUDENT' ? STUDENT_POLICY : STAFF_POLICY);

/**
 * The bucket a typed username counts against.
 *
 * It has to fold together every spelling the login route is willing to resolve
 * to one account, or the lockout is bypassable by exactly the accounts with
 * the weakest passwords. The student lookup accepts "as-26-0001", "AS 26 0001"
 * and "as260001" as the same child (see relaxedStudentId in server.js), so if
 * each of those kept its own tally, ten guesses would become thirty by varying
 * the punctuation. Staff sign in with an email address, which is matched
 * case-insensitively, so lowercasing is the whole of it there.
 *
 * Keyed on what was *typed*, never on a resolved user row, so an account that
 * does not exist is counted too. That is deliberate: a lockout that only ever
 * happens to real accounts is a way of asking which usernames are real.
 *
 * Known and accepted gap: the login route also resolves a pre-slug staff
 * address (irma@teacher.edu.ph) to its coded account, and those two spellings
 * land in different buckets, so such an account has two runs of five rather
 * than one. Folding them would mean knowing the school code before the lookup,
 * which is the lookup. Left alone because it doubles the attempts against a
 * password that passwordRule.js already made strong, on a fallback that is a
 * deliberate transition — deleting that fallback closes this with it.
 */
function lockoutKey(username, role) {
  const typed = String(username ?? '').trim();
  if (!typed || typed.length > 128) return null;
  if (role === 'STUDENT') return `STUDENT|${typed.replace(/[ ._-]+/g, '').toUpperCase()}`;
  return `${role === 'ADMIN' ? 'ADMIN' : 'TEACHER'}|${typed.toLowerCase()}`;
}

const lockoutBuckets = new Map();   // key -> { failures, lastFailureAt, lockedUntil }

/** Nothing is locked; the shape callers can rely on either way. */
const OPEN = { locked: false, retryAfterSeconds: 0 };

const lockedFor = (until, now) => ({
  locked: true,
  retryAfterSeconds: Math.max(1, Math.ceil((until - now) / 1000)),
});

/**
 * Is this username currently locked out? Call before checking the password —
 * bcrypt.compare is deliberately expensive, and an account under attack should
 * not still be buying a hash per attempt once it is locked.
 */
function checkLockout(username, role, now = Date.now()) {
  const key = lockoutKey(username, role);
  if (!key) return OPEN;
  const bucket = lockoutBuckets.get(key);
  if (!bucket) return OPEN;
  if (bucket.lockedUntil > now) return lockedFor(bucket.lockedUntil, now);
  // The lock has run out. Dropping the row rather than leaving it at zero
  // means the next window starts from a clean count — flat thresholds, no
  // escalation: whoever this is gets the full set of attempts again.
  if (bucket.lockedUntil) lockoutBuckets.delete(key);
  return OPEN;
}

/**
 * Record one failed sign-in and report where that leaves the account. The
 * state returned describes the attempt that has *just* failed, so the attempt
 * which trips the threshold is still refused as "invalid credentials" and the
 * lock is what the next one meets. Announcing the lock on the tripping attempt
 * would tell whoever is guessing exactly which try was their last, which is a
 * hint worth not giving.
 */
function recordFailure(username, role, now = Date.now()) {
  const key = lockoutKey(username, role);
  if (!key) return OPEN;
  const policy = policyFor(role);

  let bucket = lockoutBuckets.get(key);
  if (bucket && bucket.lockedUntil > now) return lockedFor(bucket.lockedUntil, now);
  // A fresh run: either nothing here, or a lock that has since expired, or
  // failures old enough that they are no longer consecutive.
  if (!bucket || bucket.lockedUntil || now - bucket.lastFailureAt > policy.idleMs) {
    bucket = { failures: 0, lastFailureAt: now, lockedUntil: 0 };
    lockoutBuckets.set(key, bucket);
  }

  bucket.failures++;
  bucket.lastFailureAt = now;
  if (bucket.failures >= policy.maxFailures) {
    bucket.lockedUntil = now + policy.lockoutMs;
    bucket.failures = 0;
    return lockedFor(bucket.lockedUntil, now);
  }
  return OPEN;
}

/** A correct password ends the run. Called on every successful sign-in. */
function clearFailures(username, role) {
  const key = lockoutKey(username, role);
  if (key) lockoutBuckets.delete(key);
}

/** How long a caller should be told to wait, in whole minutes, never zero. */
const retryAfterMinutes = (seconds) => Math.max(1, Math.ceil(seconds / 60));

// Unbounded growth would be a memory leak an attacker controls — the key is
// whatever they typed — so spent buckets are swept. unref() so this never
// holds the process open on shutdown, matching the sweeper in auth.js.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [k, b] of lockoutBuckets) {
    const spent = b.lockedUntil
      ? b.lockedUntil <= now
      : now - b.lastFailureAt > STAFF_COUNTER_IDLE_MS;
    if (spent) lockoutBuckets.delete(k);
  }
}, 60_000);
if (typeof sweeper.unref === 'function') sweeper.unref();

/** Tests only: drop every counter so one case cannot leak into the next. */
function _resetLockouts() { lockoutBuckets.clear(); }

module.exports = {
  STAFF_MAX_FAILURES,
  STAFF_LOCKOUT_MS,
  STUDENT_MAX_FAILURES,
  STUDENT_LOCKOUT_MS,
  STAFF_COUNTER_IDLE_MS,
  STUDENT_COUNTER_IDLE_MS,
  lockoutKey,
  checkLockout,
  recordFailure,
  clearFailures,
  retryAfterMinutes,
  _resetLockouts,
};
