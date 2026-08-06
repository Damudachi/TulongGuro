import { describe, it, expect } from 'vitest';
import serverGrading from '../grading.js';
import { bandFor, bandsFor, isPassing, DEFAULT_PASSING_GRADE } from '../../src/utils/grading.js';

/**
 * The client and the server each carry their own copy of the DepEd descriptor
 * ladder — server/grading.js decides analytics and at-risk, src/utils/grading.js
 * decides what colour a score renders. They are separate because one adds
 * presentation and the other must stay dependency-free, and the comments on
 * both say to keep them in step.
 *
 * They had drifted. bandKeyFor rounded before comparing; bandFor did not. Since
 * scores are stored unrounded and displayed rounded, a 74.6 against a passing
 * line of 75 showed as "75", counted as passing on the server, and was coloured
 * as a failure in the browser.
 *
 * This suite runs the two implementations against each other rather than
 * asserting a hand-written table, so a future edit to either one fails here.
 */

const PASSING_GRADES = [70, 75, 80, 85, 90, 95];

describe('client and server agree on the shape of the ladder', () => {
  it('produces the same band keys in the same order at every passing grade', () => {
    for (const passing of PASSING_GRADES) {
      expect(bandsFor(passing).map(b => b.key), `passing=${passing}`)
        .toEqual(serverGrading.descriptorBands(passing).map(b => b.key));
    }
  });

  it('puts the same minimum on every rung', () => {
    for (const passing of PASSING_GRADES) {
      expect(bandsFor(passing).map(b => b.min), `passing=${passing}`)
        .toEqual(serverGrading.descriptorBands(passing).map(b => b.min));
    }
  });
});

describe('client and server agree on which band a score falls into', () => {
  it('matches across the whole scale in whole points', () => {
    for (const passing of PASSING_GRADES) {
      for (let score = 0; score <= 100; score++) {
        expect(bandFor(score, passing)?.key ?? null, `score=${score} passing=${passing}`)
          .toBe(serverGrading.bandKeyFor(score, passing));
      }
    }
  });

  it('matches on fractional scores, which is where they used to differ', () => {
    // Scores are stored unrounded, so these are the values that actually occur:
    // 7/30 is 23.333…, 22/30 is 73.333…, and so on.
    const fractional = [];
    for (let n = 0; n <= 1000; n++) fractional.push(n / 10);

    for (const passing of PASSING_GRADES) {
      for (const score of fractional) {
        expect(bandFor(score, passing)?.key ?? null, `score=${score} passing=${passing}`)
          .toBe(serverGrading.bandKeyFor(score, passing));
      }
    }
  });

  it('agrees on the exact case that was broken', () => {
    // 74.6 rounds to 75, which is the passing line.
    expect(bandFor(74.6, 75).key).toBe('passing');
    expect(serverGrading.bandKeyFor(74.6, 75)).toBe('passing');
    // 74.4 rounds to 74 and is genuinely below it.
    expect(bandFor(74.4, 75).key).toBe('failing');
    expect(serverGrading.bandKeyFor(74.4, 75)).toBe('failing');
  });

  it('treats ungraded as null on both sides, never as failing', () => {
    expect(bandFor(null, 75)).toBeNull();
    expect(bandFor(undefined, 75)).toBeNull();
    expect(serverGrading.bandKeyFor(null, 75)).toBeNull();
    expect(serverGrading.bandKeyFor(undefined, 75)).toBeNull();
  });
});

describe('isPassing agrees with the band it renders', () => {
  it('never colours a passing mark as a failure, or the reverse', () => {
    for (const passing of PASSING_GRADES) {
      for (let n = 0; n <= 1000; n++) {
        const score = n / 10;
        const passes = isPassing(score, passing);
        const failing = bandFor(score, passing)?.key === 'failing';
        expect(passes, `score=${score} passing=${passing}`).toBe(!failing);
      }
    }
  });

  it('matches computeGrade, which is what actually decides a report card', () => {
    for (const passing of [70, 75, 80]) {
      for (let n = 0; n <= 1000; n++) {
        const score = n / 10;
        const server = serverGrading.computeGrade(
          [{ percent: score, points: 100, component: 'WW' }],
          { WW: 30, PT: 50, QA: 20 },
          { transmute: false, passing }
        );
        expect(isPassing(score, passing), `score=${score} passing=${passing}`)
          .toBe(server.isPassing);
      }
    }
  });

  it('is null for ungraded, not false', () => {
    expect(isPassing(null)).toBeNull();
    expect(isPassing(undefined)).toBeNull();
  });

  it('falls back to the DepEd default only when given nothing usable', () => {
    expect(DEFAULT_PASSING_GRADE).toBe(serverGrading.PASSING_GRADE);
    expect(isPassing(75, undefined)).toBe(true);
    expect(isPassing(74, undefined)).toBe(false);
  });
});
