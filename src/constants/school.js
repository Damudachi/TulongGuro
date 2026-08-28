/** Grade levels and subjects, shared by the admin console and teacher pages. */
export const GRADE_LEVELS = [
  'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5',
  'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10',
];

export const SUBJECTS = [
  'Filipino', 'English', 'Mathematics', 'Science', 'Araling Panlipunan',
  'MAPEH', 'TLE', 'ESP', 'Pagsasaling-wika', 'Reading & Literacy',
];

/**
 * PH school years run mid-year, so the current one starts in the previous
 * calendar year until roughly June. Derived rather than hardcoded so the list
 * never goes stale.
 */
/**
 * The name a section is actually stored under, given what was typed and the
 * grade level chosen beside it.
 *
 * Admins type the part that distinguishes the block — "Ruby", "Sampaguita",
 * "Newton" — and the grade level is already a field on the same form, so
 * asking them to repeat it in the name produced exactly the drift you would
 * expect: "Grade 6 - Newton" next to "G6 Ruby" next to "Sampaguita", sorted
 * and searched as three unrelated things. The grade is prepended here instead,
 * once, in one shape.
 *
 * A name that already carries its grade is not given a second one: the prefix
 * is stripped first, so "Grade 6 - Ruby" and "grade 6 ruby" and "Ruby" all
 * arrive at the same stored name. Without a grade level there is nothing to
 * prepend and the typed name stands as it is.
 */
export function formatSectionName(name, gradeLevel) {
  const typed = (name || '').replace(/\s+/g, ' ').trim();
  if (!typed) return '';
  if (!gradeLevel) return typed;
  // Any leading "Grade 6", "G6" or "Gr 6" with an optional dash/colon after it.
  const bare = typed.replace(/^(?:grade|gr|g)\s*\.?\s*\d{1,2}\s*[-–—:.]?\s*/i, '').trim();
  // A section genuinely named after its grade and nothing else ("Grade 6")
  // would strip to empty — keep the grade rather than returning "Grade 6 - ".
  return bare ? `${gradeLevel} - ${bare}` : gradeLevel;
}

/**
 * The block's own name, with the house-style grade prefix taken back off —
 * "Grade 6 - Newton" → "Newton".
 *
 * The inverse of what formatSectionName prepends, and the same pattern, so the
 * two cannot drift apart. Used where the grade level is already on screen or
 * already carried by the row, and repeating it just makes the label longer
 * without making it more specific.
 */
export function sectionShortName(name) {
  const typed = (name || '').replace(/\s+/g, ' ').trim();
  if (!typed) return '';
  const bare = typed.replace(/^(?:grade|gr|g)\s*\.?\s*\d{1,2}\s*[-–—:.]?\s*/i, '').trim();
  // "Grade 6" and nothing else is its own name — there is no shorter form.
  return bare || typed;
}

/**
 * What a course shell is called when the admin leaves the name field blank.
 *
 * Subject and SECTION, not subject and grade level. The grade level is its own
 * field on the create form and is already on the shell's badge, so
 * "English — Grade 6" repeated a fact the row was showing anyway, and — worse —
 * gave the same name to two shells whenever one teacher taught the same subject
 * into two blocks of one grade. "English — Newton" is what a teacher calls it
 * out loud, and it is the part that actually tells the two apart.
 *
 * The section's grade prefix is stripped rather than passed through, or the
 * name would come back as "English — Grade 6 - Newton" and put the grade level
 * right back where it was taken from.
 */
export function defaultClassName(subject, sectionName) {
  return [subject, sectionShortName(sectionName)].filter(Boolean).join(' — ');
}

export const SCHOOL_YEARS = (() => {
  const now = new Date();
  const startYear = now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1;
  return [-1, 0, 1].map(offset => `${startYear + offset}-${startYear + offset + 1}`);
})();

export const DEFAULT_SCHOOL_YEAR = SCHOOL_YEARS[1];
