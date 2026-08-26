/**
 * Shape and arithmetic shared by every hand-written rubric form.
 *
 * Kept out of RubricEditor.jsx so that file exports only its component — the
 * fast-refresh rule — and so the weights rule has one home rather than being
 * re-derived in each page that saves a rubric.
 */

export const BLANK_CRITERION = { name: '', points: 0, description: '' };

/**
 * What the criteria weights add up to.
 *
 * `parseInt` because these come straight from number inputs, where an emptied
 * field is '' rather than 0 — Number('') is 0 but Number(undefined) is NaN, and
 * a NaN total silently fails every comparison it is put through, including the
 * `=== 100` that decides whether a rubric may be saved.
 */
export function totalWeight(criteria) {
  return criteria.reduce((sum, c) => sum + (parseInt(c.points) || 0), 0);
}

/**
 * How many of the activity's points one rubric point is worth.
 *
 * A rubric is authored once and reused across activities that are not all
 * worth the same. A school rubric adding up to 100 attached to a 15-point
 * quiz showed the teacher "27 / 30" on a criterion — a number that exists
 * nowhere in that activity's mark, since the whole paper is only worth 15 —
 * and the same rubric on a 100-point essay showed "1 / 4". Both are the
 * rubric's own units leaking onto a screen that is otherwise counting the
 * activity's.
 *
 * The rubric itself is never touched: this is a display factor, applied where
 * the breakdown is drawn. The stored criterion scores stay in rubric points,
 * which is what the grade percentage is computed from and what the AI and the
 * sliders work in — rescaling those would round a mark differently on every
 * activity the rubric is attached to.
 *
 * Returns 1 when either total is unknown or zero, so an activity with no
 * points set (or a rubric with none) falls back to showing raw rubric points
 * rather than dividing by zero.
 */
export function rubricPointScale(rubricTotal, activityPoints) {
  const rubric = Number(rubricTotal) || 0;
  const activity = Number(activityPoints) || 0;
  if (rubric <= 0 || activity <= 0) return 1;
  return activity / rubric;
}

/**
 * A scaled point value as a teacher would write it: at most one decimal, and
 * no trailing ".0" — 4.5 stays 4.5, 5.0 reads 5.
 *
 * One decimal because scaling rarely lands on a whole number (a 30-point
 * criterion on a 15-point activity is 4.5) and two would imply a precision the
 * rubric does not have.
 */
export function formatRubricPoints(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n * 10) / 10);
}

/**
 * ── The two shapes a rubric can have ──
 *
 * These lived in the teacher's RubricManager while it was the only screen that
 * could author a banded rubric. The admin's School Rubrics page could only ever
 * write the standard shape, so a school publishing a banded rubric had to hand
 * it to a teacher to type in — and the teacher's copy then belonged to them
 * rather than to the school. Moved here so both pages read one definition of
 * what a band is and what happens when a criterion is re-pointed.
 */

/** The ladder a new banded criterion starts on. Editable straight away. */
export const DEFAULT_RANGE_BANDS = [
  { label: 'Excellent', score: 5, description: 'Exceeds expectations.' },
  { label: 'Very Good', score: 4, description: 'Meets expectations.' },
  { label: 'Good', score: 3, description: 'Meets most expectations.' },
  { label: 'Satisfactory', score: 2, description: 'Partially meets.' },
  { label: 'Needs Improvement', score: 1, description: 'Does not meet.' },
];

/**
 * Which shape a rubric is, from an explicit `type` or from its criteria.
 *
 * The stored column is just the criteria array for most rubrics, so the shape
 * has to be inferable: a criterion carrying bands is a range rubric. Falling
 * back rather than defaulting to 'standard' matters, because 'standard' is the
 * shape the 100%-total rule applies to — guessing it for a banded rubric makes
 * a valid rubric unsaveable.
 */
export function detectRubricType(rubric) {
  if (rubric?.type) return rubric.type;
  const criteria = Array.isArray(rubric) ? rubric : rubric?.criteria;
  if (!Array.isArray(criteria) || !criteria.length) return 'standard';
  return criteria.some(c => c?.bands?.length > 0) ? 'range' : 'standard';
}

/** A blank criterion of the given shape, banded or not. */
export function blankCriterion(type) {
  return {
    ...BLANK_CRITERION,
    ...(type === 'range' ? { bands: JSON.parse(JSON.stringify(DEFAULT_RANGE_BANDS)) } : {}),
  };
}

/**
 * Re-point a criterion's scoring bands onto a new criterion maximum.
 *
 * A banded criterion states the same scale twice: once as its Points box and
 * once as the ladder underneath it. The grader is handed BOTH — formatRubricCriteria
 * prints "CRITERION 1: … (30 points maximum)" and then every band's own points —
 * so a criterion raised to 30 while its bands still read 1-5 hands the model two
 * different answers for what the criterion is out of. Authors were left to fix
 * that by retyping five numbers the app can work out exactly.
 *
 * Proportional, anchored on the top band. The ladder's SHAPE is the author's
 * judgement — a 5/4/3/2/1 Likert and a 30/25/15/5/0 weighted ladder say
 * different things about how much a middling answer is worth — so only the
 * scale moves: the highest band lands exactly on the new maximum and the rest
 * keep their share of it. Rounding is plain and monotone, so the ladder never
 * inverts; it can flatten (five bands into a 3-point criterion cannot stay
 * distinct) and that is visible in the editor for the author to overrule.
 *
 * `range` is cleared where it existed. It is free text read off an uploaded
 * document ("27-30"), it wins over `score` in the grading prompt, and it
 * describes a scale that no longer exists once this has run — a stale range is
 * exactly the contradiction this function is here to remove.
 */
export function rescaleBands(bands, newPoints, basisScores) {
  if (!Array.isArray(bands) || bands.length === 0) return bands;
  const target = Number(newPoints) || 0;
  if (target <= 0) return bands;

  const basis = Array.isArray(basisScores) && basisScores.length === bands.length
    ? basisScores.map(n => Number(n) || 0)
    : bands.map(b => Number(b.score) || 0);
  const basisMax = Math.max(...basis);
  // Nothing to keep the proportions of. Bands that have never been pointed
  // (a fresh criterion at 0) are left for the author rather than invented.
  if (basisMax <= 0) return bands;

  const topIndex = basis.indexOf(basisMax);
  return bands.map((b, i) => {
    const scaled = i === topIndex ? target : Math.round((basis[i] / basisMax) * target);
    const next = { ...b, score: scaled };
    if (next.range) next.range = '';
    return next;
  });
}
