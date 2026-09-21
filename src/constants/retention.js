/**
 * How long work is kept, as the screens say it.
 *
 * A display copy of server/retention.js. The server is what actually writes a
 * retainUntil onto a row; this exists so a class screen can tell a teacher when
 * the year's work reaches its deadline without a round trip, since the class
 * object already carries the school year the date is derived from.
 *
 * server/tests/retention.test.js fails if the two files disagree — the same
 * arrangement as src/constants/password.js and server/passwordRule.js, for the
 * same reason: a copy that drifts puts a wrong date in front of a teacher who
 * then repeats it to a parent.
 *
 * ── The one thing the wording must not do ──
 *
 * Nothing in this application deletes work on a schedule. The deadline is
 * computed and stored, and archiving and purging are carried out by an operator
 * on request. So every string here says work is kept *at least* until a date,
 * and none of them say it will be deleted on one. That is not hedging — it is
 * the difference between describing the system and making a promise on its
 * behalf. See docs/PRIVACY-NOTICE-DRAFT.md.
 */

/** Months past the close of the school year. Mirrors server/retention.js. */
export const RETENTION_MONTHS = 6;

/** Days a row sits archived before a purge may remove it. */
export const PURGE_GRACE_DAYS = 30;

/**
 * The retention deadline for work belonging to a school year, or null when the
 * year cannot be read. Must match computeRetainUntil in server/retention.js
 * exactly — see the note above on why.
 */
export function computeRetainUntil(schoolYear) {
  const years = String(schoolYear || '').match(/\d{4}/g);
  if (!years || years.length === 0) return null;
  const endYear = Number(years[years.length - 1]);
  if (!Number.isFinite(endYear)) return null;
  return new Date(Date.UTC(endYear, 2 + RETENTION_MONTHS + 1, 0, 23, 59, 59));
}

/**
 * A deadline as a person reads it — "30 Sep 2026".
 *
 * en-PH and UTC. The date is constructed at 23:59:59 UTC, which in Manila
 * (UTC+8) is already the following morning; formatting it in local time would
 * show 1 October for a deadline the server holds as 30 September, and the two
 * screens would disagree by a day for no reason anybody could see.
 */
export function formatRetentionDate(date) {
  if (!date) return null;
  return new Date(date).toLocaleDateString('en-PH', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

/**
 * The short form for a header line: "Work kept to 30 Sep 2026", or null when
 * the school year does not parse.
 *
 * Null rather than a placeholder, so a caller renders nothing instead of a
 * segment reading "Work kept to —", which looks like a deadline that has been
 * lost rather than one that was never set.
 */
export function retentionSummary(schoolYear) {
  const until = computeRetainUntil(schoolYear);
  return until ? `Work kept to ${formatRetentionDate(until)}` : null;
}

/**
 * The sentence used wherever there is room for one. Deliberately "at least".
 */
export function retentionSentence(schoolYear) {
  const until = computeRetainUntil(schoolYear);
  if (!until) {
    return `Work is kept for at least ${RETENTION_MONTHS} months after the school year ends.`;
  }
  return `Work from this class is kept until at least ${formatRetentionDate(until)}`
    + ` — ${RETENTION_MONTHS} months after the school year ends.`;
}
