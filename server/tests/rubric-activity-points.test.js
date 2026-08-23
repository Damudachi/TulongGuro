import { describe, it, expect } from 'vitest';
import { rubricPointScale, formatRubricPoints } from '../../src/utils/rubric.js';

/**
 * A rubric shown in the points of the activity it is attached to.
 *
 * A rubric is authored once and reused. Every hand-typed one in this app totals
 * 100 (RubricEditor holds it to that, and scaleCriteriaTo100 rebases uploaded
 * ones onto the same scale), but activities are worth whatever the teacher set
 * — so the same rubric shows "27 / 30" on a criterion of a 15-point quiz, a
 * number that cannot appear anywhere in a mark whose whole ceiling is 15. The
 * reverse turns up too: a 10-point rubric on a 100-point essay reported "1 / 4".
 *
 * These pin the conversion. What they are deliberately NOT: a claim about
 * anything stored. The criterion scores in Submission.rubricData stay in the
 * rubric's own points, because that is what the grade percentage is computed
 * from — the scale here is applied where the breakdown is drawn and nowhere
 * else.
 */

describe('rubricPointScale', () => {
  it('shrinks a 100-point rubric onto a 15-point activity', () => {
    const scale = rubricPointScale(100, 15);
    // The screenshot case: 27/30, 27/30, 23/25, 14/15 out of 100.
    expect(30 * scale).toBeCloseTo(4.5);
    expect(27 * scale).toBeCloseTo(4.05);
    // Every criterion scaled still adds up to the activity's own points.
    expect((30 + 30 + 25 + 15) * scale).toBeCloseTo(15);
  });

  it('grows a 10-point rubric onto a 100-point activity', () => {
    const scale = rubricPointScale(10, 100);
    expect(4 * scale).toBe(40);
    expect(1 * scale).toBe(10);
  });

  it('is the identity when the rubric already matches the activity', () => {
    expect(rubricPointScale(100, 100)).toBe(1);
    expect(rubricPointScale(15, 15)).toBe(1);
  });

  it('preserves the ratio, which is what the grade is actually computed from', () => {
    // The mark must not move because of how it is displayed. Scaling both
    // halves of every criterion leaves earned/possible untouched.
    const scale = rubricPointScale(100, 15);
    const earned = [27, 27, 23, 14].reduce((a, b) => a + b, 0);
    const possible = [30, 30, 25, 15].reduce((a, b) => a + b, 0);
    expect((earned * scale) / (possible * scale)).toBeCloseTo(earned / possible);
  });

  it('falls back to raw rubric points rather than dividing by zero', () => {
    // An activity with no points set, or a rubric whose criteria are all worth
    // nothing. Showing the rubric's own numbers is wrong-ish; showing NaN or
    // Infinity next to a child's mark is worse.
    expect(rubricPointScale(0, 15)).toBe(1);
    expect(rubricPointScale(100, 0)).toBe(1);
    expect(rubricPointScale(null, undefined)).toBe(1);
    expect(rubricPointScale(100, null)).toBe(1);
  });
});

describe('formatRubricPoints', () => {
  it('keeps the half point a conversion lands on', () => {
    expect(formatRubricPoints(4.5)).toBe('4.5');
  });

  it('drops a trailing .0 — a teacher writes 5, not 5.0', () => {
    expect(formatRubricPoints(5)).toBe('5');
    expect(formatRubricPoints(5.0)).toBe('5');
  });

  it('rounds to one decimal, not two', () => {
    // 27 of a 30-point criterion on a 15-point activity is 4.05. Two decimals
    // would imply a precision the rubric does not have.
    expect(formatRubricPoints(4.05)).toBe('4.1');
    expect(formatRubricPoints(4.04)).toBe('4');
  });

  it('shows an unscored criterion as 0 rather than NaN', () => {
    // `scores` starts empty on the review screen, so this is reached on every
    // first render of a paper.
    expect(formatRubricPoints(undefined)).toBe('0');
    expect(formatRubricPoints(null)).toBe('0');
    expect(formatRubricPoints(NaN)).toBe('0');
  });
});
