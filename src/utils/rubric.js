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
