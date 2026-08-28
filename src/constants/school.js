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
 * What a course shell is called: "English Grade 6 - Newton".
 *
 * Subject, then grade level, then the block — in that order, assembled here
 * rather than typed. The admin supplies only the block's own name ("Newton",
 * "Ruby", "Tesla"); the subject and the grade level are already their own
 * fields on the same form, and asking anyone to repeat them in a name produced
 * exactly the drift you would expect — "English — Newton" beside
 * "Eng G6 Ruby" beside "English Grade 6 - Tesla", three shapes for one thing.
 *
 * The block's grade prefix comes off first (sections are stored house-style as
 * "Grade 6 - Newton", see formatSectionName) or the grade level would land in
 * the name twice: "English Grade 6 - Grade 6 - Newton".
 *
 * Whichever halves exist are used — no block gives "English Grade 6", and no
 * subject or grade gives the block on its own.
 */
export function defaultClassName(subject, sectionName, gradeLevel) {
  const head = [subject, gradeLevel].filter(Boolean).join(' ').trim();
  const block = sectionShortName(sectionName);
  if (!head) return block;
  if (!block) return head;
  return `${head} - ${block}`;
}

/**
 * The name a course shell is saved under, from the create form's four fields.
 *
 * A function rather than a value computed in a component body, because two
 * places need the same answer and must not be able to disagree: the hint under
 * the field that promises what the shell will be called, and the submit that
 * actually sends it.
 *
 * The typed section name wins over the chosen block's own — an admin who types
 * "Tesla" is naming the shell, not re-picking the section — and a blank field
 * falls back to the block that was chosen above it.
 */
export function courseShellName(subject, gradeLevel, typedSectionName, blockSectionName) {
  return defaultClassName(subject, (typedSectionName || '').trim() || blockSectionName, gradeLevel);
}

export const SCHOOL_YEARS = (() => {
  const now = new Date();
  const startYear = now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1;
  return [-1, 0, 1].map(offset => `${startYear + offset}-${startYear + offset + 1}`);
})();

export const DEFAULT_SCHOOL_YEAR = SCHOOL_YEARS[1];
