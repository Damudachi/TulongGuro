/**
 * deadlines.js — one source of truth for when an activity closes.
 *
 * Deadlines are stored as a bare "YYYY-MM-DD" string: a calendar date a teacher
 * typed, with no time and no timezone. Every screen used to test it with
 * `new Date(deadline) < new Date()`, which parses that string as midnight
 * *UTC*. In Manila (UTC+8, no daylight saving) that is 8:00 AM on the due date
 * — so an activity due Friday started showing "⏰ Deadline passed" over Friday
 * breakfast, and the server refused re-submissions for the rest of the day.
 *
 * A date-only deadline means the end of that day where the school is. Both
 * halves of the app have to agree on that, so the same rule lives here and in
 * isPastDeadline() in server/server.js — change them together.
 */

/** Philippines is UTC+8 year-round; DepEd schools are the only audience here. */
const PH_UTC_OFFSET_HOURS = 8;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Today's date in Philippine time, as the "YYYY-MM-DD" an <input type="date">
 * takes. The earliest date a deadline students have to meet may be set to.
 *
 * Not `new Date().toISOString().slice(0, 10)`: that is today in UTC, which is
 * still yesterday in Manila until 8 AM. A teacher setting a due date before
 * morning class would have been offered a "today" that was already over.
 */
export function todayInPH() {
  const ph = new Date(Date.now() + PH_UTC_OFFSET_HOURS * 60 * 60 * 1000);
  return ph.toISOString().slice(0, 10);
}

/**
 * The instant an activity actually closes, or null if it never does.
 * A date-only deadline resolves to 23:59:59.999 Philippine time on that date.
 */
export function deadlineInstant(deadline) {
  if (!deadline) return null;
  const m = DATE_ONLY.exec(String(deadline).trim());
  const due = m
    ? new Date(Date.UTC(
        Number(m[1]), Number(m[2]) - 1, Number(m[3]),
        23 - PH_UTC_OFFSET_HOURS, 59, 59, 999
      ))
    : new Date(deadline);
  return Number.isNaN(due.getTime()) ? null : due;
}

/**
 * Whether the deadline has passed. No deadline, or one we cannot parse, is
 * never "past" — a display bug must not lock a student out of submitting.
 */
export function isPastDeadline(deadline) {
  const due = deadlineInstant(deadline);
  return due ? due < new Date() : false;
}

/**
 * Whether an activity is still open, and whether submitting now counts as late.
 *
 * Two dates doing two different jobs. `deadline` is when work stops being on
 * time; `lateUntil` is when it stops being accepted at all. An activity with no
 * late window closes at its deadline — exactly how everything behaved before
 * late submission existed, so nothing changes unless a teacher opts in.
 *
 * Must stay in step with submissionWindow() in server/server.js, which is what
 * actually enforces this. Anything here is a description of that rule, not the
 * rule itself.
 */
export function submissionWindow(activity) {
  // Only a student-submit activity has a submission window at all.
  //
  // On teacher-upload and scores-only work there is nobody to be late: the
  // teacher scans a stack of papers whenever they get to it, and the papers
  // themselves were handed in on paper, on time, days earlier. Treating the due
  // date as a gate meant an activity the teacher was still entering marks for
  // was labelled "(Closed)" to them, and every scan they made afterwards was
  // stamped "Submitted late" against a child who had done nothing of the sort.
  // The date is still shown — it is a real due date — it just does not close
  // anything.
  if (activity && activity.submissionMode && activity.submissionMode !== 'STUDENT_SUBMIT') {
    return { acceptsLate: false, isLate: false, isClosed: false, closesOn: null };
  }
  const acceptsLate = !!activity?.lateUntil;
  return {
    acceptsLate,
    isLate: isPastDeadline(activity?.deadline),
    isClosed: isPastDeadline(activity?.lateUntil || activity?.deadline),
    closesOn: activity?.lateUntil || activity?.deadline || null,
  };
}

/**
 * The due date as a teacher wrote it. Formatted from the date parts directly
 * rather than through the parsed instant, so the label reads the same on a
 * laptop set to any timezone.
 */
export function formatDeadline(deadline, opts = { month: 'short', day: 'numeric' }) {
  if (!deadline) return '';
  const m = DATE_ONLY.exec(String(deadline).trim());
  // Noon UTC is comfortably inside the same calendar day everywhere on earth,
  // so the formatter can never roll the date backwards or forwards.
  const d = m
    ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12))
    : new Date(deadline);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-PH', { ...opts, timeZone: 'UTC' });
}
