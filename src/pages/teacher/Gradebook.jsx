import { useState, useEffect } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Users, BarChart2, Plus, Search, BookOpen } from 'lucide-react';
import { API_URL } from '../../config';
import EmptyStateCoach from '../../components/EmptyStateCoach';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

// Derive activity types from backend data so custom types (Essay, Journal, etc.) show up

export default function Gradebook() {
  const [searchParams] = useSearchParams();
  const classIdParam = searchParams.get('classId') || '';
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedClassId, setSelectedClassId] = useState(classIdParam);
  const [teacherClasses, setTeacherClasses] = useState([]); // classes list for section/class picker
  const [selectedSectionId, setSelectedSectionId] = useState('');
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (classIdParam) setSelectedClassId(classIdParam);
  }, [classIdParam]);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return setIsLoading(false);
    // Fetch teacher-level classes for section & class selectors
    fetch(`${API_URL}/api/teacher/${user.id}/classes`).then(r => r.json()).then(d => { if (d.success) setTeacherClasses(d.classes || []); }).catch(() => {});
    // Only fetch gradebook data when a specific class is selected
    if (selectedClassId) {
      const url = `${API_URL}/api/teacher/${user.id}/gradebook?classId=${selectedClassId}`;
      setIsLoading(true);
      fetch(url).then(r => r.json())
        .then(d => { if (d.success) setData(d); })
        .finally(() => setIsLoading(false));
    } else {
      // Clear gradebook view until a class is chosen
      setData(null);
      setIsLoading(false);
    }
  }, [selectedClassId]);

  if (isLoading) return <div className="flex items-center justify-center h-64 text-slate-400 animate-pulse">Loading gradebook...</div>;

  const allActivities = data?.activities || [];
  const classes = data?.classes || [];

  // Derive section list from teacherClasses
  const sections = Array.from(new Map((teacherClasses || []).map(c => [c.section?.id, c.section])).values()).filter(Boolean);
  const classesInSection = selectedSectionId ? (teacherClasses || []).filter(c => c.sectionId === selectedSectionId) : teacherClasses;
  const filteredSections = sections.filter(s => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (s.name || '').toLowerCase().includes(q) || (s._count?.students || (s.students || []).length || 0).toString() === q;
  });

  const relevantClasses = selectedClassId ? classes.filter(c => c.id === selectedClassId) : classes;
  const allStudents = relevantClasses.flatMap(c => c.section?.students || []);
  const uniqueStudents = [...new Map(allStudents.map(s => [s.id, s])).values()];
  const filteredStudents = uniqueStudents.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) || s.username.toLowerCase().includes(search.toLowerCase())
  );

  // Build score lookup: studentId → activityId → submission
  const scoreMap = {};
  allActivities.forEach(activity => {
    (activity.submissions || []).forEach(sub => {
      if (!scoreMap[sub.studentId]) scoreMap[sub.studentId] = {};
      scoreMap[sub.studentId][activity.id] = sub;
    });
  });

  // Group activities by their actual type values (handles Essay, Journal, Quiz, etc.)
  const allTypes = Array.from(new Set(allActivities.map(a => a.type || 'Activity')));
  const typeGroups = {};
  allTypes.forEach(type => {
    typeGroups[type] = allActivities.filter(a => (a.type || 'Activity') === type);
  });

  // Only show types that have activities
  const activeTypes = allTypes.filter(type => typeGroups[type].length > 0);

  // Compute per-student averages per type
  function getStudentTypeAvg(studentId, type) {
    const acts = typeGroups[type];
    if (!acts.length) return null;
    const scores = acts.map(a => {
      const sub = scoreMap[studentId]?.[a.id];
      return sub ? (sub.hitlScore ?? sub.aiScore ?? null) : null;
    }).filter(s => s !== null);
    if (!scores.length) return null;
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }

  // Compute type class averages
  const typeClassAvg = {};
  activeTypes.forEach(type => {
    const allAvgs = uniqueStudents.map(s => getStudentTypeAvg(s.id, type)).filter(a => a !== null);
    typeClassAvg[type] = allAvgs.length ? Math.round(allAvgs.reduce((a, b) => a + b, 0) / allAvgs.length) : null;
  });

  return (
    <div className="p-4 md:p-6 max-w-full mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-slate flex items-center gap-2">
            <BarChart2 className="w-6 h-6 text-brand-navy" /> Gradebook
          </h1>
          <p className="text-slate-500 text-sm">Student averages grouped by Activity, Assignment, and Quiz</p>
        </div>
        {/* top area intentionally left minimal; sections render inside main prompt when no class selected */}
      </div>

      {!selectedClassId ? (
        <div className="max-w-6xl mx-auto p-8 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-2">
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search sections..."
                onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                className="border border-slate-200 px-4 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy w-80" />
              <button onClick={() => { /* no-op: filtering is live */ }} className="px-3 py-2 bg-slate-100 rounded-lg text-slate-700 hover:bg-slate-200">
                <Search className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 justify-center">
            {filteredSections.length === 0 && (
              <div className="text-center text-slate-400 py-6">No sections available</div>
            )}

            {filteredSections.map(s => {
              const sel = s.id === selectedSectionId;
              return (
                <div key={s.id} className={cn('block bg-white border border-slate-200 rounded-xl p-6 hover:shadow-md transition-shadow relative overflow-hidden group min-h-[160px]', sel ? 'ring-2 ring-brand-navy/30' : '')}>
                      <button onClick={() => { navigate(`/teacher/gradebook/section/${s.id}`); }} className="w-full text-left">
                    <div className="mb-2 flex items-center justify-between">
                      <div>
                        <h3 className="font-bold text-lg text-brand-slate">{s.name}</h3>
                        <span className="text-xs text-slate-500">{s._count?.students || (s.students || []).length} students</span>
                      </div>
                      <div className="text-sm text-slate-400">Section</div>
                    </div>
                  </button>

                  {sel && (
                    <div className="mt-3 flex gap-2 flex-wrap">
                      {classesInSection.length === 0 && <div className="text-sm text-slate-400">No classes in this section</div>}
                      {classesInSection.map(c => (
                        <button key={c.id} onClick={() => setSelectedClassId(c.id)}
                          className={cn('px-3 py-2 rounded-lg border text-sm', c.id === selectedClassId ? 'bg-brand-navy text-white border-brand-navy' : 'bg-white border-slate-200 text-slate-700')}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 flex flex-col items-center justify-center text-slate-500 hover:text-brand-navy hover:border-brand-navy hover:bg-blue-50 transition-colors min-h-[160px]">
              <Plus className="w-8 h-8 mb-2" />
              <span className="font-medium">Add Block Section</span>
            </div>
          </div>

          
        </div>
      ) : activeTypes.length === 0 ? (
        <EmptyStateCoach
          icon={<BookOpen className="w-10 h-10 text-brand-navy" />}
          title="No Grades Yet"
          description="There are no graded activities for this class yet. Create an activity and grade submissions to see them in the gradebook."
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-sm">
          <table className="w-full bg-white text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left font-bold text-slate-700 sticky left-0 bg-slate-50 min-w-[200px]">
                  <div className="flex items-center gap-2"><Users className="w-4 h-4" /> Student</div>
                </th>
                {activeTypes.map(type => (
                  <th key={type} className="px-6 py-3 text-center font-bold text-slate-700 min-w-[140px]">
                    <div className="text-sm">{type}</div>
                    <div className="text-[10px] text-slate-400 font-normal">{typeGroups[type].length} item{typeGroups[type].length !== 1 ? 's' : ''}</div>
                  </th>
                ))}
                <th className="px-4 py-3 text-center font-bold text-slate-700 min-w-[100px]">Overall</th>
              </tr>
            </thead>
            <tbody>
              {filteredStudents.length === 0 ? (
                <tr><td colSpan={activeTypes.length + 2} className="py-12 text-center text-slate-400">No students found</td></tr>
              ) : filteredStudents.map((student, idx) => {
                const typeAvgs = activeTypes.map(type => getStudentTypeAvg(student.id, type));
                const validAvgs = typeAvgs.filter(a => a !== null);
                const overall = validAvgs.length ? Math.round(validAvgs.reduce((a, b) => a + b, 0) / validAvgs.length) : null;
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
                    {activeTypes.map((type, i) => {
                      const avg = typeAvgs[i];
                      if (avg === null) return <td key={type} className="px-6 py-3 text-center text-slate-300">—</td>;
                      const color = avg >= 90 ? 'text-green-600 bg-green-50' : avg >= 75 ? 'text-amber-600 bg-amber-50' : 'text-red-600 bg-red-50';
                      return (
                        <td key={type} className="px-6 py-3 text-center">
                          <span className={cn('inline-block px-3 py-1 rounded-full text-xs font-bold', color)}>{avg}%</span>
                        </td>
                      );
                    })}
                    <td className={cn('px-4 py-3 text-center text-sm', overallColor)}>
                      {overall !== null ? `${overall}%` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-brand-navy/5 border-t-2 border-brand-navy/10">
                <td className="px-4 py-3 font-bold text-brand-navy text-sm sticky left-0 bg-brand-navy/5">Class Average</td>
                {activeTypes.map(type => (
                  <td key={type} className="px-6 py-3 text-center">
                    <span className="text-sm font-bold text-brand-navy">
                      {typeClassAvg[type] !== null ? `${typeClassAvg[type]}%` : '—'}
                    </span>
                  </td>
                ))}
                <td className="px-4 py-3 text-center text-sm font-bold text-brand-navy">—</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
