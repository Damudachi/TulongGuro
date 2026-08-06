import { describe, it, expect } from 'vitest';
import grading from '../grading.js';

const { clampScore, MIN_SCORE, MAX_SCORE, starsForScore, bandKeyFor, computeGrade } = grading;

/**
 * The AI's headline number, bounded.
 *
 * `aiScore` was written straight out of the model's parsed JSON with no check
 * at all, while the rubric that produces it had been validated by
 * validateRubric since that function existed. The prompt makes the 0-100
 * scaling the model's own job, so an out-of-range total is not exotic — it is
 * what happens when a rubric's criteria don't sum to 100.
 */

describe('clampScore', () => {
  it('passes a valid score through untouched and unflagged', () => {
    expect(clampScore(87)).toEqual({ score: 87, changed: false });
    expect(clampScore(0)).toEqual({ score: 0, changed: false });
    expect(clampScore(100)).toEqual({ score: 100, changed: false });
  });

  it('keeps fractional precision — scores are stored unrounded on purpose', () => {
    expect(clampScore(23.333333)).toEqual({ score: 23.333333, changed: false });
  });

  it('caps a score above the maximum and says it did', () => {
    expect(clampScore(120)).toEqual({ score: 100, changed: true });
    expect(clampScore(101)).toEqual({ score: 100, changed: true });
  });

  it('floors a negative score and says it did', () => {
    expect(clampScore(-5)).toEqual({ score: 0, changed: true });
  });

  it('treats anything that is not a real number as garbage, and flags it', () => {
    // Submission.aiScore is a Float column: a NaN or a string is a 500 at the
    // Prisma layer, which reads to the teacher as an outage rather than a
    // grading problem.
    for (const junk of ['abc', NaN, Infinity, -Infinity, {}, [], true, false]) {
      expect(clampScore(junk)).toEqual({ score: MIN_SCORE, changed: true });
    }
  });

  it('flags a MISSING score instead of recording a silent zero', () => {
    // The trap: Number(null) and Number('') are both 0, a perfectly valid
    // score. Coercing first would turn "the model returned no score" into a
    // genuine-looking zero for the student with changed:false, so nothing
    // would warn the teacher.
    expect(Number(null)).toBe(0);           // documents why the type check exists
    expect(Number('')).toBe(0);

    expect(clampScore(null)).toEqual({ score: MIN_SCORE, changed: true });
    expect(clampScore(undefined)).toEqual({ score: MIN_SCORE, changed: true });
    expect(clampScore('')).toEqual({ score: MIN_SCORE, changed: true });
    // A real zero from the model — a blank paper — stays unflagged.
    expect(clampScore(0)).toEqual({ score: 0, changed: false });
  });

  it('always returns something storable', () => {
    for (const input of [120, -5, 'abc', null, undefined, NaN, Infinity, 87, 0, 100]) {
      const { score } = clampScore(input);
      expect(Number.isFinite(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(MIN_SCORE);
      expect(score).toBeLessThanOrEqual(MAX_SCORE);
    }
  });
});

describe('what an unclamped score used to do downstream', () => {
  it('no longer awards stars off an impossible score', () => {
    // 120 banded as "outstanding" and paid out 3 stars, same as a real 95.
    const { score } = clampScore(120);
    expect(starsForScore(score, 75)).toBe(starsForScore(100, 75));
  });

  it('no longer pushes a class average above 100', () => {
    const { score } = clampScore(120);
    const { initialGrade } = computeGrade(
      [{ percent: score, points: 100, component: 'WW' }],
      { WW: 30, PT: 50, QA: 20 },
      { transmute: false }
    );
    expect(initialGrade).toBeLessThanOrEqual(100);
  });

  it('still bands a clamped score, rather than returning null', () => {
    const { score } = clampScore(120);
    expect(bandKeyFor(score, 75)).toBe('outstanding');
  });
});

describe('clampScore and parseScore answer the same bad input differently, on purpose', () => {
  it('refuses a teacher score but keeps a clamped AI score', () => {
    // A teacher sending 120 is a caller bug worth a 400 — rewriting their
    // submitted mark would be worse than telling them. The AI doing it is a
    // fact about a paper already read; discarding it would throw away the
    // rubric breakdown and feedback that came with it, and a human reviews it
    // before it becomes a grade anyway.
    expect(grading.parseScore(120)).toBeNull();
    expect(clampScore(120)).toEqual({ score: 100, changed: true });
  });
});
