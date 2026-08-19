import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

/**
 * An uploaded rubric is re-pointed as equal shares of the activity's own mark.
 *
 * Before this, extraction rebased the document's criteria to percentages of 100
 * (scaleCriteriaTo100) and the activity's Total Points sat beside them as a
 * separate number. Two consequences, both of which teachers hit:
 *
 *   • Every criterion was a weight to be translated. "Content — 40" on a
 *     20-point activity means 8 marks, and nothing on the page did that sum.
 *   • Scoring needed a conversion step (sum ÷ rubric total × 100), which is
 *     exactly the arithmetic the AI got wrong — see rubric-arithmetic.test.js.
 *
 * Dividing the activity's points equally removes both: the rubric's total IS
 * the activity's total, so the criterion scores add straight up, and every
 * number on the rubric is a real mark out of the paper in front of the teacher.
 *
 * The split is deliberately equal rather than proportional. That does discard
 * the document's own weighting, which is why the builder says so plainly and
 * the criteria stay editable — a school that really marks Content at half the
 * paper can put that back in one field.
 */

const require = createRequire(import.meta.url);
const { divideEqually, scaleCriteriaTo100 } = require('../server.js');

const crit = (...names) => names.map(name => ({ name, points: 0, description: '', bands: [] }));
const totalOf = (criteria) => criteria.reduce((sum, c) => sum + c.points, 0);

describe('divideEqually — the activity\'s points, split evenly', () => {
  it('divides evenly when it divides evenly', () => {
    const { criteria, scaled } = divideEqually(crit('Content', 'Organization', 'Language', 'Mechanics'), 100);
    expect(criteria.map(c => c.points)).toEqual([25, 25, 25, 25]);
    expect(scaled).toBe(true);
  });

  it('lands on the total exactly when it does not', () => {
    // 50 over 3 is 16.67. Three 16s total 48 and three 17s total 51; the
    // remainder has to go somewhere, and it goes to the first criteria.
    const { criteria } = divideEqually(crit('A', 'B', 'C'), 50);
    expect(criteria.map(c => c.points)).toEqual([17, 17, 16]);
    expect(totalOf(criteria)).toBe(50);
  });

  it('lands on the total exactly for every shape it will meet in practice', () => {
    for (let total = 1; total <= 120; total++) {
      for (let n = 1; n <= 8; n++) {
        const { criteria } = divideEqually(crit(...Array.from({ length: n }, (_, i) => `C${i}`)), total);
        expect(totalOf(criteria)).toBe(total);
        // Even means even: no two criteria may differ by more than the one
        // point the remainder forces.
        const points = criteria.map(c => c.points);
        expect(Math.max(...points) - Math.min(...points)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('replaces whatever the document said rather than scaling it', () => {
    // The whole difference from scaleCriteriaTo100: a 40/30/30 document does
    // NOT come back as 40/30/30 of the activity's points.
    const document = [
      { name: 'Content', points: 40 },
      { name: 'Organization', points: 30 },
      { name: 'Language', points: 30 },
    ];
    expect(divideEqually(document, 60).criteria.map(c => c.points)).toEqual([20, 20, 20]);
    // ...whereas the percentage path keeps them.
    expect(scaleCriteriaTo100(document).criteria.map(c => c.points)).toEqual([40, 30, 30]);
  });

  it('keeps everything about a criterion except its points', () => {
    const [only] = divideEqually(
      [{ name: 'Content', description: 'States a position.', bands: [], extra: 'kept' }],
      25
    ).criteria;
    expect(only).toMatchObject({ name: 'Content', description: 'States a position.', extra: 'kept', points: 25 });
  });

  it('leaves the criteria alone when there is no total to divide into', () => {
    // An empty Total Points box on the activity form. Refusing to divide is the
    // point: dividing by a zero or a NaN would silently zero every criterion,
    // and validateRubric would then reject the save with "the rubric criteria
    // add up to zero" pointing at a field the teacher never touched.
    for (const noTotal of [0, null, undefined, NaN, '', 'abc', -20]) {
      const { criteria, scaled } = divideEqually(crit('A', 'B'), noTotal);
      expect(scaled).toBe(false);
      expect(criteria.map(c => c.points)).toEqual([0, 0]);
    }
  });

  it('leaves an empty rubric alone rather than dividing by zero criteria', () => {
    const { criteria, scaled } = divideEqually([], 50);
    expect(criteria).toEqual([]);
    expect(scaled).toBe(false);
  });

  it('rounds a fractional total to whole points', () => {
    // The activity's points come off a form field and reach the server as a
    // string; a "12.5" must not produce criteria carrying halves of a mark.
    const { criteria } = divideEqually(crit('A', 'B'), '12.5');
    expect(totalOf(criteria)).toBe(13);
    expect(criteria.every(c => Number.isInteger(c.points))).toBe(true);
  });
});
