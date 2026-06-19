import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Users } from 'lucide-react';
import { API_URL } from '../../config';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

export default function GradebookClass() {
  const { classId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return setIsLoading(false);
    fetch(`${API_URL}/api/teacher/${user.id}/gradebook?classId=${classId}`).then(r => r.json()).then(d => { if (d.success) setData(d); }).finally(() => setIsLoading(false));
  }, [classId]);

  if (isLoading) return <div className="flex items-center justify-center h-64 text-slate-400 animate-pulse">Loading...</div>;
  if (!data) return <div className="p-8 text-center text-slate-500">No data.</div>;

  const activities = data.activities || [];
  const classes = data.classes || [];
  // find the target class
  const targetClass = classes.find(c => c.id === classId) || {};
  const students = targetClass.section?.students || [];
  // build scoreMap: studentId -> activityId -> submission
  const scoreMap = {};
  activities.forEach(a => (a.submissions || []).forEach(s => {
    if (!scoreMap[s.studentId]) scoreMap[s.studentId] = {};
    scoreMap[s.studentId][a.id] = s;
  }));

  // Group activities by type
  const allTypes = Array.from(new Set(activities.map(a => a.type || 'Activity')));
  const typeGroups = {};
  allTypes.forEach(t => { typeGroups[t] = activities.filter(a => (a.type || 'Activity') === t); });
  const activeTypes = allTypes.filter(t => (typeGroups[t] || []).length > 0);

  function getStudentTypeAvg(studentId, type) {
    const acts = typeGroups[type] || [];
    if (!acts.length) return null;
    const scores = acts.map(a => {
      const sub = scoreMap[studentId]?.[a.id];
      return sub ? (sub.hitlScore ?? sub.aiScore ?? null) : null;
    }).filter(s => s !== null);
    if (!scores.length) return null;
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }

  function computeGWA(studentId) {
    const typeAvgs = activeTypes.map(t => getStudentTypeAvg(studentId, t)).filter(a => a !== null);
    if (!typeAvgs.length) return null;
    return Math.round(typeAvgs.reduce((a, b) => a + b, 0) / typeAvgs.length);
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="text-sm text-slate-600 hover:underline">← Back to Classes</button>
        <h2 className="text-lg font-bold">{targetClass.name || 'Class'}</h2>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-sm">
        <table className="w-full bg-white text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-3 text-left font-bold text-slate-700 sticky left-0 bg-slate-50 min-w-[200px]">Student</th>
              {activeTypes.map(type => (
                <th key={type} className="px-6 py-3 text-center font-bold text-slate-700 min-w-[140px]">
                  <div className="text-sm">{type}</div>
                  <div className="text-[10px] text-slate-400 font-normal">{(typeGroups[type] || []).length} item{(typeGroups[type] || []).length !== 1 ? 's' : ''}</div>
                </th>
              ))}
              <th className="px-4 py-3 text-center font-bold text-slate-700 min-w-[100px]">GWA</th>
            </tr>
          </thead>
          <tbody>
            {students.length === 0 ? (
              <tr><td colSpan={activities.length + 2} className="py-12 text-center text-slate-400">No students found</td></tr>
            ) : students.map((student, idx) => {
              const gwa = computeGWA(student.id);
              const gwaColor = gwa === null ? 'text-slate-300' : gwa >= 90 ? 'text-green-600 font-extrabold' : gwa >= 75 ? 'text-amber-600 font-bold' : 'text-red-600 font-bold';
              return (
                <tr key={student.id} className={cn('border-b border-slate-100 hover:bg-blue-50/30 transition-colors', idx % 2 === 0 ? '' : 'bg-slate-50/30')}>
                  <td className="px-4 py-3 sticky left-0 bg-white">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-brand-navy font-bold text-xs shrink-0">{student.name.charAt(0)}</div>
                      <div>
                        <p className="font-semibold text-brand-slate text-sm">{student.name}</p>
                        <p className="text-xs text-slate-400">{student.username}</p>
                      </div>
                    </div>
                  </td>
                  {activeTypes.map((type) => {
                    const avg = getStudentTypeAvg(student.id, type);
                    if (avg === null) return <td key={type} className="px-6 py-3 text-center text-slate-300">—</td>;
                    const color = avg >= 90 ? 'text-green-600 bg-green-50' : avg >= 75 ? 'text-amber-600 bg-amber-50' : 'text-red-600 bg-red-50';
                    return (
                      <td key={type} className="px-6 py-3 text-center">
                        <span className={cn('inline-block px-3 py-1 rounded-full text-xs font-bold', color)}>{avg}%</span>
                      </td>
                    );
                  })}
                  <td className={cn('px-4 py-3 text-center text-sm', gwaColor)}>{gwa !== null ? `${gwa}%` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
