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

/**
 * Which school a learner belongs to, or null if that cannot be established.
 *
 * Their own column first, their section's second. Both directions occur:
 * User.schoolId was added after Section.schoolId — scripts/backfill-student-school.js
 * exists for exactly the rosters that predate it — while a learner moved
 * between sections can carry a school of their own before the new section has
 * one stamped.
 */
function studentSchoolId(student) {
  return student?.schoolId ?? student?.section?.schoolId ?? null;
}

/**
 * Whether a staff caller may read this learner's record.
 *
 * authorizePath lets teachers and admins into /api/student/... deliberately —
 * the teacher analytics screen charts a selected learner through the same
 * endpoint the learner's own dashboard uses — and a comment there said
 * ownership was checked in the handlers. It was not, in any of the five. The
 * id in the URL was the only thing deciding whose record came back, and
 * releaseFilterFor withholds unreleased marks from students but not from
 * staff, so an outside teacher saw grades the learner's own school had not
 * published yet.
 *
 * Same two rungs as staffMayAccess, for the same reasons:
 *
 *   1. The learner has a school -> the caller must belong to the same one.
 *      School-scoped rather than adviser-scoped because a subject teacher who
 *      does not advise the section still teaches the learner, and a coordinator
 *      reads across the whole year level.
 *
 *   2. No school anywhere — an unaffiliated teacher's sandbox. Nothing to
 *      compare, so the narrow answer: only their section's adviser. Falling
 *      through to allow here is the exact shape of the bug staffMayAccess was
 *      written to close.
 *
 * @param {object|null|undefined} student            with `schoolId` and `section` loaded
 * @param {{callerId: string, callerSchoolId: string|null}} caller
 */
function staffMayReadStudent(student, { callerId, callerSchoolId } = {}) {
  if (!student) return false;
  const schoolId = studentSchoolId(student);
  if (schoolId) return !!callerSchoolId && callerSchoolId === schoolId;
  return !!callerId && student.section?.teacherId === callerId;
}

/**
 * A submission row that represents work, rather than a placeholder for work
 * that has not happened.
 *
 * Enrolling a learner back-fills one PENDING row per activity already in their
 * section's classes, so the activity roster can list everybody as awaiting
 * work. Counting those as submissions told an admin that a learner enrolled a
 * minute ago had "2 submitted", refused to delete a class nobody had submitted
 * to, and kept accounts alive to protect work that did not exist.
 *
 * Three signals, not one. An image means they turned something in. A score
 * means a mark was recorded — score entry writes those without an upload, so
 * reading "no image" as "no work" would delete the account of a learner whose
 * only grade was typed in by hand. A placeholder carries none of the three.
 *
 * Shaped as a Prisma `where` so it can be dropped straight into a filtered
 * relation count: `_count: { select: { submissions: { where: REAL_WORK } } }`.
 */
const REAL_WORK = {
  OR: [
    { imageUrl: { not: null } },
    { hitlScore: { not: null } },
    { aiScore: { not: null } },
  ],
};

module.exports = {
  classSchoolId, staffMayAccess, studentSchoolId, staffMayReadStudent, REAL_WORK,
};
