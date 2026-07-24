import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Users, FileText } from 'lucide-react';
import { API_URL } from '../../config';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

const STATUS_STYLES = {
  DONE: { label: 'Done', className: 'text-green-700 bg-green-50 border border-green-200' },
  LATE: { label: 'Late', className: 'text-amber-700 bg-amber-50 border border-amber-200' },
  MISSING: { label: 'Missing', className: 'text-red-700 bg-red-50 border border-red-200' },
  UPCOMING: { label: 'Not Yet Submitted', className: 'text-slate-600 bg-slate-100 border border-slate-200' }
};

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function GradebookStudent() {
  const { studentId } = useParams();
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return setIsLoading(false);
    fetch(`${API_URL}/api/teacher/${user.id}/student/${studentId}/gradebook`)
      .then(r => r.json())
      .then(d => { if (d.success) setData(d); })
      .finally(() => setIsLoading(false));
  }, [studentId]);

  if (isLoading) return <div className="flex items-center justify-center h-64 text-slate-400 animate-pulse">Loading...</div>;
  if (!data) return <div className="p-8 text-center text-slate-500">No data.</div>;

  const { student, rows } = data;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-4">
        <Link to="/teacher/gradebook" className="text-sm text-slate-600 hover:underline">← Back to Gradebook</Link>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-brand-navy font-bold text-lg shrink-0">
          {(student?.name || '?').charAt(0)}
        </div>
        <div>
          <h1 className="text-xl font-bold text-brand-slate flex items-center gap-2">
            <Users className="w-5 h-5 text-brand-navy" /> {student?.name}
          </h1>
          <p className="text-sm text-slate-400">{student?.username}</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-20 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
          <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="font-medium">No activities found</p>
          <p className="text-sm">This student has no activities assigned yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-sm">
          <table className="w-full bg-white text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left font-bold text-slate-700">Activity Title</th>
                <th className="px-4 py-3 text-left font-bold text-slate-700">Due Date</th>
                <th className="px-4 py-3 text-center font-bold text-slate-700">Status</th>
                <th className="px-4 py-3 text-center font-bold text-slate-700">Grade</th>
                <th className="px-4 py-3 text-center font-bold text-slate-700">Total Score</th>
                <th className="px-4 py-3 text-center font-bold text-slate-700">AI Grading</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const statusInfo = STATUS_STYLES[row.status] || STATUS_STYLES.UPCOMING;
                return (
                  <tr key={row.activityId} className={cn('border-b border-slate-100', idx % 2 === 0 ? '' : 'bg-slate-50/30')}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-brand-slate">{row.activityTitle}</p>
                      {row.className && <p className="text-xs text-slate-400">{row.className}</p>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(row.deadline)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={cn('inline-block px-3 py-1 rounded-full text-xs font-bold', statusInfo.className)}>
                        {statusInfo.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-brand-slate">
                      {row.grade !== null ? row.grade : '—'}
                    </td>
                    <td className="px-4 py-3 text-center text-slate-600">{row.totalScore}</td>
                    <td className="px-4 py-3 text-center">
                      {row.submissionId ? (
                        <Link to={`/teacher/review/${row.submissionId}`}
                          className="text-xs bg-brand-navy text-white px-3 py-1.5 rounded-md font-medium hover:bg-blue-900 inline-block">
                          Grade
                        </Link>
                      ) : (
                        <span className="text-xs bg-slate-100 text-slate-400 px-3 py-1.5 rounded-md font-medium inline-block cursor-not-allowed">
                          Grade
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
