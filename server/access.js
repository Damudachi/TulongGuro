/**
 * access.js — tenancy rules for staff reads, as pure functions.
 *
 * Separated from server.js so the decision can be unit-tested. Everything here
 * takes plain objects and returns a boolean: no Prisma, no Express. The
 * database lookup a caller needs stays in the route layer, which then asks
 * these functions for the verdict.
 *
 * This exists because the rule was written out twice — once in
 * staffOwnsActivitySchool and once inline in /api/submissions/:id — and both
 * copies had the same hole, while one of them carried a comment describing a
 * fallback that had never been implemented.
 */

/**
 * Which school a class belongs to, or null if that cannot be established.
 *
 * The section is the primary signal. It is nullable — POST
 * /api/teacher/sections sets Section.schoolId from the creator's own schoolId,
 * which is null for a teacher not yet attached to a school — so the owning
 * teacher's school is the fallback. Only when neither exists is a class
 * genuinely un-attributable.
 */
function classSchoolId(cls) {
  return cls?.section?.schoolId ?? cls?.teacher?.schoolId ?? null;
}

/**
 * Whether a staff caller may read work belonging to this class.
 *
 *   1. The class has a school -> the caller must belong to the same one.
 *      School-scoped rather than owner-scoped on purpose: a coordinator or a
 *      covering teacher legitimately opens a colleague's activity, and that is
 *      the entire reason these routes are not restricted to the exact teacher.
 *
 *   2. No school anywhere — an unaffiliated teacher's own sandbox. There is no
 *      tenant boundary to compare against, so the only honest answer is the
 *      narrow one: you may read it if it is yours.
 *
 * Rung 2 is what was missing. Both call sites wrote the check as
 * `if (schoolId) { ...compare... }` and then fell through to allow, so a class
 * whose section had no schoolId was readable by every authenticated staff
 * account on the platform — student names, usernames, scores, AI feedback and
 * image URLs included.
 *
 * @param {object|null|undefined} cls              class with CLASS_TENANCY_SELECT loaded
 * @param {{callerId: string, callerSchoolId: string|null}} caller
 */
function staffMayAccess(cls, { callerId, callerSchoolId } = {}) {
  if (!cls) return false;
  const schoolId = classSchoolId(cls);
  // A caller with no school of their own never matches a class that has one:
  // `null === 'school-a'` is false, which is the answer we want.
  if (schoolId) return !!callerSchoolId && callerSchoolId === schoolId;
  return !!callerId && cls.teacherId === callerId;
}

module.exports = { classSchoolId, staffMayAccess };
