import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const grading = require('../grading.js');

/**
 * The learner sees a "General Average" in two places: their dashboard, and the
 * headline of My Gradebook. They must be the same number.
 *
 * The gradebook used to compute its own, as a flat mean of every activity's
 * raw percent — grading.js keeps that method only as the "before" side of its
 * fairness regression and says it is no longer live anywhere. It was live on
 * that screen, and it disagreed with the dashboard whenever a subject mixed
 * components or point values, which is every real subject.
 *
 * These pin the arithmetic the two screens now share: average each subject
 * under its own DepEd weights, then average the subjects.
 */

const DEFAULT = { WW: 30, PT: 50, QA: 20 };

/**
 * What the server sends as `subject.overallGrade` — server.js's workingAverage,
 * which is computeGrade untransmuted and rounded. Reproduced through the
 * exported function because workingAverage itself is module-private.
 */
const subjectAverage = (entries, policy = DEFAULT) => {
  if (entries.length === 0) return null;
  const { initialGrade } = grading.computeGrade(entries, policy, { transmute: false });
  return initialGrade === null ? null : Math.round(initialGrade);
};

/** What the gradebook headline now does with those figures. */
const generalAverage = (subjectGrades) => {
  const valid = subjectGrades.filter(v => typeof v === 'number');
  return valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
};

/** The discarded method, kept here only to prove the two differ. */
const flatMeanOfActivities = (allPercents) =>
  allPercents.length ? Math.round(allPercents.reduce((a, b) => a + b, 0) / allPercents.length) : null;

describe('the general average a learner is shown', () => {
  it('weights components, so it differs from a flat mean of activities', () => {
    // Three quizzes at 90 and one Quarterly Assessment at 50. A flat mean says
    // 80; the DepEd weights say the QA is worth 20% on its own, so the real
    // figure is lower. Showing 80 on one screen and 78 on another is the bug.
    const entries = [
      { percent: 90, points: 100, component: 'WW' },
      { percent: 90, points: 100, component: 'WW' },
      { percent: 90, points: 100, component: 'WW' },
      { percent: 50, points: 100, component: 'QA' },
    ];
    // WW and QA present, PT absent -> renormalised over 50: (90*30 + 50*20)/50
    const weighted = subjectAverage(entries);
    const flat = flatMeanOfActivities(entries.map(e => e.percent));

    expect(weighted).toBe(74);
    expect(flat).toBe(80);
    expect(weighted).not.toBe(flat);
  });

  it('weights by points within a component, so a 20-point task is not an exam', () => {
    // Same component, wildly different weights. The flat mean treats them as
    // equal; points-weighting does not.
    const entries = [
      { percent: 100, points: 20, component: 'WW' },
      { percent: 60, points: 100, component: 'WW' },
    ];
    expect(subjectAverage(entries)).toBe(67);          // (20 + 60) / 120
    expect(flatMeanOfActivities([100, 60])).toBe(80);
  });

  it('averages subjects, not activities, so a busy subject does not dominate', () => {
    // English has 10 activities, Maths has 1. Averaging activities would let
    // English decide almost the whole figure; averaging subjects gives each
    // subject one vote, which is what a report card does.
    const english = subjectAverage(Array.from({ length: 10 }, () => (
      { percent: 90, points: 100, component: 'WW' }
    )));
    const maths = subjectAverage([{ percent: 60, points: 100, component: 'WW' }]);

    expect(generalAverage([english, maths])).toBe(75);   // (90 + 60) / 2
    expect(flatMeanOfActivities([...Array(10).fill(90), 60])).toBe(87);
  });

  it('skips a subject with no released work rather than scoring it zero', () => {
    // workingAverage returns null for a subject with nothing graded. Counting
    // that as 0 would halve a learner's average the moment a new subject
    // appeared on their timetable.
    const graded = subjectAverage([{ percent: 88, points: 100, component: 'WW' }]);
    const ungraded = subjectAverage([]);

    expect(ungraded).toBeNull();
    expect(generalAverage([graded, ungraded])).toBe(88);
  });

  it('shows no average at all when nothing has been released', () => {
    expect(generalAverage([null, null])).toBeNull();
  });
});
