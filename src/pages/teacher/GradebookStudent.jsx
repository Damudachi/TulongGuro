import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { FileText, Loader2, CalendarOff, Undo2 } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { getStoredUser } from '../../utils/session';
import PageHeader from '../../components/PageHeader';

import { showAlert, showConfirm, showPrompt } from '../../utils/dialog';
function cn(...cls) { return cls.filter(Boolean).join(' '); }

const STATUS_STYLES = {
  DONE: { label: 'Done', className: 'bg-aqua-100 text-aqua-800' },
  LATE: { label: 'Late', className: 'bg-sun-100 text-sun-800' },
  MISSING: { label: 'Missing', className: 'bg-red-50 text-red-700' },
  UPCOMING: { label: 'Not Yet Submitted', className: 'bg-cream-200 text-navy-600' },
  EXCUSED: { label: 'Excused', className: 'bg-lilac-100 text-lilac-800' }
};

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Grade button — disabled until there's a submission to open. */
function GradeAction({ submissionId, className }) {
  if (!submissionId) {
    return (
      <span className={cn('inline-block text-xs bg-cream-200 text-navy-400 px-4 py-2 rounded-full font-bold cursor-not-allowed', className)}>
        Grade
      </span>
    );
  }
  return (
    <Link to={`/teacher/review/${submissionId}`}
      className={cn('inline-block text-xs bg-royal-500 text-white px-4 py-2 rounded-full font-bold hover:bg-royal-600 transition-colors', className)}>
      Grade
    </Link>
  );
}

/**
 * Excuse / un-excuse toggle. Quiet by default — excusing is occasional, and a
 * prominent button next to every row would compete with Grade, which is the
 * thing a teacher is here to do.
 */
function ExcuseAction({ row, busy, onClick, className }) {
  const excused = row.status === 'EXCUSED';
  return (
    <button type="button" onClick={onClick} disabled={busy}
      title={excused
        ? 'Count this activity toward the student\'s average again'
        : 'Excuse this student — the activity stops counting toward their average instead of being marked missing'}
      className={cn(
        'inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-full font-bold transition-colors disabled:opacity-40',
        excused
          ? 'bg-lilac-100 text-lilac-800 hover:bg-lilac-200'
          : 'bg-cream-200 text-navy-600 hover:bg-cream-300',
        className)}>
      {busy
        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
        : excused ? <Undo2 className="w-3.5 h-3.5" /> : <CalendarOff className="w-3.5 h-3.5" />}
      {excused ? 'Un-excuse' : 'Excuse'}
    </button>
  );
}

export default function GradebookStudent() {
  const { studentId } = useParams();
  const [data, setData] = useState(null);
  // Nobody signed in means there is nothing to fetch, so this must not open on
  // a spinner that only the first commit would take away again.
  const [isLoading, setIsLoading] = useState(() => !!getStoredUser().id);
  const [busyActivityId, setBusyActivityId] = useState(null);

  const load = useCallback(() => {
    const user = getStoredUser();
    if (!user.id) return;
    return apiFetch(`${API_URL}/api/teacher/${user.id}/student/${studentId}/gradebook`)
      .then(r => r.json())
      .then(d => { if (d.success) setData(d); })
      .catch(() => {}) /* a failed read leaves the empty state, which is what renders */
      .finally(() => setIsLoading(false));
  }, [studentId]);

  useEffect(() => { load(); }, [load]);

  /**
   * Excuse the student from an activity, or take the excusal back.
   *
   * An excused activity leaves the average entirely rather than counting as a
   * zero — which is the whole point: a pupil off sick for the quarterly
   * assessment should not be marked down for it. Reversible, so a teacher can
   * undo one without anything having been destroyed.
   */
  const toggleExcused = async (row) => {
    const excusing = row.status !== 'EXCUSED';
    let reason = row.excusedReason || '';
    if (excusing) {
      const answer = await showPrompt(
        'It will stop counting toward their average instead of being marked missing. '
        + 'Give a short reason — the student sees it.',
        {
          title: `Excuse this student from "${row.activityTitle}"?`,
          placeholder: 'e.g. absent — medical certificate on file',
          confirmLabel: 'Excuse this activity',
        }
      );
      if (answer === null) return;          // cancelled
      reason = answer.trim();
    } else if (!(await showConfirm(`Remove the excusal from "${row.activityTitle}"? It will count toward their average again.`,
      { confirmLabel: 'Remove the excusal' }))) {
      return;
    }

    setBusyActivityId(row.activityId);
    try {
      const res = await apiFetch(`${API_URL}/api/teacher/submissions/excuse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityId: row.activityId, studentId, excused: excusing, reason }),
      });
      const d = await res.json();
      if (!d.success) { showAlert(d.error || 'That did not work.'); return; }
      await load();
    } catch {
      showAlert('Network error. Please try again.');
    } finally {
      setBusyActivityId(null);
    }
  };

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-navy-400 font-bold">
      <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading...
    </div>
  );
  if (!data) return <div className="p-8 text-center font-bold text-navy-500">No data.</div>;

  const { student, rows } = data;

  // The distinct sections the carried rows actually came from. A learner who
  // moved twice (A -> B -> C) carries work from both A and B when each taught
  // this subject, so this is not always one section — see the panel below.
  const carriedSections = [...new Set(
    rows.filter(row => row.carriedOver && row.fromSection).map(row => row.fromSection)
  )];

  return (
    <>
      <PageHeader title={student?.name || 'Student'} subtitle={student?.username} back="/teacher/gradebook" />

      <div className="tg-page pt-4 md:pt-0 max-w-5xl">
        {rows.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed border-cream-300 rounded-3xl">
            <FileText className="w-10 h-10 mx-auto mb-3 text-navy-300" />
            <p className="font-bold text-navy-600">No activities found</p>
            <p className="text-sm text-navy-400 mt-1">This student has no activities assigned yet.</p>
          </div>
        ) : (
          <>
            {/* ── Mobile: one card per activity ── */}
            <div className="md:hidden space-y-3">
              {rows.filter(row => !row.carriedOver).map(row => {
                const statusInfo = STATUS_STYLES[row.status] || STATUS_STYLES.UPCOMING;
                return (
                  <div key={row.activityId} className="tg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold text-navy-700">{row.activityTitle}</p>
                        {row.className && <p className="text-xs text-navy-400 font-semibold">{row.className}</p>}
                      </div>
                      <span className={cn('tg-pill shrink-0', statusInfo.className)}>{statusInfo.label}</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t-2 border-cream-200">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider font-extrabold text-navy-400">Due</p>
                        <p className="text-sm font-bold text-navy-700">{formatDate(row.deadline)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider font-extrabold text-navy-400">Grade</p>
                        <p className="text-sm font-bold text-navy-700">{row.grade !== null ? row.grade : '—'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider font-extrabold text-navy-400">Total</p>
                        <p className="text-sm font-bold text-navy-700">{row.totalScore}</p>
                      </div>
                    </div>

                    {row.excusedReason && (
                      <p className="mt-3 text-xs font-semibold text-lilac-800 bg-lilac-50 rounded-xl px-3 py-2">
                        Excused: {row.excusedReason}
                      </p>
                    )}

                    <div className="flex gap-2 mt-3">
                      {row.status !== 'EXCUSED' && <GradeAction submissionId={row.submissionId} className="flex-1 text-center" />}
                      <ExcuseAction row={row} busy={busyActivityId === row.activityId} onClick={() => toggleExcused(row)} className="flex-1 justify-center" />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── Desktop: full table ── */}
            <div className="hidden md:block overflow-x-auto rounded-3xl border-2 border-cream-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-cream-100 border-b-2 border-cream-200">
                    <th className="px-4 py-3.5 text-left font-extrabold text-navy-700">Activity Title</th>
                    <th className="px-4 py-3.5 text-left font-extrabold text-navy-700">Due Date</th>
                    <th className="px-4 py-3.5 text-center font-extrabold text-navy-700">Status</th>
                    <th className="px-4 py-3.5 text-center font-extrabold text-navy-700">Grade</th>
                    <th className="px-4 py-3.5 text-center font-extrabold text-navy-700">Total Score</th>
                    <th className="px-4 py-3.5 text-center font-extrabold text-navy-700">AI Grading</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.filter(row => !row.carriedOver).map(row => {
                    const statusInfo = STATUS_STYLES[row.status] || STATUS_STYLES.UPCOMING;
                    return (
                      <tr key={row.activityId} className="border-b border-cream-200 last:border-0 hover:bg-cream-50">
                        <td className="px-4 py-3.5">
                          <p className="font-bold text-navy-700">{row.activityTitle}</p>
                          {row.className && <p className="text-xs text-navy-400 font-semibold">{row.className}</p>}
                        </td>
                        <td className="px-4 py-3.5 text-navy-600 font-semibold">{formatDate(row.deadline)}</td>
                        <td className="px-4 py-3.5 text-center">
                          <span className={cn('tg-pill', statusInfo.className)}
                            title={row.excusedReason || undefined}>{statusInfo.label}</span>
                          {row.excusedReason && (
                            <p className="text-[11px] text-lilac-700 font-semibold mt-1 max-w-[14rem] mx-auto">{row.excusedReason}</p>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-center font-extrabold text-navy-700">
                          {row.grade !== null ? row.grade : '—'}
                        </td>
                        <td className="px-4 py-3.5 text-center text-navy-600 font-semibold">{row.totalScore}</td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center justify-center gap-2">
                            {row.status !== 'EXCUSED' && <GradeAction submissionId={row.submissionId} />}
                            <ExcuseAction row={row} busy={busyActivityId === row.activityId} onClick={() => toggleExcused(row)} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Carried over from a previous section ──
                Read-only: marked by another teacher, so no Grade or Excuse
                control appears here — this drill-down can show that work but
                must never let this teacher re-grade, excuse or release it. */}
            {rows.some(row => row.carriedOver) && (
              <div className="mt-6">
                {/* A learner who moved twice (A -> B -> C) carries work from
                    both A and B when each taught this subject, so the panel can
                    legitimately hold rows from more than one section. `find`
                    named only the first of them while listing all of them, and
                    the rows themselves show className, not the section — so
                    every row from a second source sat under a heading naming
                    the wrong one. This is the screen a teacher opens to answer
                    "where did this mark come from?", so the source belongs on
                    the row when there is more than one. */}
                <h4 className="text-xs font-extrabold uppercase tracking-wide text-navy-400 mb-2">
                  {carriedSections.length === 1
                    ? `Carried over from ${carriedSections[0]}`
                    : 'Carried over from previous sections'}
                </h4>
                <p className="text-xs text-navy-400 font-semibold mb-3">
                  Marked by their previous teacher. These count toward the subject grade and
                  cannot be changed here.
                </p>
                <div className="rounded-3xl border-2 border-cream-200 bg-white divide-y divide-cream-200 overflow-hidden">
                  {rows.filter(row => row.carriedOver).map(row => (
                    <div key={row.submissionId} className="px-4 py-3 text-sm flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold text-navy-700 truncate">{row.activityTitle}</p>
                        {row.className && (
                          <p className="text-xs text-navy-400 font-semibold truncate">
                            {row.className}
                            {carriedSections.length > 1 && row.fromSection && ` · ${row.fromSection}`}
                          </p>
                        )}
                        {row.feedback && <p className="text-xs text-navy-400 truncate">{row.feedback}</p>}
                      </div>
                      <span className="text-sm font-extrabold text-navy-700 shrink-0">
                        {row.grade === null ? '—' : `${row.grade}/${row.totalScore}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
