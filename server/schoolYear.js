/**
 * schoolYear.js — which school year it is, and whether a given one has ended.
 *
 * Philippine school years run roughly June to March, so a year is named for
 * the two calendar years it straddles: "2026-2027" opens in June 2026 and
 * closes around March 2027.
 *
 * This is the server twin of the derivation in `src/constants/school.js`, kept
 * separate for the same reason as grading.js — the client version builds a
 * dropdown list and this one answers questions about stored rows — and kept in
 * step by `server/tests/school-year-parity.test.js`.
 *
 * The pure functions live here rather than inline in server.js so the
 * April-May boundary can be tested without a clock.
 */

/** First calendar year of the school year in progress. */
function schoolYearStartFor(now = new Date()) {
  // getMonth() is 0-indexed, so 5 is June. From June onward the new year has
  // opened; before that we are still inside the one that began last June.
  return now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1;
}

/** e.g. "2026-2027". */
function currentSchoolYear(now = new Date()) {
  const start = schoolYearStartFor(now);
  return `${start}-${start + 1}`;
}

/**
 * The first calendar year in a stored label, for ordering. Returns null for
 * anything unparseable so callers can decide where to put it rather than
 * having it silently sort as year zero.
 */
function schoolYearStart(label) {
  const match = /^(\d{4})\s*-\s*(\d{4})$/.exec(String(label || '').trim());
  return match ? Number(match[1]) : null;
}

/**
 * Whether a section labelled with this year should still show by default.
 *
 * Two deliberate leniencies:
 *
 *   • **null / unrecognised counts as current.** A section whose year cannot
 *     be established is shown, not hidden. Filtering away a roster that nobody
 *     can then find again is a worse failure than one stale entry in a list.
 *   • **A future year counts as current.** A teacher setting up next June's
 *     sections in April must be able to see what they just made.
 *
 * So only a year that has definitely *ended* is archived.
 */
function isCurrentSchoolYear(label, now = new Date()) {
  const start = schoolYearStart(label);
  if (start === null) return true;
  return start >= schoolYearStartFor(now);
}

/**
 * Newest year first, and anything unlabelled ahead of the rest — an
 * unclassifiable section is the one most likely to need attention, so burying
 * it at the bottom of a long list is the wrong default.
 */
function compareSchoolYearsDesc(a, b) {
  const sa = schoolYearStart(a);
  const sb = schoolYearStart(b);
  if (sa === null && sb === null) return 0;
  if (sa === null) return -1;
  if (sb === null) return 1;
  return sb - sa;
}

module.exports = {
  currentSchoolYear,
  schoolYearStart,
  schoolYearStartFor,
  isCurrentSchoolYear,
  compareSchoolYearsDesc,
};
