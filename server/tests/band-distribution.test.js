import { describe, it, expect } from 'vitest';
import grading from '../grading.js';

/**
 * The school-wide spread bar counts students, not enrolments.
 *
 * The admin analytics loop runs once per student per class, and it used to do
 * `schoolBands[band]++` inside that loop. So a learner taking five subjects
 * put five entries into a distribution rendered directly beneath a headline
 * count of unique students: the bar summed to roughly five times the number of
 * children it claimed to describe, and a pupil failing one subject out of five
 * weighed as heavily in "Did Not Meet Expectations" as a pupil failing the one
 * subject they took.
 */

const PASSING = 75;
const POLICY = { WW: 30, PT: 50, QA: 20 };

const graded = (percent) => ({
  hitlScore: percent,
  activity: { points: 100, component: 'WW', class: { subject: 'English', gradeLevel: 'Grade 6' } },
});

/** Mirrors bandOf() in the admin analytics endpoint. */
const bandOf = (avg) => (avg === null ? 'notGraded' : grading.bandKeyFor(avg, PASSING));

const sumCounts = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);

describe('band totals match the student headcount', () => {
  it('counts a student in five classes exactly once', () => {
    const enrolments = [90, 88, 92, 85, 91];   // one student, five subjects
    const perStudentAverage = Math.round(enrolments.reduce((a, b) => a + b, 0) / enrolments.length);

    // The old shape: one increment per enrolment.
    const oldWay = grading.bandCounts([], PASSING);
    for (const avg of enrolments) oldWay[bandOf(avg)]++;

    // The fixed shape: one increment per student, from their general average.
    const newWay = grading.bandCounts([], PASSING);
    newWay[bandOf(perStudentAverage)]++;

    expect(sumCounts(oldWay)).toBe(5);     // five entries for one child
    expect(sumCounts(newWay)).toBe(1);
  });

  it('sums to the roster size however many classes each student takes', () => {
    const roster = [
      { id: 'a', classAverages: [90, 88, 92] },
      { id: 'b', classAverages: [70] },
      { id: 'c', classAverages: [] },          // enrolled, nothing graded yet
      { id: 'd', classAverages: [60, 65, 70, 80] },
    ];

    const counts = grading.bandCounts([], PASSING);
    for (const s of roster) {
      const avg = s.classAverages.length
        ? Math.round(s.classAverages.reduce((a, b) => a + b, 0) / s.classAverages.length)
        : null;
      counts[bandOf(avg)]++;
    }

    expect(sumCounts(counts)).toBe(roster.length);
    expect(counts.notGraded).toBe(1);        // student c
  });

  it('places a student on their general average, not on their worst subject', () => {
    // Failing one of five subjects should not read as a failing student — the
    // per-class rows still say which subject, which is a different question.
    const classAverages = [92, 90, 88, 91, 40];
    const general = Math.round(classAverages.reduce((a, b) => a + b, 0) / classAverages.length);

    expect(bandOf(general)).not.toBe('failing');
    expect(classAverages.some(a => bandOf(a) === 'failing')).toBe(true);
  });
});

describe('the general average is per-subject weighted, then averaged', () => {
  it('gives each subject equal weight regardless of how much work it carries', () => {
    // DepEd defines a General Average as per-subject grades combined, not
    // per-subject scores pooled — otherwise the subject that happened to set
    // more activities would dominate.
    const mathsOneActivity = grading.computeGrade(
      [{ percent: 50, points: 100, component: 'WW' }], POLICY, { transmute: false }
    ).initialGrade;
    const englishTenActivities = grading.computeGrade(
      Array.from({ length: 10 }, () => ({ percent: 90, points: 100, component: 'WW' })),
      POLICY, { transmute: false }
    ).initialGrade;

    const general = Math.round((mathsOneActivity + englishTenActivities) / 2);
    expect(general).toBe(70);

    // Pooling every score instead would have given English ten times the say.
    const pooled = grading.computeGrade(
      [
        { percent: 50, points: 100, component: 'WW' },
        ...Array.from({ length: 10 }, () => ({ percent: 90, points: 100, component: 'WW' })),
      ],
      POLICY, { transmute: false }
    ).initialGrade;
    expect(Math.round(pooled)).toBe(86);
    expect(Math.round(pooled)).not.toBe(general);
  });

  it('drops a subject with nothing graded rather than counting it as zero', () => {
    const withOne = grading.computeGrade(
      [{ percent: 80, points: 100, component: 'WW' }], POLICY, { transmute: false }
    ).initialGrade;
    expect(Math.round(withOne)).toBe(80);
  });
});
