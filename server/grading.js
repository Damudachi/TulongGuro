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

/**
 * Wraps a (gradeLevel, subject) -> policy loader in a memo.
 *
 * The analytics endpoints ask for the same handful of pairs once per student.
 * Looking a policy up is a database read, so forty students across three
 * subjects meant up to 120 sequential round trips for at most three distinct
 * answers — several seconds of latency before the page could render.
 *
 * Caches the promise rather than the resolved value, so two callers asking for
 * the same pair before either has returned share one query instead of racing
 * to issue two.
 *
 * The loader is injected, and the memo holds no reference to a school, so the
 * caller decides the lifetime. Every current caller builds one per request:
 * a longer-lived cache would keep serving stale weights after an admin edits a
 * policy, and a coordinator who changes them expects the next page to show it.
 */
function memoPolicyLoader(load) {
  const cache = new Map();
  return (gradeLevel, subject) => {
    // Both parts are in the key: a school may set its own policy per grade AND
    // subject, so "Grade 6 English" and "Grade 3 English" are different
    // answers. Nullish parts normalise to '' and share one bucket, which is
    // correct — they all take the generic default.
    const key = `${gradeLevel || ''}|${subject || ''}`;
    if (!cache.has(key)) cache.set(key, load(gradeLevel, subject));
    return cache.get(key);
  };
}

const COMPONENTS = ['WW', 'PT', 'QA'];
const PASSING_GRADE = 75;

/**
 * How many graded activities a learner needs before a low average is treated as
 * a warning about the learner.
 *
 * One mark is not an average, it is a mark — and the first activity of a
 * quarter is exactly where a hard rubric, an unfamiliar format or a bad day
 * produces a number that says nothing about how the child is doing. Flagging on
 * it told a teacher who had graded a single essay that a third of their class
 * was failing, in a panel whose whole claim is "averaging below the passing
 * grade". Three is the same evidence bar the trend rules already use (they need
 * three scores before calling a slide), so the two agree on what counts as
 * enough to say something.
 *
 * Deliberately about the count of graded work, not the calendar: a class that
 * has genuinely only done one piece of work by December still has one data
 * point, and waiting for the third is the honest reading either way.
 */
const MIN_GRADED_FOR_RISK = 3;

/**
 * Scores are stored as a percentage of the rubric, so 0-100 is the only
 * meaningful range — there is no extra-credit concept anywhere in the model.
 */
const MIN_SCORE = 0;
const MAX_SCORE = 100;

/**
 * Whether a value is usable as a score.
 *
 * Rejects NaN and Infinity as well as out-of-range numbers: `Number("abc")` is
 * NaN, and NaN passes every `<`/`>` comparison you might write by hand, so a
 * bare range check would let it through to Prisma and surface as a 500.
 */
function isValidScore(value) {
  return Number.isFinite(value) && value >= MIN_SCORE && value <= MAX_SCORE;
}

/**
 * Reads a score off a request body: the number it denotes, or null when the
 * value cannot be one.
 *
 * Coercing first and range-checking after is not enough, and the difference is
 * a wrong grade rather than an error. `Number(null)`, `Number('')` and
 * `Number([])` are all 0 — a perfectly valid score — so a request that omitted
 * the mark, or carried a cleared input box, would have recorded a zero for the
 * student and reported success. Booleans coerce too (`Number(true)` is 1).
 *
 * So the type is checked before the value: a real number, or a non-empty
 * string that denotes one. Everything else is "no score sent", which is a
 * refusal, not a zero.
 */
function parseScore(raw) {
  if (typeof raw === 'number') return isValidScore(raw) ? raw : null;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    return isValidScore(n) ? n : null;
  }
  return null;
}

/**
 * Forces a model-supplied score into the storable range.
 *
 * Clamped rather than refused, which is the opposite of parseScore's answer to
 * the same bad input — and deliberately so. A teacher sending an out-of-range
 * score is a caller bug worth a 400; the AI doing it is a fact about a paper
 * that has already been read, and throwing it away would cost the whole
 * grading call, the rubric breakdown and the feedback along with it. The
 * teacher is going to review this before it becomes a grade regardless, so the
 * useful move is to keep the work, bound the number and say it was adjusted.
 *
 * `changed` is what drives Submission.scoreOutOfRange: a silent clamp would
 * leave a teacher looking at a rubric that sums to 120 and a total of 100 with
 * no explanation for the mismatch.
 *
 * @returns {{score: number, changed: boolean}}
 */
function clampScore(raw) {
  // The type is checked before coercing, for the same reason parseScore does
  // it: Number(null), Number('') and Number([]) are all 0. A response that
  // omitted `score` entirely would otherwise clamp to a legitimate-looking
  // zero with `changed: false` — a failing grade for the student and no flag
  // for the teacher, which is worse than the out-of-range case this exists to
  // catch. Anything that is not a real number is garbage, not a mark.
  const n = typeof raw === 'number' ? raw
    : (typeof raw === 'string' && raw.trim() !== '') ? Number(raw)
      : NaN;
  if (!Number.isFinite(n)) return { score: MIN_SCORE, changed: true };
  if (n < MIN_SCORE) return { score: MIN_SCORE, changed: true };
  if (n > MAX_SCORE) return { score: MAX_SCORE, changed: true };
  return { score: n, changed: false };
}

/**
 * Whether a submission counts as a grade of record.
 *
 * The distinction this encodes is the whole point of the human-in-the-loop
 * design: `aiScore` is a draft the model produced, `status: 'GRADED'` is a
 * teacher having looked at it and signed it off. Only the second is a grade.
 *
 * It is written down here, once, because the gradebook export got it wrong —
 * it read `hitlScore ?? aiScore` off every non-archived submission with no
 * status check, so an unreviewed machine score went into the official class
 * record indistinguishable from a validated one. Every other consumer
 * (analytics, the student dashboard, release) filtered on GRADED in its own
 * query; the one place a number leaves the system did not.
 *
 * An excused activity is excluded too. computeGrade already drops a component
 * with nothing graded and renormalises the remaining weights, so an excused
 * paper simply does not enter the calculation — which is what "excused" means,
 * as opposed to a zero.
 *
 * Deliberately NOT gated on `releasedAt`. Release controls what the student
 * can see, not whether the mark is real — a teacher exporting their own record
 * before publishing to the class is doing something normal.
 *
 * @param {{status?: string, archivedAt?: Date|null, excusedAt?: Date|null}|null|undefined} sub
 */
function countsAsGrade(sub) {
  return !!sub && !sub.archivedAt && !sub.excusedAt && sub.status === 'GRADED';
}

/** Whether a teacher has excused this student from the activity. */
function isExcused(sub) {
  return !!sub?.excusedAt;
}

/**
 * The percentage a submission contributes, or null if it is not a grade yet.
 * `??` not `||`: a validated score of 0 is a real mark and must not fall
 * through to whatever the AI originally said.
 */
function gradePercentOf(sub) {
  if (!countsAsGrade(sub)) return null;
  return sub.hitlScore ?? sub.aiScore ?? null;
}

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

/**
 * Which descriptor band a percentage falls into. Null for ungraded.
 *
 * Rounds before comparing, the same way computeGrade's isPassing does
 * (Math.round(final) >= passing) — without this, a grade like 74.6 against a
 * passing line of 75 is isPassing: true but bands as "Did Not Meet
 * Expectations", because isPassing rounds first and this didn't. Every
 * current caller happens to round before calling this, which is exactly the
 * kind of caller discipline that shouldn't be load-bearing.
 */
function bandKeyFor(value, passing = PASSING_GRADE) {
  if (value === null || value === undefined) return null;
  const band = descriptorBands(passing).find(b => Math.round(value) >= b.min);
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

/**
 * The old averaging method: a plain, unweighted mean of each activity's
 * percent — no longer live anywhere in the app (computeGrade's points-weighted
 * average replaced it). Kept only as the "before" side of the fairness-fix
 * regression test in scripts/verify-grading.js and the historical comparison
 * in scripts/grade-migration-report.js; not a fallback path, so don't wire it
 * back into a route on the assumption it's an equivalent, simpler average.
 */
function legacyAverage(graded) {
  const valid = (graded || []).filter(g => typeof g.percent === 'number');
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((s, g) => s + g.percent, 0) / valid.length);
}

module.exports = {
  COMPONENTS,
  PASSING_GRADE,
  MIN_GRADED_FOR_RISK,
  DEPED_DEFAULT_WEIGHTS,
  MIN_SCORE,
  MAX_SCORE,
  isValidScore,
  parseScore,
  clampScore,
  countsAsGrade,
  isExcused,
  gradePercentOf,
  weightGroupForSubject,
  defaultPolicyFor,
  memoPolicyLoader,
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
