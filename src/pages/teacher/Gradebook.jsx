import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Filter, Download, ChevronDown, Users, BarChart2 } from 'lucide-react';
import { API_URL } from '../../config';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

function ScoreCell({ score, max }) {
  if (score === null || score === undefined) return <td className="px-3 py-3 text-center text-slate-300 text-sm">—</td>;
  const pct = (score / (max || 100)) * 100;
  const color = pct >= 90 ? 'text-green-600 bg-green-50' : pct >= 75 ? 'text-amber-600 bg-amber-50' : 'text-red-600 bg-red-50';
  return (
    <td className="px-3 py-3 text-center">
      <span className={cn('inline-block px-2 py-0.5 rounded-full text-xs font-bold', color)}>
        {score}/{max || 100}
      </span>
    </td>
  );
}

export default function Gradebook() {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return setIsLoading(false);
    const url = selectedClassId
      ? `${API_URL}/api/teacher/${user.id}/gradebook?classId=${selectedClassId}`
      : `${API_URL}/api/teacher/${user.id}/gradebook`;
    fetch(url)
      .then(r => r.json())
      .then(d => { if (d.success) setData(d); })
      .finally(() => setIsLoading(false));
  }, [selectedClassId]);

  if (isLoading) return <div className="flex items-center justify-center h-64 text-slate-400 animate-pulse">Loading gradebook...</div>;

  const activities = data?.activities || [];
  const classes = data?.classes || [];

  // Build student roster from selected class or all classes
  const relevantClasses = selectedClassId ? classes.filter(c => c.id === selectedClassId) : classes;
  const allStudents = relevantClasses.flatMap(c => c.section?.students || []);
  const uniqueStudents = [...new Map(allStudents.map(s => [s.id, s])).values()];
  const filteredStudents = uniqueStudents.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) || s.username.toLowerCase().includes(search.toLowerCase())
  );

  // Build score lookup: studentId → activityId → submission
  const scoreMap = {};
  activities.forEach(activity => {
    activity.submissions.forEach(sub => {
      if (!scoreMap[sub.studentId]) scoreMap[sub.studentId] = {};
      scoreMap[sub.studentId][activity.id] = sub;
    });
  });

  // Calculate class average per activity
  const activityAverages = activities.map(a => {
    const graded = a.submissions.filter(s => s.hitlScore !== null || s.aiScore !== null);
    const avg = graded.length ? Math.round(graded.reduce((sum, s) => sum + (s.hitlScore ?? s.aiScore ?? 0), 0) / graded.length) : null;
    return { ...a, avg, gradedCount: graded.length };
  });

  return (
    <div className="p-4 md:p-6 max-w-full mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-slate flex items-center gap-2">
            <BarChart2 className="w-6 h-6 text-brand-navy" /> Gradebook
          </h1>
          <p className="text-slate-500 text-sm">All student scores across activities</p>
        </div>
        <div className="flex gap-3 flex-wrap">
          {/* Class Filter */}
          <div className="relative">
            <select value={selectedClassId} onChange={e => setSelectedClassId(e.target.value)}
              className="appearance-none bg-white border border-slate-200 text-slate-700 py-2 pl-4 pr-8 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy">
              <option value="">All Classes</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          </div>
          {/* Search */}
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search student..."
            className="border border-slate-200 px-4 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy w-48" />
        </div>
      </div>

      {activities.length === 0 ? (
        <div className="text-center py-20 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
          <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No activities yet</p>
          <p className="text-sm">Create activities in your classes to see grades here</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-sm">
          <table className="w-full bg-white text-sm">
            {/* Header */}
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left font-bold text-slate-700 sticky left-0 bg-slate-50 min-w-[180px]">
                  <div className="flex items-center gap-2"><Users className="w-4 h-4" /> Student</div>
                </th>
                {activityAverages.map(a => (
                  <th key={a.id} className="px-3 py-3 text-center font-semibold text-slate-600 min-w-[120px]">
                    <div className="text-xs truncate max-w-[110px] mx-auto" title={a.title}>{a.title}</div>
                    <div className="text-[10px] text-slate-400 font-normal">{a.class?.name} • {a.points}pts</div>
                    {a.avg !== null && (
                      <div className="text-[10px] text-brand-navy font-bold mt-0.5">Avg: {a.avg}</div>
                    )}
                  </th>
                ))}
                <th className="px-3 py-3 text-center font-bold text-slate-700 min-w-[80px]">Overall</th>
              </tr>
            </thead>
            <tbody>
              {filteredStudents.length === 0 ? (
                <tr><td colSpan={activities.length + 2} className="py-12 text-center text-slate-400">No students found</td></tr>
              ) : filteredStudents.map((student, idx) => {
                const studentScores = scoreMap[student.id] || {};
                const gradedScores = activityAverages
                  .map(a => { const s = studentScores[a.id]; return s ? (s.hitlScore ?? s.aiScore ?? null) : null; })
                  .filter(s => s !== null);
                const overall = gradedScores.length
                  ? Math.round(gradedScores.reduce((a, b) => a + b, 0) / gradedScores.length)
                  : null;
                const overallColor = overall === null ? 'text-slate-300' : overall >= 90 ? 'text-green-600 font-extrabold' : overall >= 75 ? 'text-amber-600 font-bold' : 'text-red-600 font-bold';

                return (
                  <tr key={student.id} className={cn('border-b border-slate-100 hover:bg-blue-50/30 transition-colors', idx % 2 === 0 ? '' : 'bg-slate-50/30')}>
                    <td className="px-4 py-3 sticky left-0 bg-white">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-brand-navy font-bold text-xs shrink-0">
                          {student.name.charAt(0)}
                        </div>
                        <div>
                          <p className="font-semibold text-brand-slate text-sm">{student.name}</p>
                          <p className="text-xs text-slate-400">{student.username}</p>
                        </div>
                      </div>
                    </td>
                    {activityAverages.map(a => {
                      const sub = studentScores[a.id];
                      const score = sub ? (sub.hitlScore ?? sub.aiScore ?? null) : null;
                      const isGraded = sub?.status === 'GRADED';
                      return (
                        <td key={a.id} className="px-3 py-3 text-center">
                          {score !== null ? (
                            <Link to={`/teacher/review/${sub.id}`}
                              className={cn('inline-block px-2 py-0.5 rounded-full text-xs font-bold hover:opacity-75 transition-opacity cursor-pointer',
                                isGraded ? (score >= 90 ? 'text-green-600 bg-green-50' : score >= 75 ? 'text-amber-600 bg-amber-50' : 'text-red-600 bg-red-50') : 'text-blue-600 bg-blue-50'
                              )}>
                              {score}/{a.points}
                              {!isGraded && <span className="ml-1 text-[9px] opacity-70">AI</span>}
                            </Link>
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className={cn('px-3 py-3 text-center text-sm', overallColor)}>
                      {overall !== null ? `${overall}%` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* Footer — class averages */}
            <tfoot>
              <tr className="bg-brand-navy/5 border-t-2 border-brand-navy/10">
                <td className="px-4 py-3 font-bold text-brand-navy text-sm sticky left-0 bg-brand-navy/5">Class Average</td>
                {activityAverages.map(a => (
                  <td key={a.id} className="px-3 py-3 text-center">
                    <span className="text-xs font-bold text-brand-navy">{a.avg !== null ? `${a.avg}/${a.points}` : '—'}</span>
                    <div className="text-[10px] text-slate-400">{a.gradedCount} graded</div>
                  </td>
                ))}
                <td className="px-3 py-3 text-center text-sm font-bold text-brand-navy">—</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
