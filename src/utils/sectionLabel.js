/**
 * How a block section is named in a picker.
 *
 * A section carries both a name and a grade level, and the two overlap far more
 * often than not: advisers name their block "Grade 6 - Newton" because that is
 * what it is called on the door, and the grade level field then says "Grade 6"
 * again. Printing both unconditionally gave
 * "Grade 6 - Newton · Grade 6 · 10 students", which is the same fact twice in a
 * row before any of the facts that distinguish one section from another.
 *
 * So the grade level is appended only when the name has not already said it.
 * Dropping it outright would be wrong the other way — a section named just
 * "Newton" needs it, and two schools name their blocks both ways.
 */

/** Case- and punctuation-insensitive, with runs of separators collapsed to one
 *  space, so "Grade 6 - Newton" and "grade 6 newton" compare equal. */
function fold(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Whether the section's name already states this grade level.
 *
 * Matched on word boundaries rather than as a bare substring: "Grade 1" is a
 * substring of "Grade 10", so a plain `includes` would hide the level on every
 * Grade 10 section and leave it ambiguous against Grade 1.
 */
export function nameStatesGradeLevel(name, gradeLevel) {
  const level = fold(gradeLevel);
  if (!level) return false;
  // Nothing here needs escaping: fold() has already reduced both sides to
  // letters, digits and single spaces, so `level` cannot carry a regex
  // metacharacter into the pattern.
  return new RegExp(`\\b${level}\\b`).test(fold(name));
}

/**
 * The one-line label for a section in a `<select>`: name, grade level if it adds
 * anything, roster size, and adviser if there is one.
 */
export function sectionOptionLabel(section) {
  const name = section?.name ?? '';
  const parts = [name];
  if (section?.gradeLevel && !nameStatesGradeLevel(name, section.gradeLevel)) {
    parts.push(section.gradeLevel);
  }
  parts.push(`${section?._count?.students ?? 0} students`);
  if (section?.teacher?.name) parts.push(`adviser ${section.teacher.name}`);
  return parts.join(' · ');
}
