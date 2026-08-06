import { describe, it, expect } from 'vitest';
import grading from '../grading.js';

const {
  componentPercentage, initialGrade, transmute, computeGrade,
  descriptorBands, bandKeyFor, bandCounts, starsForScore, starsFor,
  weightGroupForSubject, defaultPolicyFor,
} = grading;

/**
 * The grading engine is the one place in the app where a silent arithmetic
 * error becomes a wrong number on a child's report card, so it is the first
 * thing under test. scripts/verify-grading.js already walks the whole DepEd
 * transmutation table row by row; this covers the surrounding behaviour that
 * script does not — component weighting, renormalisation, band boundaries and
 * the star ladder.
 */

describe('componentPercentage — points-weighted, not a mean of percentages', () => {
  it('weights a 100-point activity above a 50-point one', () => {
    // 90/100 and 40/50: the naive mean is 85, the correct answer is 130/150.
    const result = componentPercentage([
      { percent: 90, points: 100 },
      { percent: 80, points: 50 },
    ]);
    expect(result).toBeCloseTo((90 + 40) / 150 * 100, 6);
    expect(Math.round(result)).toBe(87);
  });

  it('returns null when nothing is graded', () => {
    expect(componentPercentage([])).toBeNull();
    expect(componentPercentage(null)).toBeNull();
  });

  it('ignores entries with no numeric percent or no points', () => {
    expect(componentPercentage([
      { percent: null, points: 100 },
      { percent: 50, points: 0 },
      { percent: 80, points: 10 },
    ])).toBe(80);
  });
});

describe('initialGrade — renormalises over the components that exist', () => {
  it('drops a missing component and rescales the rest', () => {
    // WW 30 / PT 50 / QA 20, with no QA yet: WW and PT renormalise to 37.5/62.5.
    const { initialGrade: ig, usedWeights, missing } =
      initialGrade({ WW: 80, PT: 90, QA: null }, { WW: 30, PT: 50, QA: 20 });
    expect(missing).toEqual(['QA']);
    expect(usedWeights).toEqual({ WW: 37.5, PT: 62.5 });
    expect(ig).toBeCloseTo(80 * 0.375 + 90 * 0.625, 6);
  });

  it('returns null when no component has been graded', () => {
    const { initialGrade: ig } = initialGrade({ WW: null, PT: null, QA: null }, { WW: 30, PT: 50, QA: 20 });
    expect(ig).toBeNull();
  });

  it('returns null rather than dividing by zero when every present weight is 0', () => {
    const { initialGrade: ig } = initialGrade({ WW: 80, PT: null, QA: null }, { WW: 0, PT: 50, QA: 20 });
    expect(ig).toBeNull();
  });
});

describe('transmute — floors within each band, never rounds up into the next', () => {
  it('maps the two published anchor points', () => {
    expect(transmute(100)).toBe(100);
    expect(transmute(60)).toBe(75);
    expect(transmute(0)).toBe(60);
  });

  it('floors at a band edge instead of rounding up', () => {
    // The published table reads "98.40 - 99.99 -> 99". 98.39 belongs to 98.
    expect(transmute(98.4)).toBe(99);
    expect(transmute(98.39)).toBe(98);
  });

  it('survives the binary-float edge at 38.4/1.6', () => {
    // (98.4 - 60) / 1.6 is 23.999... in IEEE 754 and would floor to 23,
    // costing the student a whole grade point.
    expect(transmute(98.4)).toBe(75 + 24);
  });

  it('only ever raises a grade, and floors at 60', () => {
    for (const ig of [0, 5, 25, 50, 59, 60, 61, 74, 75, 90]) {
      expect(transmute(ig)).toBeGreaterThanOrEqual(60);
      expect(transmute(ig)).toBeGreaterThanOrEqual(Math.min(ig, 100) >= 60 ? 75 : 60);
    }
  });

  it('is null-safe', () => {
    expect(transmute(null)).toBeNull();
    expect(transmute(undefined)).toBeNull();
    expect(transmute(NaN)).toBeNull();
  });
});

describe('computeGrade', () => {
  it('treats an unrecognised component as Written Work', () => {
    const withNull = computeGrade([{ percent: 80, points: 100, component: null }], { WW: 30, PT: 50, QA: 20 }, { transmute: false });
    const withWW = computeGrade([{ percent: 80, points: 100, component: 'WW' }], { WW: 30, PT: 50, QA: 20 }, { transmute: false });
    expect(withNull.componentPercents.WW).toBe(80);
    expect(withNull.initialGrade).toBe(withWW.initialGrade);
  });

  it('reports finalGrade as the untransmuted grade when transmute is off', () => {
    const r = computeGrade([{ percent: 69, points: 100, component: 'WW' }], { WW: 30, PT: 50, QA: 20 }, { transmute: false });
    expect(r.transmutedGrade).toBeNull();
    expect(r.finalGrade).toBe(69);
  });

  it('reports finalGrade as the transmuted grade when transmute is on', () => {
    const r = computeGrade([{ percent: 69, points: 100, component: 'WW' }], { WW: 30, PT: 50, QA: 20 }, {});
    expect(r.initialGrade).toBe(69);
    expect(r.transmutedGrade).toBe(80);
    expect(r.finalGrade).toBe(80);
  });

  it('honours a school passing grade above the DepEd default', () => {
    const entries = [{ percent: 78, points: 100, component: 'WW' }];
    expect(computeGrade(entries, null, { transmute: false, passing: 75 }).isPassing).toBe(true);
    expect(computeGrade(entries, null, { transmute: false, passing: 80 }).isPassing).toBe(false);
  });
});

describe('descriptor bands — always strictly descending, whatever the passing grade', () => {
  it('keeps the full ladder at the DepEd default', () => {
    expect(descriptorBands(75).map(b => b.key))
      .toEqual(['outstanding', 'verySatisfactory', 'satisfactory', 'passing', 'failing']);
  });

  it('drops rungs that would sit at or below a high passing grade', () => {
    // At 85, "Satisfactory (>=80)" would be a passing label on a failing mark.
    expect(descriptorBands(85).map(b => b.key)).toEqual(['outstanding', 'passing', 'failing']);
    expect(descriptorBands(95).map(b => b.key)).toEqual(['passing', 'failing']);
  });

  it('starts the lowest passing band exactly at the school threshold', () => {
    for (const p of [70, 75, 80, 85, 90]) {
      const passing = descriptorBands(p).find(b => b.key === 'passing');
      expect(passing.min).toBe(p);
    }
  });
});

describe('bandKeyFor — rounds before comparing, matching isPassing', () => {
  it('bands a score that rounds up to the passing line as passing', () => {
    // isPassing does Math.round(final) >= passing, so 74.6 passes. The band
    // has to agree or the same mark is coloured as a fail.
    expect(bandKeyFor(74.6, 75)).toBe('passing');
    expect(bandKeyFor(74.4, 75)).toBe('failing');
  });

  it('is null for ungraded, not failing', () => {
    expect(bandKeyFor(null, 75)).toBeNull();
    expect(bandKeyFor(undefined, 75)).toBeNull();
  });
});

describe('bandCounts', () => {
  it('zeroes every band that exists at this passing grade, plus notGraded', () => {
    const counts = bandCounts([95, 86, 82, 76, 40, null], 75);
    expect(counts).toEqual({
      notGraded: 1, outstanding: 1, verySatisfactory: 1,
      satisfactory: 1, passing: 1, failing: 1,
    });
  });

  it('collapses the upper rungs into passing when the threshold is high', () => {
    const counts = bandCounts([95, 86, 82], 85);
    expect(counts).toEqual({ notGraded: 0, outstanding: 1, passing: 1, failing: 1 });
  });
});

describe('stars — anchored to the school passing grade', () => {
  it('awards on the DepEd ladder by default', () => {
    expect(starsForScore(95, 75)).toBe(3);
    expect(starsForScore(86, 75)).toBe(2);
    expect(starsForScore(78, 75)).toBe(1);
    expect(starsForScore(70, 75)).toBe(0);
  });

  it('does not hand out a star for a 76 at a school that passes at 80', () => {
    expect(starsForScore(76, 80)).toBe(0);
    expect(starsForScore(82, 80)).toBe(1);
  });

  it('prefers a teacher score of 0 over the AI score', () => {
    // `??` not `||`: a teacher-assigned zero is falsy and used to fall through
    // to the AI's original mark, so a pupil marked zero still collected stars.
    expect(starsFor([{ hitlScore: 0, aiScore: 95 }], 75)).toBe(0);
    expect(starsFor([{ hitlScore: null, aiScore: 95 }], 75)).toBe(3);
  });
});

describe('subject weight groups', () => {
  it('routes DepEd subject families to their own default weights', () => {
    expect(weightGroupForSubject('Mathematics')).toBe('SCIENCE_MATH');
    expect(weightGroupForSubject('Agham')).toBe('SCIENCE_MATH');
    expect(weightGroupForSubject('MAPEH')).toBe('MAPEH_EPP_TLE');
    expect(weightGroupForSubject('TLE')).toBe('MAPEH_EPP_TLE');
    expect(weightGroupForSubject('English')).toBe('LANGUAGES_AP_ESP');
    expect(weightGroupForSubject('Araling Panlipunan')).toBe('LANGUAGES_AP_ESP');
    expect(weightGroupForSubject(null)).toBe('LANGUAGES_AP_ESP');
  });

  it('returns a fresh object so a caller cannot mutate the shared defaults', () => {
    const a = defaultPolicyFor('Science');
    a.WW = 999;
    expect(defaultPolicyFor('Science').WW).toBe(40);
  });
});
