/**
 * transfers.js — what follows a student when they move between sections.
 *
 * Pure, like grading.js and access.js: plain objects in, plain values out. No
 * Prisma and no Express, so every decision here is unit-testable without a
 * database. The lookups live in the route layer, which then asks these
 * functions for the verdict.
 *
 * `isPastDeadline` is injected rather than imported. The server's copy is a
 * private function inside server.js, which cannot be pulled into a test — see
 * the note at the top of tests/deadlines.test.js.
 */

const grading = require('./grading');

/** The target class has no subject, so nothing can be matched to it safely. */
const CLASS_HAS_NO_SUBJECT = 'CLASS_HAS_NO_SUBJECT';
/** Nothing in the student's history teaches this subject at this level/year. */
const NO_MATCHING_CLASS = 'NO_MATCHING_CLASS';

/**
 * The identity a class is merged on.
 *
 * (subject, gradeLevel, schoolYear) — the same key
 * workingAverageAcrossSubjects already groups a student's General Average by,
 * plus the year, because two school years are two different grades.
 *
 * Null subject returns null rather than a key: Class.subject is a controlled
 * vocabulary (SUBJECTS in src/constants/school.js) but is nullable, and
 * treating "unlabelled" as a value would merge a Maths class into a Science
 * one. Unlabelled is ambiguous, and ambiguity is surfaced, never guessed.
 */
function classKey(cls) {
  if (!cls || !cls.subject) return null;
  return `${cls.subject}|${cls.gradeLevel || ''}|${cls.schoolYear || ''}`;
}

/**
 * Every class in `candidates` whose work should count toward `target`.
 *
 * More than one match is not an error: a student who moved twice has two prior
 * classes in the same subject and both are legitimately theirs.
 *
 * @returns {{matched: object[], reason: string|null}} reason is set only when
 *   matched is empty, and names why for the confirm screen.
 */
function matchingSourceClasses(candidates, target) {
  const key = classKey(target);
  if (key === null) return { matched: [], reason: CLASS_HAS_NO_SUBJECT };
  const matched = (candidates || []).filter(c => classKey(c) === key);
  if (matched.length === 0) return { matched: [], reason: NO_MATCHING_CLASS };
  return { matched, reason: null };
}

/**
 * Keys held by more than one class in the target section.
 *
 * Each such key would claim the same carried-over work twice, so the caller
 * surfaces these instead of merging. Unlabelled classes are skipped — they
 * never match anything, so they cannot double-count.
 */
function duplicateTargetKeys(targetClasses) {
  const seen = new Map();
  for (const cls of targetClasses || []) {
    const key = classKey(cls);
    if (key === null) continue;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([key]) => key);
}

/**
 * Activities in the section the student is arriving into that they were never
 * present for, and can no longer do.
 *
 * All three conditions must hold:
 *   1. assigned before they arrived;
 *   2. already closed — one still open stays open to them;
 *   3. they have no submission for it, which matters for a student returning
 *      to a section they were in earlier. Work they already did is theirs.
 *
 * @param {(deadline: string|null) => boolean} isPastDeadline injected; see the
 *   module note above.
 */
function preArrivalActivityIds(activities, transferredAt, alreadySubmittedActivityIds, isPastDeadline) {
  const submitted = new Set(alreadySubmittedActivityIds || []);
  const arrival = new Date(transferredAt).getTime();
  return (activities || [])
    .filter(a => a && !submitted.has(a.id))
    .filter(a => new Date(a.createdAt).getTime() < arrival)
    .filter(a => isPastDeadline(a.deadline))
    .map(a => a.id);
}

/**
 * Carried-over submissions as the {percent, points, component} entries
 * computeGrade already consumes, so a merged grade is computed by exactly the
 * same code as an unmerged one.
 *
 * gradePercentOf applies countsAsGrade, so unvalidated AI drafts, archived and
 * excused rows drop out here — and a validated 0 survives, because `??` is not
 * `||`.
 */
function carriedOverEntries(submissions) {
  const entries = [];
  for (const sub of submissions || []) {
    const percent = grading.gradePercentOf(sub);
    if (percent === null) continue;
    entries.push({
      percent,
      points: sub.activity?.points || 100,
      component: sub.activity?.component || 'WW',
    });
  }
  return entries;
}

/**
 * The sentence a student reads on an auto-excused row.
 *
 * Written to them, not about them — excusedReason is shown on their own
 * gradebook, and "TRANSFER_IN" would be a code where a child needs a reason.
 * Manila calendar date, because that is the day they and their teacher were
 * actually living in; the same reason deadlines resolve in Manila.
 */
function transferExcuseReason(fromSectionLabel, transferredAt) {
  const day = new Date(transferredAt).toLocaleDateString('en-GB', {
    timeZone: 'Asia/Manila', day: 'numeric', month: 'long', year: 'numeric',
  });
  return fromSectionLabel
    ? `Transferred in from ${fromSectionLabel} on ${day}`
    : `Enrolled on ${day}`;
}

module.exports = {
  classKey,
  matchingSourceClasses,
  duplicateTargetKeys,
  preArrivalActivityIds,
  carriedOverEntries,
  transferExcuseReason,
  CLASS_HAS_NO_SUBJECT,
  NO_MATCHING_CLASS,
};
