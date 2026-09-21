/**
 * retention.js — how long a submission is kept, and what that means.
 *
 * Extracted from server.js so there is one module the policy lives in and one
 * module the client copy can be checked against. The client needs the same
 * arithmetic to tell a teacher, on the class screen, when this year's work
 * reaches the end of its retention — and a second implementation that drifts
 * from this one would put a wrong date in front of a teacher who then repeats
 * it to a parent. src/constants/retention.js mirrors this file, and
 * tests/retention.test.js fails if the two ever disagree. Same arrangement as
 * passwordRule.js and src/constants/password.js, for the same reason.
 *
 * This file is the authority. The client copy exists to display, never to
 * decide: every retainUntil actually stored on a row is written here.
 */

/**
 * How long a submission is kept after the school year it belongs to closes.
 *
 * Six months. The one number the whole policy is expressed in, so changing the
 * period is this line and not date arithmetic scattered across the file.
 *
 * Shorter than the year this used to be, and deliberately: what is retained here
 * is a photograph of a child's handwritten paper, which is personal data under
 * the Data Privacy Act and is worth keeping only for as long as a grade could be
 * queried. The *grade* is not what this protects — see the note on
 * /api/admin/purge-grades about what survives a purge.
 */
const RETENTION_MONTHS = 6;

/**
 * How long past retainUntil a row must sit, already archived, before
 * purge-grades will delete it.
 *
 * The archive step is reversible and the purge is not, so this is the window in
 * which "that should not have been archived" can still be said by somebody who
 * only noticed when the marks left the averages. Mirrors the thirtyDaysAgo
 * arithmetic in /api/admin/purge-grades, which is the only thing that reads it.
 */
const PURGE_GRACE_DAYS = 30;

/**
 * Retention deadline for a submission: RETENTION_MONTHS past the end of the
 * school year the work belongs to.
 *
 * School years are stored as free text ("2024-2025"), so the end year is the
 * second number when there is one and the only number otherwise. Philippine
 * school years end in the calendar year named second — 2024-2025 ends mid-2025 —
 * and DepEd treats 31 March as the close of the year, so the window runs from
 * there: 2024-2025 work is kept until 30 September 2025.
 *
 * Anchored to the school year rather than to each upload on purpose. Counting
 * six months from the submission itself would delete the first term's papers
 * while the class that produced them is still running, and a teacher opening
 * last term's work to answer a grade query would find the paper gone and the
 * mark unexplainable. A year's work expires together, after the year is over.
 *
 * Returns null for an unparseable school year rather than guessing: a wrong
 * retainUntil either deletes records early or keeps them past what the Data
 * Privacy Act allows, and both are worse than leaving it for an admin to set.
 */
function computeRetainUntil(schoolYear) {
  const years = String(schoolYear || '').match(/\d{4}/g);
  if (!years || years.length === 0) return null;
  const endYear = Number(years[years.length - 1]);
  if (!Number.isFinite(endYear)) return null;
  // Months are 0-indexed and March is 2, so the month the window closes in is
  // 2 + RETENTION_MONTHS. Day 0 of the month after that is the last day of it —
  // which keeps the deadline on a month end whatever the period is set to.
  // Naive month arithmetic would not: 31 March plus six months lands on a
  // 30-day September and rolls forward to 1 October.
  return new Date(Date.UTC(endYear, 2 + RETENTION_MONTHS + 1, 0, 23, 59, 59));
}

/**
 * Where one submission stands, as a word the UI and the admin report can both
 * use.
 *
 *   'unset'     — no deadline could be computed, because the class's school
 *                 year did not parse. Deliberately not treated as "keep
 *                 forever" or "delete now"; an admin resolves it.
 *   'active'    — inside the retention window.
 *   'due'       — past it, still in place. Nothing has archived it yet.
 *   'archived'  — hidden from averages, exports and analytics; not deleted.
 *   'purgeable' — archived, and past the grace period, so purge-grades would
 *                 now delete it.
 *
 * Note what this does NOT say: that anything happens on its own. Nothing in
 * this application deletes a submission on a schedule — archive-grades and
 * purge-grades are called by an operator. Any wording built on top of this
 * must not promise automatic deletion, because there is none. See the same
 * caveat in docs/PRIVACY-NOTICE-DRAFT.md.
 */
function retentionStatus(retainUntil, archivedAt, now = new Date()) {
  if (!retainUntil) return 'unset';
  const deadline = new Date(retainUntil);
  if (archivedAt) {
    const graceEnds = deadline.getTime() + PURGE_GRACE_DAYS * 24 * 60 * 60 * 1000;
    return now.getTime() >= graceEnds ? 'purgeable' : 'archived';
  }
  return now.getTime() > deadline.getTime() ? 'due' : 'active';
}

module.exports = {
  RETENTION_MONTHS,
  PURGE_GRACE_DAYS,
  computeRetainUntil,
  retentionStatus,
};
