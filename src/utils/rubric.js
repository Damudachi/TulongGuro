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
