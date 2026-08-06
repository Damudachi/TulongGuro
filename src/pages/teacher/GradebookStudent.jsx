import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { FileText, Loader2, CalendarOff, Undo2 } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import PageHeader from '../../components/PageHeader';

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
  const [isLoading, setIsLoading] = useState(true);
  const [busyActivityId, setBusyActivityId] = useState(null);

  const load = useCallback(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return setIsLoading(false);
    return apiFetch(`${API_URL}/api/teacher/${user.id}/student/${studentId}/gradebook`)
      .then(r => r.json())
      .then(d => { if (d.success) setData(d); })
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
      const answer = window.prompt(
        `Excuse this student from "${row.activityTitle}"?

` +
        'It will stop counting toward their average instead of being marked missing. ' +
        'Give a short reason — the student sees it.',
        ''
      );
      if (answer === null) return;          // cancelled
      reason = answer.trim();
    } else if (!window.confirm(`Remove the excusal from "${row.activityTitle}"? It will count toward their average again.`)) {
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
      if (!d.success) { alert(d.error || 'That did not work.'); return; }
      await load();
    } catch {
      alert('Network error. Please try again.');
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
              {rows.map(row => {
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
                  {rows.map(row => {
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
          </>
        )}
      </div>
    </>
  );
}
