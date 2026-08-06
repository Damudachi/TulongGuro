/**
 * grading.js — one source of truth for how a score is shown to a human.
 *
 * Every screen used to carry its own copy of "green above 90, amber above 75,
 * red below". That meant a school which set its passing grade to 80 got a
 * system that disagreed with itself: the admin dashboard coloured by the real
 * threshold while the student's own gradebook still drew the line at 75, so a
 * pupil on 78 saw amber ("getting there") on a mark the school counts as
 * failing. The threshold is school data, so it has to be passed in, never
 * assumed.
 *
 * DepEd's default of 75 is the fallback for the handful of places that render
 * before the school settings have loaded — not a licence to hardcode it.
 */

/** DepEd DO 8 s.2015 default. Only ever a fallback; prefer the school's value. */
export const DEFAULT_PASSING_GRADE = 75;

/**
 * Round a stored percentage for display.
 *
 * Scores are stored unrounded so that points -> percent -> points is lossless
 * (7 out of 30 is 23.333…%, not 23%). That precision belongs in the database,
 * not on screen, so every render goes through here.
 */
export function pct(value, decimals = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/**
 * What a percentage is worth in an activity's own points — the number a teacher
 * writes in a record book. Exact now that percentages keep their precision.
 */
export function toPoints(percent, totalPoints) {
  if (percent === null || percent === undefined) return null;
  return Math.round((percent / 100) * (totalPoints || 100) * 10) / 10;
}

/** Format points without a trailing ".0", e.g. 7 not 7.0, but 6.5 stays 6.5. */
export function formatPoints(percent, totalPoints) {
  const p = toPoints(percent, totalPoints);
  return p === null ? '—' : String(p);
}

/**
 * DepEd DO 8 s.2015 descriptor bands, anchored to the school's passing grade.
 *
 * The fixed 90 / 80 / passing ladder inverted whenever a school set its passing
 * grade above 80: "Satisfactory (≥80)" then sat *below* the passing line while
 * still being coloured as a pass. Any band at or below the passing grade is
 * dropped here, so the ladder is always strictly descending and the lowest
 * passing band always starts exactly at the school's threshold.
 */
export function bandsFor(passingGrade = DEFAULT_PASSING_GRADE) {
  const passing = Number(passingGrade) || DEFAULT_PASSING_GRADE;
  const ladder = [
    { key: 'outstanding', min: 90, label: 'Outstanding', short: 'Excellent', emoji: '🌟',
      tone: 'text-aqua-700', chip: 'bg-lime-100 text-lime-800', dot: 'bg-lime-500', bar: 'bg-lime-500' },
    { key: 'verySatisfactory', min: 85, label: 'Very Satisfactory', short: 'Doing well', emoji: '👍',
      tone: 'text-royal-600', chip: 'bg-aqua-100 text-aqua-800', dot: 'bg-aqua-500', bar: 'bg-aqua-500' },
    { key: 'satisfactory', min: 80, label: 'Satisfactory', short: 'On track', emoji: '🙂',
      tone: 'text-royal-600', chip: 'bg-royal-100 text-royal-700', dot: 'bg-royal-500', bar: 'bg-royal-500' },
  ].filter(b => b.min > passing);

  return [
    ...ladder,
    { key: 'passing', min: passing, label: 'Fairly Satisfactory', short: 'Getting there', emoji: '🌱',
      tone: 'text-sun-700', chip: 'bg-sun-100 text-sun-800', dot: 'bg-sun-500', bar: 'bg-sun-500' },
    { key: 'failing', min: 0, label: 'Did Not Meet Expectations', short: 'Needs a boost', emoji: '💪',
      tone: 'text-red-600', chip: 'bg-magenta-100 text-magenta-800', dot: 'bg-magenta-500', bar: 'bg-magenta-500' },
  ];
}

/**
 * The band a score falls into, or null when nothing is graded yet.
 *
 * Rounds before comparing, matching bandKeyFor() in server/grading.js and
 * computeGrade's own `Math.round(final) >= passing` test for isPassing.
 *
 * Scores are stored unrounded on purpose — 7 out of a 30-point activity is
 * 23.333…%, and keeping that precision is what makes points -> percent ->
 * points lossless. Every screen rounds for display. Comparing the *unrounded*
 * value against a band edge therefore disagreed with the number on screen and
 * with the server: a 74.6 against a passing line of 75 displays as "75",
 * counts as passing in the server's analytics and at-risk list, and was
 * coloured red as a fail here. Same mark, three answers.
 */
export function bandFor(value, passingGrade = DEFAULT_PASSING_GRADE) {
  if (value === null || value === undefined) return null;
  return bandsFor(passingGrade).find(b => Math.round(value) >= b.min) || null;
}

/** Text colour for a score. The single rule every screen should use. */
export function gradeTone(value, passingGrade = DEFAULT_PASSING_GRADE, emptyTone = 'text-navy-300') {
  const band = bandFor(value, passingGrade);
  return band ? band.tone : emptyTone;
}

/** Chip (background + text) for a score, for pill-style badges. */
export function gradeChip(value, passingGrade = DEFAULT_PASSING_GRADE, emptyChip = 'bg-slate-100 text-slate-400') {
  const band = bandFor(value, passingGrade);
  return band ? band.chip : emptyChip;
}

/**
 * Whether a score passes. Null in, null out — "not graded" is not "failing".
 *
 * Rounds first, for the same reason bandFor does: computeGrade decides
 * isPassing as `Math.round(final) >= passing`, and a client that answered
 * differently would tell a student they had failed a mark the school's own
 * records count as a pass.
 */
export function isPassing(value, passingGrade = DEFAULT_PASSING_GRADE) {
  if (value === null || value === undefined) return null;
  return Math.round(value) >= (Number(passingGrade) || DEFAULT_PASSING_GRADE);
}
