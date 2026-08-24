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

/* ────────────────────────────────────────────────────────────────────────────
 * THE GRADE ITSELF
 *
 * Everything above this line is presentation. Everything below is the DepEd
 * DO 8 s.2015 computation, and it is a deliberate port of the same functions
 * in server/grading.js — same names, same rules, same rounding.
 *
 * It is duplicated rather than shared because server/grading.js is CommonJS
 * inside the API package and this file is an ES module bundled by Vite; there
 * is no import that works both ways without a build step neither side has.
 * The drift that duplication invites is guarded instead of hoped away:
 * server/tests/gradebook-parity.test.js loads BOTH files and asserts they
 * return the same number across the whole scale. If you change one, change the
 * other, and that test will tell you if you didn't.
 *
 * Why the class gradebook needs this at all: the table used to total raw
 * points across every activity — no component weights, and counting AI drafts
 * the teacher had not validated. The exported file computed the real DepEd
 * grade. Same class, two different numbers on screen and on paper, and the
 * exported one was the correct one.
 * ──────────────────────────────────────────────────────────────────────────── */

/** The three DepEd components. Anything else on an activity counts as WW. */
export const COMPONENTS = ['WW', 'PT', 'QA'];

/**
 * Percentage Score for one component: total points earned over total points
 * possible, NOT the mean of each activity's percentage. A 50-point quiz must
 * not weigh the same as a 100-point performance task.
 */
export function componentPercentage(entries) {
  const valid = (entries || []).filter(e => e && typeof e.percent === 'number' && e.points > 0);
  if (valid.length === 0) return null;
  const earned = valid.reduce((sum, e) => sum + (e.percent / 100) * e.points, 0);
  const possible = valid.reduce((sum, e) => sum + e.points, 0);
  if (possible === 0) return null;
  return (earned / possible) * 100;
}

/**
 * Combine component percentages into an Initial Grade, dropping components
 * with nothing graded and renormalising the rest — so a quarter reads
 * sensibly before the Quarterly Assessment exists.
 */
export function initialGrade(componentPercents, weights) {
  const present = COMPONENTS.filter(c => typeof componentPercents[c] === 'number');
  const missing = COMPONENTS.filter(c => !present.includes(c));
  if (present.length === 0) return { initialGrade: null, usedWeights: {}, missing };

  const totalWeight = present.reduce((sum, c) => sum + (weights[c] || 0), 0);
  if (totalWeight === 0) return { initialGrade: null, usedWeights: {}, missing };

  const usedWeights = {};
  let grade = 0;
  for (const c of present) {
    const w = (weights[c] || 0) / totalWeight;
    usedWeights[c] = Math.round(w * 1000) / 10;
    grade += componentPercents[c] * w;
  }
  return { initialGrade: grade, usedWeights, missing };
}

/**
 * DepEd transmutation table as its two linear segments. Floors within each
 * band — the published table is banded ("98.40–99.99 -> 99"), so rounding
 * would push every boundary a grade too high and inflate report cards.
 */
export function transmute(initial) {
  if (initial === null || initial === undefined || Number.isNaN(initial)) return null;
  const ig = Math.max(0, Math.min(100, initial));
  const step = ig >= 60 ? 1.6 : 4;
  // toFixed(6) guards binary float error at band edges: 38.4/1.6 is 23.999… in
  // IEEE 754, which would floor to 23 and cost the student a grade point.
  const bands = Math.floor(Number(((ig - 60) / step).toFixed(6)));
  return Math.max(60, Math.min(100, 75 + bands));
}

/** Default component weights by subject group, Grades 1–10 (DO 8 s.2015). */
export const DEPED_DEFAULT_WEIGHTS = {
  LANGUAGES_AP_ESP: { WW: 30, PT: 50, QA: 20 },
  SCIENCE_MATH: { WW: 40, PT: 40, QA: 20 },
  MAPEH_EPP_TLE: { WW: 20, PT: 60, QA: 20 },
};

/** Subject name -> default weight group. Loose matching: subjects are free text. */
export function weightGroupForSubject(subject) {
  const s = (subject || '').toLowerCase();
  if (/(math|science|agham|matematika)/.test(s)) return 'SCIENCE_MATH';
  if (/(mapeh|music|arts|physical|health|epp|tle|livelihood)/.test(s)) return 'MAPEH_EPP_TLE';
  return 'LANGUAGES_AP_ESP';
}

/** The seed policy for a subject, before any admin override. */
export function defaultPolicyFor(subject) {
  return { ...DEPED_DEFAULT_WEIGHTS[weightGroupForSubject(subject)] };
}

/**
 * Full pipeline for one student in one class. Mirrors computeGrade in
 * server/grading.js exactly, including which value `finalGrade` resolves to.
 *
 * @param {{percent:number, points:number, component:string}[]} graded
 * @param {object} [policy] component weights
 * @param {{transmute?: boolean, passing?: number}} [opts]
 */
export function computeGrade(graded, policy, opts = {}) {
  const weights = policy || DEPED_DEFAULT_WEIGHTS.LANGUAGES_AP_ESP;
  const passing = opts.passing ?? DEFAULT_PASSING_GRADE;

  const byComponent = {};
  for (const c of COMPONENTS) {
    byComponent[c] = componentPercentage(
      (graded || []).filter(g => (COMPONENTS.includes(g.component) ? g.component : 'WW') === c)
    );
  }

  const { initialGrade: ig, usedWeights, missing } = initialGrade(byComponent, weights);
  const transmuted = opts.transmute === false ? null : transmute(ig);
  const final = opts.transmute === false ? ig : transmuted;

  return {
    componentPercents: byComponent,
    weights,
    usedWeights,
    missingComponents: missing,
    initialGrade: ig === null ? null : Math.round(ig * 100) / 100,
    transmutedGrade: transmuted,
    finalGrade: final === null ? null : Math.round(final),
    passing,
    isPassing: final === null ? null : Math.round(final) >= passing,
  };
}
