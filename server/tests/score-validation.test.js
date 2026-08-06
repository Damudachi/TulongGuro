import { describe, it, expect } from 'vitest';
import grading from '../grading.js';

const { isValidScore, MIN_SCORE, MAX_SCORE } = grading;

/**
 * The range rule for a stored score. `PUT /api/teacher/submissions/:id/grade`
 * used to do `Number(hitlScore)` and write whatever came back, so a malformed
 * or hostile request could put 500 — or NaN — into the grade of record, where
 * it propagates into the class average, the descriptor band, the star award
 * and the export before anyone notices.
 */

describe('isValidScore', () => {
  it('accepts the full percentage range including both ends', () => {
    expect(isValidScore(0)).toBe(true);
    expect(isValidScore(100)).toBe(true);
    expect(isValidScore(74.6)).toBe(true);
    expect(isValidScore(MIN_SCORE)).toBe(true);
    expect(isValidScore(MAX_SCORE)).toBe(true);
  });

  it('rejects values outside the range', () => {
    expect(isValidScore(101)).toBe(false);
    expect(isValidScore(500)).toBe(false);
    expect(isValidScore(-1)).toBe(false);
  });

  it('rejects NaN, which every hand-written range check lets through', () => {
    // NaN fails all comparisons, so `x >= 0 && x <= 100` is false — but
    // `!(x < 0 || x > 100)` is true. Number.isFinite removes the trap entirely.
    expect(isValidScore(NaN)).toBe(false);
    expect(isValidScore(Number('abc'))).toBe(false);
    expect(isValidScore(Number(undefined))).toBe(false);
  });

  it('rejects the infinities', () => {
    expect(isValidScore(Infinity)).toBe(false);
    expect(isValidScore(-Infinity)).toBe(false);
  });

  it('rejects non-numbers rather than coercing them', () => {
    // The endpoint coerces with Number() first and validates the result, so
    // these are what reaches it after a coercion that produced nothing usable.
    expect(isValidScore(null)).toBe(false);
    expect(isValidScore(undefined)).toBe(false);
    expect(isValidScore('85')).toBe(false);
    expect(isValidScore({})).toBe(false);
    expect(isValidScore([])).toBe(false);
  });
});

describe('parseScore — what the validate endpoint accepts from a request body', () => {
  const { parseScore } = grading;

  it('accepts the shapes the review screen actually sends', () => {
    expect(parseScore(85)).toBe(85);
    expect(parseScore('85')).toBe(85);     // form values arrive as strings
    expect(parseScore(76.7)).toBe(76.7);   // scorePercent is derived arithmetic
    expect(parseScore(0)).toBe(0);         // a validated zero is a real mark
    expect(parseScore(100)).toBe(100);
  });

  it('keeps the fraction rather than truncating it', () => {
    // 7 out of a 30-point activity is 23.33%. Rounding here would cost the
    // student the difference on every points -> percent -> points round trip.
    expect(parseScore(23.333333)).toBeCloseTo(23.333333, 6);
  });

  it('refuses values outside the range', () => {
    expect(parseScore(500)).toBeNull();
    expect(parseScore(-5)).toBeNull();
    expect(parseScore('101')).toBeNull();
  });

  it('refuses anything that is not a number, instead of coercing it to zero', () => {
    // Every one of these coerces to 0 through Number(), which is a valid score.
    // Coerce-then-validate would have written a failing grade for a student
    // whose mark simply was not sent.
    expect(Number(null)).toBe(0);          // documents why the guard is needed
    expect(Number('')).toBe(0);
    expect(Number([])).toBe(0);

    expect(parseScore(null)).toBeNull();
    expect(parseScore(undefined)).toBeNull();
    expect(parseScore('')).toBeNull();
    expect(parseScore('   ')).toBeNull();
    expect(parseScore([])).toBeNull();
    expect(parseScore({})).toBeNull();
    expect(parseScore(true)).toBeNull();   // Number(true) is 1
    expect(parseScore(false)).toBeNull();
    expect(parseScore('abc')).toBeNull();
    expect(parseScore(NaN)).toBeNull();
    expect(parseScore(Infinity)).toBeNull();
  });
});
