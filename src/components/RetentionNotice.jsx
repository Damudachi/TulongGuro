import { Archive, Clock, ShieldCheck } from 'lucide-react';
import { RETENTION_MONTHS, PURGE_GRACE_DAYS, formatRetentionDate, computeRetainUntil } from '../constants/retention';

/**
 * What the system keeps, for how long, and what happens after — in the three
 * places a person might go looking for it.
 *
 * One component rather than three near-identical blocks, because this text is
 * the closest thing the app has to a published commitment and three copies
 * would be three chances for one of them to drift into saying something the
 * system does not do.
 *
 * ── Why the wording is careful ──
 *
 * Work is not deleted automatically. The deadline is computed and stored on
 * every submission, but nothing executes it: archiving and purging are carried
 * out by an operator when a school asks. So this says work is kept "at least"
 * until a date, and never that it will be deleted on one.
 *
 * That distinction is the whole point of the component. A teacher who reads
 * "deleted on 30 September" will tell a parent that, and the parent will be
 * owed something the software does not do. See docs/PRIVACY-NOTICE-DRAFT.md,
 * which lists this as one of four claims the privacy notice deliberately does
 * not make.
 *
 * `audience` picks the register, not the facts — all three say the same thing
 * about the same data:
 *   'admin'   — accountable under the Data Privacy Act, gets the full account
 *               including what to do about it.
 *   'teacher' — needs to be able to answer a parent, so gets the statement and
 *               where a request goes, but not the operational detail.
 *   'student' — reads it about their own work, in the second person, short.
 */

/** The current school year in the DepEd form, for the worked example. */
function currentSchoolYear(now = new Date()) {
  // A Philippine school year is named for the calendar years it spans and
  // closes at the end of March, so January to March still belongs to the year
  // that started the previous June.
  const y = now.getUTCFullYear();
  return now.getUTCMonth() <= 2 ? `${y - 1}-${y}` : `${y}-${y + 1}`;
}

function Row({ icon: Icon, title, children }) {
  return (
    <div className="flex items-start gap-3">
      <span className="shrink-0 w-8 h-8 rounded-xl bg-cream-100 grid place-items-center mt-0.5">
        <Icon className="w-4 h-4 text-navy-500" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-extrabold text-navy-700">{title}</p>
        <p className="text-sm text-navy-500 leading-relaxed mt-0.5">{children}</p>
      </div>
    </div>
  );
}

export default function RetentionNotice({ audience = 'teacher' }) {
  const exampleYear = currentSchoolYear();
  const exampleDate = formatRetentionDate(computeRetainUntil(exampleYear));
  const isStudent = audience === 'student';
  const whose = isStudent ? 'Your work' : 'Learner work';

  return (
    <div className="space-y-5">
      <Row icon={Clock} title="How long it is kept">
        {whose} is kept for at least {RETENTION_MONTHS} months after the school year it
        belongs to ends. {exampleDate && (
          <>Work from SY {exampleYear} is kept until at least <strong className="text-navy-700">{exampleDate}</strong>.</>
        )}{' '}
        The clock runs from the end of the school year rather than from the day the work was
        handed in, so a whole year&rsquo;s work reaches its deadline together — a grade queried in
        March can still be traced to the paper it came from.
      </Row>

      <Row icon={Archive} title="What happens after that">
        Nothing happens on its own. After the deadline the school may ask for the work to be
        archived, which hides it from averages, reports and analysis without erasing it, and may
        then ask for it to be permanently deleted{audience === 'admin' ? ` — no sooner than ${PURGE_GRACE_DAYS} days after archiving, so an archive made in error can still be undone` : ''}.
        Both are carried out on request.
      </Row>

      <Row icon={ShieldCheck} title="What is kept afterwards">
        A record of who changed a grade and when outlives the work itself, so a mark issued in the
        past can still be accounted for. It identifies {isStudent ? 'you' : 'the learner'} but does
        not contain {isStudent ? 'your work' : 'their work'}.
      </Row>

      {audience === 'admin' && (
        <p className="text-xs text-navy-400 font-semibold leading-relaxed border-t-2 border-cream-200 pt-4">
          You are the accountable party for your school&rsquo;s learner data under the Data Privacy
          Act (RA 10173). To archive or delete work past its retention deadline, or to act on a
          request from a parent or guardian, contact TulongGuro support — these actions are carried
          out by an operator and are not available from this console.
        </p>
      )}

      {audience === 'teacher' && (
        <p className="text-xs text-navy-400 font-semibold leading-relaxed border-t-2 border-cream-200 pt-4">
          If a parent or guardian asks what is held about their child, or asks for it to be
          corrected or removed, pass the request to your school administrator. Requests are handled
          by a person, not by a setting in the app.
        </p>
      )}

      {isStudent && (
        <p className="text-xs text-navy-400 font-semibold leading-relaxed border-t-2 border-cream-200 pt-4">
          If you or your parent or guardian want to know what is kept about you, ask your teacher or
          your school administrator.
        </p>
      )}
    </div>
  );
}
