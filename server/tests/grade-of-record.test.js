import { describe, it, expect } from 'vitest';
import grading from '../grading.js';

const { countsAsGrade, gradePercentOf, computeGrade } = grading;

/**
 * The line between "the AI produced a number" and "a teacher signed off on a
 * grade". The gradebook export crossed it — it read hitlScore ?? aiScore off
 * every non-archived submission with no status check, so unreviewed machine
 * scores went into the official class record. These tests pin the rule down.
 */

describe('countsAsGrade', () => {
  it('accepts a validated submission', () => {
    expect(countsAsGrade({ status: 'GRADED', archivedAt: null })).toBe(true);
  });

  it('rejects a PENDING submission even when the AI has scored it', () => {
    // This is the export bug: an AI draft is a suggestion, not a mark.
    expect(countsAsGrade({ status: 'PENDING', aiScore: 88, archivedAt: null })).toBe(false);
  });

  it('rejects an ERROR submission', () => {
    expect(countsAsGrade({ status: 'ERROR', archivedAt: null })).toBe(false);
  });

  it('rejects an archived submission even when validated', () => {
    expect(countsAsGrade({ status: 'GRADED', archivedAt: new Date() })).toBe(false);
  });

  it('rejects nothing at all', () => {
    expect(countsAsGrade(null)).toBe(false);
    expect(countsAsGrade(undefined)).toBe(false);
  });

  it('does NOT require release — release controls student visibility, not validity', () => {
    // A teacher exporting their own record before publishing to the class is
    // ordinary. Gating on releasedAt here would blank their own gradebook.
    expect(countsAsGrade({ status: 'GRADED', archivedAt: null, releasedAt: null })).toBe(true);
  });
});

describe('gradePercentOf', () => {
  it('returns the teacher score for a validated submission', () => {
    expect(gradePercentOf({ status: 'GRADED', hitlScore: 82, aiScore: 75, archivedAt: null })).toBe(82);
  });

  it('returns null for an unvalidated submission regardless of aiScore', () => {
    expect(gradePercentOf({ status: 'PENDING', aiScore: 88, archivedAt: null })).toBeNull();
  });

  it('prefers a validated score of 0 over the AI score', () => {
    // `??` not `||`. A teacher marking a paper zero must not fall through to
    // whatever the model originally said.
    expect(gradePercentOf({ status: 'GRADED', hitlScore: 0, aiScore: 95, archivedAt: null })).toBe(0);
  });

  it('falls back to aiScore only on a GRADED row with no teacher score', () => {
    expect(gradePercentOf({ status: 'GRADED', hitlScore: null, aiScore: 70, archivedAt: null })).toBe(70);
  });

  it('returns null when nothing is scored', () => {
    expect(gradePercentOf({ status: 'GRADED', hitlScore: null, aiScore: null, archivedAt: null })).toBeNull();
    expect(gradePercentOf(null)).toBeNull();
  });
});

describe('export average excludes unvalidated work', () => {
  /** Mirrors the row-building loop in the gradebook export endpoint. */
  const averageFor = (submissions, points = 100) => {
    const entries = submissions
      .map(sub => ({ percent: gradePercentOf(sub), points, component: 'WW' }))
      .filter(e => e.percent !== null);
    const { initialGrade } = computeGrade(entries, { WW: 30, PT: 50, QA: 20 }, { transmute: false });
    return initialGrade === null ? null : Math.round(initialGrade);
  };

  it('averages only the validated paper when the rest are AI drafts', () => {
    const subs = [
      { status: 'GRADED', hitlScore: 90, archivedAt: null },
      { status: 'PENDING', aiScore: 40, archivedAt: null },
      { status: 'PENDING', aiScore: 50, archivedAt: null },
    ];
    // Before the fix this averaged 90/40/50 to 60. Only the 90 is a grade.
    expect(averageFor(subs)).toBe(90);
  });

  it('returns null when nothing has been validated yet', () => {
    const subs = [
      { status: 'PENDING', aiScore: 88, archivedAt: null },
      { status: 'PENDING', aiScore: 72, archivedAt: null },
    ];
    expect(averageFor(subs)).toBeNull();
  });

  it('counts a validated zero, which is not the same as no grade', () => {
    expect(averageFor([{ status: 'GRADED', hitlScore: 0, archivedAt: null }])).toBe(0);
  });
});
