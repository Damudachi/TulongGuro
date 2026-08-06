import { describe, it, expect } from 'vitest';
import grading from '../grading.js';

const { countsAsGrade, isExcused, gradePercentOf, computeGrade } = grading;

const POLICY = { WW: 30, PT: 50, QA: 20 };

/**
 * Excused work leaves the calculation; it is not a zero.
 *
 * A teacher previously had two bad options for a pupil off sick: leave the row
 * MISSING, which reads as delinquent, or invent a mark. The grading engine was
 * already able to handle this — computeGrade drops a component with nothing
 * graded and renormalises the remaining weights — so an excused activity just
 * has to stop entering the sum.
 */

const graded = (percent, extra = {}) => ({
  status: 'GRADED', hitlScore: percent, archivedAt: null, excusedAt: null, ...extra,
});

describe('isExcused', () => {
  it('is true only when a date is set', () => {
    expect(isExcused({ excusedAt: new Date() })).toBe(true);
    expect(isExcused({ excusedAt: null })).toBe(false);
    expect(isExcused({})).toBe(false);
    expect(isExcused(null)).toBe(false);
  });
});

describe('an excused submission is not a grade', () => {
  it('drops out even when it carries a validated score', () => {
    // The score stays on the row so un-excusing restores it — it just stops
    // counting while the excusal stands.
    const sub = graded(40, { excusedAt: new Date() });
    expect(countsAsGrade(sub)).toBe(false);
    expect(gradePercentOf(sub)).toBeNull();
  });

  it('counts again once the excusal is removed', () => {
    const sub = graded(40, { excusedAt: null });
    expect(countsAsGrade(sub)).toBe(true);
    expect(gradePercentOf(sub)).toBe(40);
  });
});

describe('the average treats excused as absent, not as zero', () => {
  /** Mirrors toGradeEntries + computeGrade. */
  const averageOf = (subs) => {
    const entries = subs
      .filter(s => !isExcused(s))
      .map(s => ({ percent: gradePercentOf(s), points: s.points ?? 100, component: s.component ?? 'WW' }))
      .filter(e => e.percent !== null);
    const { initialGrade } = computeGrade(entries, POLICY, { transmute: false });
    return initialGrade === null ? null : Math.round(initialGrade);
  };

  it('excusing a missed activity leaves the average unchanged', () => {
    const twoGood = [graded(90), graded(80)];
    const twoGoodPlusExcused = [...twoGood, graded(null, { excusedAt: new Date(), hitlScore: null })];
    expect(averageOf(twoGoodPlusExcused)).toBe(averageOf(twoGood));
  });

  it('is emphatically not the same as scoring it zero', () => {
    const withZero = averageOf([graded(90), graded(80), graded(0)]);
    const withExcused = averageOf([graded(90), graded(80), graded(0, { excusedAt: new Date() })]);
    expect(withZero).toBe(57);
    expect(withExcused).toBe(85);
  });

  it('renormalises the remaining component weights when a whole component is excused', () => {
    // WW 30 / PT 50 / QA 20. A pupil excused from the quarterly assessment is
    // graded on WW and PT renormalised to 37.5 / 62.5 — not on 80% of a scale.
    const subs = [
      graded(80, { component: 'WW' }),
      graded(90, { component: 'PT' }),
      graded(0, { component: 'QA', excusedAt: new Date() }),
    ];
    expect(averageOf(subs)).toBe(Math.round(80 * 0.375 + 90 * 0.625));
  });

  it('returns null, not zero, when every activity is excused', () => {
    expect(averageOf([graded(50, { excusedAt: new Date() })])).toBeNull();
  });
});

describe('excused is distinct from archived', () => {
  it('both stop counting, but they answer different questions', () => {
    // archivedAt is retention/lifecycle; excusedAt is a live pedagogical
    // decision about one student, and stays visible as "Excused".
    expect(countsAsGrade(graded(80, { archivedAt: new Date() }))).toBe(false);
    expect(countsAsGrade(graded(80, { excusedAt: new Date() }))).toBe(false);
    expect(isExcused(graded(80, { archivedAt: new Date() }))).toBe(false);
  });
});
