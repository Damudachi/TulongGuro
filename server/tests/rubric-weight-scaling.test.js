import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

/**
 * An uploaded rubric written in the school's own scale, rebased to weights.
 *
 * A standard rubric's `points` are percentage weights, not marks — the grader
 * stores earned/possible as a percentage and the learner's mark is that
 * percentage times the ACTIVITY's points. Every hand-typed rubric in the app is
 * held to totalling 100 for that reason, but one read out of an uploaded
 * document was not: schools write them out of whatever the paper uses, so four
 * criteria worth 4 points each came through as weights totalling 16 and sat
 * there as "4%" beside a criterion the teacher meant as a quarter of the mark.
 *
 * scaleCriteriaTo100 converts them. What these tests hold it to:
 *
 *   • the shares are preserved — that is the whole content of a rubric
 *   • the integers total exactly 100, not 99 — the save refuses anything else
 *   • the activity's own points are never an input or an output here
 *
 * Loaded through createRequire because server.js is CommonJS, as in
 * rubric-arithmetic.test.js.
 */

const require = createRequire(import.meta.url);
const { scaleCriteriaTo100 } = require('../server.js');

const crit = (name, points) => ({ name, points, description: `${name} description` });
const totalOf = (criteria) => criteria.reduce((sum, c) => sum + c.points, 0);

describe('scaleCriteriaTo100', () => {
  it('turns four criteria worth 4 points each into four equal quarters', () => {
    // The rubric from the bug report: 4/4/4/4, total 16.
    const result = scaleCriteriaTo100([
      crit('Content', 4), crit('Organization', 4), crit('Grammar', 4), crit('Mechanics', 4),
    ]);

    expect(result.criteria.map(c => c.points)).toEqual([25, 25, 25, 25]);
    expect(result.originalTotal).toBe(16);
    expect(result.scaled).toBe(true);
  });

  it('lands on exactly 100 when the shares do not divide evenly', () => {
    // Three equal criteria are 33.33% each. Floored they total 99, and a 99%
    // rubric is refused on save — so the odd point has to be handed out rather
    // than dropped.
    const result = scaleCriteriaTo100([crit('A', 5), crit('B', 5), crit('C', 5)]);

    expect(totalOf(result.criteria)).toBe(100);
    expect(result.criteria.map(c => c.points)).toEqual([34, 33, 33]);
  });

  it('keeps the proportions of an unequal rubric', () => {
    // 20/10/10 out of 40 is a half and two quarters, and stays that way.
    const result = scaleCriteriaTo100([crit('Ideas', 20), crit('Voice', 10), crit('Spelling', 10)]);

    expect(result.criteria.map(c => c.points)).toEqual([50, 25, 25]);
    expect(totalOf(result.criteria)).toBe(100);
  });

  it('scales down a rubric written out of more than 100', () => {
    const result = scaleCriteriaTo100([crit('Practical', 120), crit('Written', 80)]);

    expect(result.criteria.map(c => c.points)).toEqual([60, 40]);
    expect(result.originalTotal).toBe(200);
  });

  it('leaves a rubric that already totals 100 completely alone', () => {
    const criteria = [crit('Content', 40), crit('Organization', 35), crit('Grammar', 25)];
    const result = scaleCriteriaTo100(criteria);

    expect(result.criteria).toBe(criteria);   // same reference: nothing rebuilt
    expect(result.scaled).toBe(false);
    expect(result.originalTotal).toBe(100);
  });

  it('does not invent weights for a rubric that adds up to nothing', () => {
    // Zero is what an extraction that read no numbers comes back with. There is
    // no share to preserve, so guessing an equal split would be inventing the
    // teacher's intent; validateRubric refuses it a moment later by name.
    const criteria = [crit('A', 0), crit('B', 0)];
    const result = scaleCriteriaTo100(criteria);

    expect(result.criteria).toBe(criteria);
    expect(result.scaled).toBe(false);
  });

  it('carries every other field on the criterion through untouched', () => {
    const result = scaleCriteriaTo100([
      { name: 'Content', points: 4, description: 'Ideas and detail', bands: [{ label: 'Excellent', score: 4 }] },
      { name: 'Grammar', points: 4, description: 'Sentence control', bands: [] },
    ]);

    expect(result.criteria[0].name).toBe('Content');
    expect(result.criteria[0].description).toBe('Ideas and detail');
    expect(result.criteria[0].bands).toEqual([{ label: 'Excellent', score: 4 }]);
    expect(result.criteria[0].points).toBe(50);
  });

  it('holds to exactly 100 across awkward splits', () => {
    // The property that matters more than any single expected array: whatever
    // the document said, the result is savable.
    const shapes = [
      [1, 1, 1], [1, 1, 1, 1, 1, 1, 7], [3, 7, 11], [2, 2, 2, 2, 2, 2],
      [9, 9, 9, 9, 9, 9, 9], [4, 4, 4, 4, 4, 4, 4, 4, 4],
    ];
    for (const shape of shapes) {
      const result = scaleCriteriaTo100(shape.map((p, i) => crit(`C${i}`, p)));
      expect(totalOf(result.criteria)).toBe(100);
      expect(result.criteria.every(c => c.points >= 0)).toBe(true);
    }
  });
});
