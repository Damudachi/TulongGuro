/**
 * Grading engine.
 *
 * Pure functions — no database, no Express — so the policy can be unit-tested
 * and reused by the dashboard, gradebook, analytics and export paths that each
 * used to roll their own averaging.
 *
 * The model follows DepEd Order 8, s. 2015, because that is what Philippine
 * teachers already compute by hand and what report cards have to reconcile
 * with. Weights are defaults, not law here: a school admin can override them
 * per subject (see GRADING POLICY below).
 *
 * Vocabulary, kept identical to the DepEd memo so screens can use the same
 * words teachers already use:
 *
 *   Component        Written Work (WW), Performance Task (PT),
 *                    Quarterly Assessment (QA).
 *   Percentage Score total raw points earned ÷ total raw points possible,
 *                    within one component. NOT the mean of each activity's
 *                    percentage — see the note on fairness below.
 *   Weighted Score   Percentage Score × the component's weight.
 *   Initial Grade    sum of the Weighted Scores.
 *   Transmuted Grade Initial Grade mapped through the transmutation table.
 */

/**
 * Default component weights by subject group, Grades 1–10.
 * Schools override these per subject; these are only the seed values.
 */
const DEPED_DEFAULT_WEIGHTS = {
  // Languages, Araling Panlipunan, Edukasyon sa Pagpapakatao
  LANGUAGES_AP_ESP: { WW: 30, PT: 50, QA: 20 },
  // Science and Mathematics
  SCIENCE_MATH: { WW: 40, PT: 40, QA: 20 },
  // MAPEH, EPP, TLE
  MAPEH_EPP_TLE: { WW: 20, PT: 60, QA: 20 },
};

/** Subject name -> default weight group. Matching is loose on purpose: subjects
 *  are free text in this app ("English", "Filipino 6", "Math"). */
function weightGroupForSubject(subject) {
  const s = (subject || '').toLowerCase();
  if (/(math|science|agham|matematika)/.test(s)) return 'SCIENCE_MATH';
  if (/(mapeh|music|arts|physical|health|epp|tle|livelihood)/.test(s)) return 'MAPEH_EPP_TLE';
  return 'LANGUAGES_AP_ESP';
}

/** The seed policy for a subject, before any admin override. */
function defaultPolicyFor(subject) {
  return { ...DEPED_DEFAULT_WEIGHTS[weightGroupForSubject(subject)] };
}

const COMPONENTS = ['WW', 'PT', 'QA'];
const PASSING_GRADE = 75;

/**
 * Percentage Score for one component.
 *
 * This is the fairness fix. The old code averaged each activity's percentage,
 * which silently made a 50-point activity count as much as a 100-point one —
 * a student who scored 90/100 and 40/50 was shown 85 instead of 87. Summing
 * raw points first is both what DepEd specifies and what teachers expect.
 *
 * @param {{percent: number, points: number}[]} entries graded work in one component
 * @returns {number|null} 0–100, or null when nothing is graded yet
 */
function componentPercentage(entries) {
  const valid = (entries || []).filter(e => e && typeof e.percent === 'number' && e.points > 0);
  if (valid.length === 0) return null;
  const earned = valid.reduce((sum, e) => sum + (e.percent / 100) * e.points, 0);
  const possible = valid.reduce((sum, e) => sum + e.points, 0);
  if (possible === 0) return null;
  return (earned / possible) * 100;
}

/**
 * Combine component percentages into an Initial Grade.
 *
 * Components with nothing graded yet are dropped and the remaining weights are
 * renormalised, so a quarter still reads sensibly before the Quarterly
 * Assessment exists. Without that, every student would sit at ~80% of their
 * true grade until exam week and the at-risk list would be nonsense.
 *
 * @returns {{initialGrade: number|null, usedWeights: object, missing: string[]}}
 */
function initialGrade(componentPercents, weights) {
  const present = COMPONENTS.filter(c => typeof componentPercents[c] === 'number');
  const missing = COMPONENTS.filter(c => !present.includes(c));
  if (present.length === 0) return { initialGrade: null, usedWeights: {}, missing };

  const totalWeight = present.reduce((sum, c) => sum + (weights[c] || 0), 0);
  if (totalWeight === 0) return { initialGrade: null, usedWeights: {}, missing };

  const usedWeights = {};
  let grade = 0;
  for (const c of present) {
    const w = (weights[c] || 0) / totalWeight;
    usedWeights[c] = Math.round(w * 1000) / 10;   // percent, 1dp
    grade += componentPercents[c] * w;
  }
  return { initialGrade: grade, usedWeights, missing };
}

/**
 * DepEd transmutation table, expressed as its two linear segments rather than
 * 60 hard-coded rows — the published table is exactly piecewise linear:
 *
 *   Initial 60..100 -> 75..100, one grade point per 1.6 initial points
 *   Initial  0..60  -> 60..75,  one grade point per 4.0 initial points
 *
 * Note this floors within each band rather than rounding. The table is banded
 * ("98.40 – 99.99 -> 99"), so rounding would push every band boundary one grade
 * too high — an Initial Grade of 98.39 transmutes to 98, not 99. Getting this
 * wrong inflates report cards, so `npm run verify:grading` checks the whole
 * table row by row.
 *
 * Verify against your division memo before going live; the table has been
 * revised since, and this is the DO 8 s.2015 version.
 */
function transmute(initial) {
  if (initial === null || initial === undefined || Number.isNaN(initial)) return null;
  const ig = Math.max(0, Math.min(100, initial));
  const step = ig >= 60 ? 1.6 : 4;
  // Guard against binary float error at band edges: 38.4/1.6 is 23.999… in
  // IEEE 754, which would floor to 23 and cost the student a grade point.
  const bands = Math.floor(Number(((ig - 60) / step).toFixed(6)));
  return Math.max(60, Math.min(100, 75 + bands));
}

/**
 * Full pipeline for one student in one class.
 *
 * @param {{percent:number, points:number, component:string}[]} graded
 * @param {object} [policy] component weights; defaults applied by caller
 * @param {object} [opts] { transmute: boolean, passing: number }
 */
function computeGrade(graded, policy, opts = {}) {
  const weights = policy || DEPED_DEFAULT_WEIGHTS.LANGUAGES_AP_ESP;
  const passing = opts.passing ?? PASSING_GRADE;

  const byComponent = {};
  for (const c of COMPONENTS) {
    // Anything without a recognised component counts as Written Work — the
    // safe default for existing activities created before components existed.
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

/**
 * DepEd DO 8 s.2015 descriptor bands, anchored to a school's passing grade.
 *
 * The dashboards used a fixed ladder — 90 Excellent, 80 Doing well, then
 * "passing" — which inverted for any school that set its passing grade above
 * 80: a student on 82 in a school that passes at 85 was counted as "Doing well"
 * while actually failing, and appeared in the healthy part of the class-spread
 * bar. Dropping every rung at or below the passing grade keeps the ladder
 * strictly descending for any threshold, and guarantees the lowest passing band
 * starts exactly where the school says passing starts.
 *
 * Must stay in step with bandsFor() in src/utils/grading.js, which adds the
 * presentation colours for the same keys.
 */
function descriptorBands(passing = PASSING_GRADE) {
  const p = Number(passing) || PASSING_GRADE;
  return [
    { key: 'outstanding', min: 90, label: 'Outstanding' },
    { key: 'verySatisfactory', min: 85, label: 'Very Satisfactory' },
    { key: 'satisfactory', min: 80, label: 'Satisfactory' },
  ].filter(b => b.min > p).concat([
    { key: 'passing', min: p, label: 'Fairly Satisfactory' },
    { key: 'failing', min: 0, label: 'Did Not Meet Expectations' },
  ]);
}

/** Which descriptor band a percentage falls into. Null for ungraded. */
function bandKeyFor(value, passing = PASSING_GRADE) {
  if (value === null || value === undefined) return null;
  const band = descriptorBands(passing).find(b => value >= b.min);
  return band ? band.key : null;
}

/**
 * Count percentages into descriptor bands. Returns every band key present at
 * this passing grade (zeroed), plus `notGraded`, so the UI can render the whole
 * ladder without guessing which rungs exist.
 */
function bandCounts(values, passing = PASSING_GRADE) {
  const counts = { notGraded: 0 };
  for (const b of descriptorBands(passing)) counts[b.key] = 0;
  for (const v of values || []) {
    if (v === null || v === undefined) { counts.notGraded++; continue; }
    const key = bandKeyFor(v, passing);
    if (key) counts[key]++;
  }
  return counts;
}

/**
 * GAMIFICATION — STARS
 *
 * Stars are the app's single earned currency, awarded per graded activity and
 * never spent. Badges are separate: they are one-off achievements with their own
 * conditions (see computeBadges in server.js), not a star tally under a
 * different name.
 *
 * The rule, stated once here so it can be documented and tested rather than
 * inferred from a filter expression:
 *
 *   Outstanding        90 and above          3 stars
 *   Very Satisfactory  85 to 89              2 stars
 *   Passing            passingGrade to 84    1 star
 *   Below passing      under passingGrade    0 stars
 *
 * Anchored to the school's passing grade, so a school that passes at 80 does not
 * hand out stars for a 76. The upper rungs collapse into the passing rung when
 * the threshold is set above them, which is why this walks the same descriptor
 * ladder as the dashboards instead of hardcoding 90/85/75.
 */
const STAR_AWARDS = { outstanding: 3, verySatisfactory: 2, satisfactory: 1, passing: 1, failing: 0 };

/** Stars earned by one graded percentage. */
function starsForScore(percent, passing = PASSING_GRADE) {
  const key = bandKeyFor(percent, passing);
  return key ? (STAR_AWARDS[key] ?? 0) : 0;
}

/**
 * Total stars across a student's graded submissions.
 *
 * Uses `??`, not `||`. With `||` a teacher-assigned score of 0 was falsy and
 * fell through to the AI's score, so a pupil the teacher had marked zero could
 * still collect 3 stars off the AI's original 95.
 */
function starsFor(submissions, passing = PASSING_GRADE) {
  return (submissions || []).reduce((total, s) => {
    const percent = s.hitlScore ?? s.aiScore ?? null;
    return total + (percent === null ? 0 : starsForScore(percent, passing));
  }, 0);
}

/** The average the app shows today: a plain mean of each activity's percent. */
function legacyAverage(graded) {
  const valid = (graded || []).filter(g => typeof g.percent === 'number');
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((s, g) => s + g.percent, 0) / valid.length);
}

module.exports = {
  COMPONENTS,
  PASSING_GRADE,
  DEPED_DEFAULT_WEIGHTS,
  weightGroupForSubject,
  defaultPolicyFor,
  componentPercentage,
  initialGrade,
  transmute,
  computeGrade,
  descriptorBands,
  bandKeyFor,
  bandCounts,
  STAR_AWARDS,
  starsForScore,
  starsFor,
  legacyAverage,
};
