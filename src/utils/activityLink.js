/**
 * Where a student's tap on an activity should land.
 *
 * Three screens list activities — the dashboard, the subject list and the
 * subject detail — and a card that goes somewhere different depending on which
 * list it was tapped from is a bug the student experiences as the app being
 * unpredictable. The rule lived in two of those three as copied ternaries and
 * in the third not at all, which is exactly how it drifted: on the subject
 * detail screen an activity with nothing submitted yet had no link on it, so
 * the one card a student most needs to act on was the only dead one.
 *
 * The rule, in the order it is decided:
 *
 *   1. Graded work opens its feedback, because that is what the student is
 *      going back for once a mark exists.
 *   2. A teacher-upload activity opens the read-only detail page. There is
 *      nothing for the student to submit, and sending them to a submit form
 *      they cannot use reads as the app being broken.
 *   3. Everything else opens the submit form for that activity, already
 *      selected — including work that is submitted but not yet marked, since
 *      that is where its status is shown and where a resubmission goes.
 */
export function activityLink(activity) {
  if (!activity?.id) return null;
  if (activity.submission?.status === 'GRADED' && activity.submission?.id) {
    return `/student/output/${activity.submission.id}`;
  }
  if (activity.submissionMode !== 'STUDENT_SUBMIT') {
    return `/student/activity/${activity.id}`;
  }
  return `/student/submit?activityId=${activity.id}`;
}
