import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const {
  STAFF_MAX_FAILURES, STAFF_LOCKOUT_MS,
  STUDENT_MAX_FAILURES, STUDENT_LOCKOUT_MS,
  STAFF_COUNTER_IDLE_MS, STUDENT_COUNTER_IDLE_MS,
  lockoutKey, checkLockout, recordFailure, clearFailures, retryAfterMinutes,
  _resetLockouts,
} = require('../loginLockout.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_JS = join(HERE, '..', 'server.js');

const MINUTE = 60_000;

/** Drive n failures from a fixed instant, one second apart. Returns the state
 *  after the last one. */
function failTimes(n, { username, role, from = 1_000_000 }) {
  let state;
  for (let i = 0; i < n; i++) state = recordFailure(username, role, from + i * 1000);
  return state;
}

/**
 * The consecutive-failure lockout on /api/auth/login.
 *
 * The rate limiters in auth.js bound how busy the endpoint is; this bounds how
 * many times one account can be guessed at, which is a different question. The
 * numbers are deliberately asymmetric and the reason is in loginLockout.js:
 * staff passwords are real secrets, a pupil's is seeded from their birthday and
 * the schema itself says classmates know it — so a long lock on a child is a
 * bullying tool, not a defence.
 *
 * Three things here are not about the thresholds but about ways the lockout
 * can be quietly made useless, and each is a bug this file exists to prevent:
 *
 *   1. Separator-varying on a student ID. The login route resolves
 *      "as-26-0001", "AS 26 0001" and "as260001" to one child; if each kept
 *      its own tally, ten guesses would become thirty.
 *   2. Counting only accounts that exist, which turns the lockout into a way
 *      of asking which usernames are real.
 *   3. The counter never expiring, which locks out a teacher who mistyped
 *      twice on Monday and three times on Friday.
 */
describe('login lockout thresholds', () => {
  beforeEach(() => _resetLockouts());

  it('holds staff to five consecutive failures and then fifteen minutes', () => {
    const username = 'principal@admin.mes-maba.edu.ph';
    expect(STAFF_MAX_FAILURES).toBe(5);
    expect(STAFF_LOCKOUT_MS).toBe(15 * MINUTE);

    const beforeLast = failTimes(STAFF_MAX_FAILURES - 1, { username, role: 'ADMIN' });
    expect(beforeLast.locked).toBe(false);
    expect(checkLockout(username, 'ADMIN', 1_100_000).locked).toBe(false);

    failTimes(STAFF_MAX_FAILURES, { username, role: 'ADMIN' });
    const now = 1_000_000 + (STAFF_MAX_FAILURES - 1) * 1000;
    const state = checkLockout(username, 'ADMIN', now);
    expect(state.locked).toBe(true);
    expect(retryAfterMinutes(state.retryAfterSeconds)).toBe(15);
  });

  it('holds pupils to ten consecutive failures and then five minutes', () => {
    const username = 'AS-26-0001';
    expect(STUDENT_MAX_FAILURES).toBe(10);
    expect(STUDENT_LOCKOUT_MS).toBe(5 * MINUTE);

    const beforeLast = failTimes(STUDENT_MAX_FAILURES - 1, { username, role: 'STUDENT' });
    expect(beforeLast.locked).toBe(false);

    failTimes(STUDENT_MAX_FAILURES, { username, role: 'STUDENT' });
    const now = 1_000_000 + (STUDENT_MAX_FAILURES - 1) * 1000;
    const state = checkLockout(username, 'STUDENT', now);
    expect(state.locked).toBe(true);
    expect(retryAfterMinutes(state.retryAfterSeconds)).toBe(5);
  });

  it('gives a pupil more room than a teacher, not less', () => {
    // The asymmetry is the point of the file — if someone ever "tidies" these
    // to one shared number, this is what should stop them.
    expect(STUDENT_MAX_FAILURES).toBeGreaterThan(STAFF_MAX_FAILURES);
    expect(STUDENT_LOCKOUT_MS).toBeLessThan(STAFF_LOCKOUT_MS);
  });

  it('treats a role it does not recognise as staff', () => {
    // Being wrong about who is knocking should fail towards the stricter rule.
    failTimes(STAFF_MAX_FAILURES, { username: 'someone@example.com', role: undefined });
    const now = 1_000_000 + STAFF_MAX_FAILURES * 1000;
    expect(checkLockout('someone@example.com', undefined, now).locked).toBe(true);
  });
});

describe('what counts as the same username', () => {
  beforeEach(() => _resetLockouts());

  it('folds every spelling of a student ID into one tally', () => {
    // The tolerances relaxedStudentId() grants on the way in have to be
    // granted here too, or the weakest passwords on the platform get three
    // times the attempts by varying punctuation.
    const spellings = ['AS-26-0001', 'as-26-0001', 'AS 26 0001', 'as260001', 'As_26_0001'];
    const keys = new Set(spellings.map(s => lockoutKey(s, 'STUDENT')));
    expect(keys.size).toBe(1);

    let at = 1_000_000;
    for (let i = 0; i < STUDENT_MAX_FAILURES; i++) {
      recordFailure(spellings[i % spellings.length], 'STUDENT', at);
      at += 1000;
    }
    expect(checkLockout('AS-26-0001', 'STUDENT', at).locked).toBe(true);
  });

  it('matches a staff address regardless of case', () => {
    expect(lockoutKey('Principal@Admin.MES-MABA.edu.ph', 'ADMIN'))
      .toBe(lockoutKey('principal@admin.mes-maba.edu.ph', 'ADMIN'));
  });

  it('keeps a teacher and a pupil who typed the same string apart', () => {
    expect(lockoutKey('abc', 'STUDENT')).not.toBe(lockoutKey('abc', 'TEACHER'));
  });

  it('counts a username that matches no account', () => {
    // A lockout that can only happen to real accounts is an oracle for which
    // usernames exist. Nothing here ever sees a User row.
    expect(lockoutKey('no-such-person@admin.example.edu.ph', 'ADMIN')).toBeTruthy();
    failTimes(STAFF_MAX_FAILURES, { username: 'no-such-person@admin.example.edu.ph', role: 'ADMIN' });
    const now = 1_000_000 + STAFF_MAX_FAILURES * 1000;
    expect(checkLockout('no-such-person@admin.example.edu.ph', 'ADMIN', now).locked).toBe(true);
  });

  it('refuses to bucket an empty or absurd username', () => {
    expect(lockoutKey('', 'ADMIN')).toBeNull();
    expect(lockoutKey('   ', 'ADMIN')).toBeNull();
    expect(lockoutKey('x'.repeat(129), 'ADMIN')).toBeNull();
    // And recording against one is a no-op rather than a throw.
    expect(recordFailure('', 'ADMIN').locked).toBe(false);
  });
});

describe('when a run of failures ends', () => {
  beforeEach(() => _resetLockouts());

  it('is cleared by a correct password', () => {
    const username = 'teacher@teacher.mes-maba.edu.ph';
    failTimes(STAFF_MAX_FAILURES - 1, { username, role: 'TEACHER' });
    clearFailures(username, 'TEACHER');
    // Back to a full set of attempts: four more must not lock.
    const state = failTimes(STAFF_MAX_FAILURES - 1, { username, role: 'TEACHER', from: 2_000_000 });
    expect(state.locked).toBe(false);
  });

  it('forgets failures that are no longer consecutive in time', () => {
    const username = 'teacher@teacher.mes-maba.edu.ph';
    failTimes(STAFF_MAX_FAILURES - 1, { username, role: 'TEACHER', from: 1_000_000 });
    // Same account, the next day. Monday's typos are not Friday's.
    const later = 1_000_000 + STAFF_COUNTER_IDLE_MS + MINUTE;
    expect(recordFailure(username, 'TEACHER', later).locked).toBe(false);
    expect(checkLockout(username, 'TEACHER', later).locked).toBe(false);
  });

  it('gives pupils the shorter memory', () => {
    expect(STUDENT_COUNTER_IDLE_MS).toBeLessThan(STAFF_COUNTER_IDLE_MS);
  });

  it('opens again when the lock expires, with the count reset', () => {
    const username = 'AS-26-0001';
    failTimes(STUDENT_MAX_FAILURES, { username, role: 'STUDENT' });
    const lockedAt = 1_000_000 + (STUDENT_MAX_FAILURES - 1) * 1000;
    expect(checkLockout(username, 'STUDENT', lockedAt).locked).toBe(true);

    const after = lockedAt + STUDENT_LOCKOUT_MS + 1000;
    expect(checkLockout(username, 'STUDENT', after).locked).toBe(false);
    // Flat, not escalating: the next window is a full ten again.
    const state = failTimes(STUDENT_MAX_FAILURES - 1, { username, role: 'STUDENT', from: after });
    expect(state.locked).toBe(false);
  });

  it('does not let more failures extend a lock that is already running', () => {
    // Otherwise anyone able to keep posting could hold a teacher out
    // indefinitely by hammering the endpoint for the whole fifteen minutes.
    const username = 'principal@admin.mes-maba.edu.ph';
    failTimes(STAFF_MAX_FAILURES, { username, role: 'ADMIN' });
    const lockedAt = 1_000_000 + (STAFF_MAX_FAILURES - 1) * 1000;
    const firstEnd = lockedAt + checkLockout(username, 'ADMIN', lockedAt).retryAfterSeconds * 1000;

    recordFailure(username, 'ADMIN', lockedAt + MINUTE);
    const stillEnds = lockedAt + MINUTE
      + checkLockout(username, 'ADMIN', lockedAt + MINUTE).retryAfterSeconds * 1000;
    expect(Math.abs(stillEnds - firstEnd)).toBeLessThanOrEqual(1000);
  });
});

describe('how the login route uses it', () => {
  const source = readFileSync(SERVER_JS, 'utf8');

  it('checks the lock before spending a bcrypt compare', () => {
    const lockAt = source.indexOf('checkLockout(username, role)');
    const compareAt = source.indexOf('bcrypt.compare(password, user.password)');
    expect(lockAt).toBeGreaterThan(-1);
    expect(compareAt).toBeGreaterThan(-1);
    expect(lockAt).toBeLessThan(compareAt);
  });

  it('answers a locked account with 423 and a code the login screen can read', () => {
    expect(source).toMatch(/status\(423\)[\s\S]{0,120}ACCOUNT_LOCKED/);
  });

  it('records a failure on bad credentials and clears the run on success', () => {
    expect(source).toContain('recordFailure(username, role)');
    expect(source).toContain('clearFailures(username, role)');
  });

  it('never tells the caller how many attempts are left', () => {
    // Naming the remaining count tells whoever is guessing exactly how far
    // they can push before the next lock — and which try was their last.
    expect(source).not.toMatch(/attempts?\s+(remaining|left)/i);
  });
});

/** The minutes shown to a person. Never "0 minutes", which reads as "no wait". */
describe('the wait a person is told about', () => {
  it('rounds up and never shows zero', () => {
    expect(retryAfterMinutes(0)).toBe(1);
    expect(retryAfterMinutes(1)).toBe(1);
    expect(retryAfterMinutes(60)).toBe(1);
    expect(retryAfterMinutes(61)).toBe(2);
    expect(retryAfterMinutes(15 * 60)).toBe(15);
  });
});
