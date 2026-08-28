import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const rule = require('../passwordRule.js');
const { passwordProblem, passwordStrength, passwordChecklist } = rule;

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_COPY = join(HERE, '..', '..', 'src', 'constants', 'password.js');

/**
 * What the system will accept as a password.
 *
 * QA logged this as "no handler for weak password": every route that set one
 * checked `length >= 6` and nothing else, so `123456` was accepted for an
 * account that can read every child's marks at a school. The rule is now eight
 * characters with a small letter, a capital and a number, applied at all nine
 * places a human chooses a password.
 *
 * Two things below are not about the rule itself but about the ways it can be
 * quietly broken, and both are bugs this file exists to prevent:
 *
 *   1. The client copy drifting from this one. src/constants/password.js is
 *      what the form uses to tick requirements off live; if it is looser it
 *      promises a password the server then refuses, and if it is stricter it
 *      refuses one the server would have taken.
 *   2. generatePassword() producing something the rule rejects. It used to
 *      draw ten characters from a mixed alphabet, which yields no digit about
 *      one time in five — so the app would have handed an admin a temporary
 *      password its own server bounced.
 */
describe('what counts as an acceptable password', () => {
  it('refuses the ones QA called out', () => {
    expect(passwordProblem('123456')).toMatch(/at least 8/);
    expect(passwordProblem('password')).toBeTruthy();
    expect(passwordProblem('abc')).toBeTruthy();
    expect(passwordProblem('')).toBeTruthy();
  });

  it('names the class that is missing rather than restating the length', () => {
    expect(passwordProblem('password1')).toMatch(/capital/);
    expect(passwordProblem('PASSWORD1')).toMatch(/small/);
    expect(passwordProblem('Passwords')).toMatch(/number/);
  });

  it('accepts eight characters with a small letter, a capital and a number', () => {
    expect(passwordProblem('Password1')).toBeNull();
    expect(passwordProblem('Tulong123')).toBeNull();
    expect(passwordProblem('aB3aB3aB')).toBeNull();
  });

  it('does not require a symbol', () => {
    // Deliberate: these are typed on shared classroom keyboards, and a symbol
    // requirement is where people start writing passwords on sticky notes.
    expect(passwordProblem('Password1')).toBeNull();
  });

  it('refuses what bcrypt would silently truncate', () => {
    // Past 72 bytes bcrypt ignores the rest, so two different passwords
    // sharing a 72-byte prefix would unlock the same account.
    expect(passwordProblem('A1' + 'x'.repeat(71))).toMatch(/too long/);
    expect(passwordProblem('A1' + 'x'.repeat(60))).toBeNull();
  });
});

describe('the strength meter', () => {
  it('scores anything failing the rule at zero', () => {
    expect(passwordStrength('123456').score).toBe(0);
    expect(passwordStrength('password').score).toBe(0);
  });

  it('rewards length and variety above the floor without gating on them', () => {
    const bare = passwordStrength('Passwor1').score;
    const longer = passwordStrength('PasswordLong1').score;
    const symbols = passwordStrength('PasswordLong1!').score;
    expect(bare).toBeGreaterThan(0);
    expect(longer).toBeGreaterThan(bare);
    expect(symbols).toBeGreaterThan(longer);
  });

  it('does not call a repeated run strong just because it is long', () => {
    expect(passwordStrength('aaaaaaaaaaaaA1').score).toBe(1);
  });

  it('lists four requirements, in a stable order', () => {
    const ids = passwordChecklist('x').map((c) => c.id);
    expect(ids).toEqual(['length', 'lower', 'upper', 'digit']);
  });
});

describe('the client copy stays in step with this one', () => {
  // The mirror is ESM for the browser; load it by stripping the export
  // keywords rather than adding a build step to the test.
  const source = readFileSync(CLIENT_COPY, 'utf8').replace(/export (function|const)/g, '$1');
  const client = new Function(
    'crypto',
    source + '; return { passwordProblem, passwordStrength, generatePassword };'
  )(globalThis.crypto);

  const CASES = [
    '', '1', '123456', 'password', 'Password', 'password1', 'PASSWORD1',
    'Password1', 'Tulong123', 'Password123!', 'aaaaaaaA1', 'aB3aB3aB',
    'A1' + 'x'.repeat(71),
  ];

  it('agrees on every verdict', () => {
    for (const c of CASES) {
      expect([c, client.passwordProblem(c)]).toEqual([c, passwordProblem(c)]);
    }
  });

  it('agrees on every score', () => {
    for (const c of CASES) {
      expect([c, client.passwordStrength(c).score]).toEqual([c, passwordStrength(c).score]);
    }
  });

  it('never generates a password the server would refuse', () => {
    for (let i = 0; i < 2000; i++) {
      const generated = client.generatePassword(10);
      expect(passwordProblem(generated)).toBeNull();
    }
    for (let i = 0; i < 500; i++) {
      expect(passwordProblem(client.generatePassword(12))).toBeNull();
    }
  });
});

describe("a student's issued default is exempt", () => {
  it('is a birthday, which would not itself pass the rule', () => {
    // Documented on purpose. The default is generated and handed out, never
    // posted to a route that validates; the rule governs what a student
    // CHOOSES to replace it with. If this ever starts passing, someone has
    // changed birthdayPassword and the exemption needs revisiting.
    const birthday = '03152014';
    expect(passwordProblem(birthday)).toBeTruthy();
  });
});
