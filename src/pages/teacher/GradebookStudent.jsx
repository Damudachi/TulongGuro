import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { FileText, Loader2 } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import PageHeader from '../../components/PageHeader';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

const STATUS_STYLES = {
  DONE: { label: 'Done', className: 'bg-aqua-100 text-aqua-800' },
  LATE: { label: 'Late', className: 'bg-sun-100 text-sun-800' },
  MISSING: { label: 'Missing', className: 'bg-red-50 text-red-700' },
  UPCOMING: { label: 'Not Yet Submitted', className: 'bg-cream-200 text-navy-600' }
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

export default function GradebookStudent() {
  const { studentId } = useParams();
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return setIsLoading(false);
    apiFetch(`${API_URL}/api/teacher/${user.id}/student/${studentId}/gradebook`)
      .then(r => r.json())
      .then(d => { if (d.success) setData(d); })
      .finally(() => setIsLoading(false));
  }, [studentId]);

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

                    <GradeAction submissionId={row.submissionId} className="mt-3 w-full text-center" />
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
                          <span className={cn('tg-pill', statusInfo.className)}>{statusInfo.label}</span>
                        </td>
                        <td className="px-4 py-3.5 text-center font-extrabold text-navy-700">
                          {row.grade !== null ? row.grade : '—'}
                        </td>
                        <td className="px-4 py-3.5 text-center text-navy-600 font-semibold">{row.totalScore}</td>
                        <td className="px-4 py-3.5 text-center">
                          <GradeAction submissionId={row.submissionId} />
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
