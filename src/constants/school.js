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
export const SCHOOL_YEARS = (() => {
  const now = new Date();
  const startYear = now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1;
  return [-1, 0, 1].map(offset => `${startYear + offset}-${startYear + offset + 1}`);
})();

export const DEFAULT_SCHOOL_YEAR = SCHOOL_YEARS[1];
