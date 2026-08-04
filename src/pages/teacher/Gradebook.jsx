import { useState, useEffect } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Users, Search, Download, Loader2, ChevronRight, BarChart2 } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import PageHeader from '../../components/PageHeader';
import { gradeChip } from '../../utils/grading';
import { usePassingGrade } from '../../utils/useSchool';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

/** Shared score ramp for cells and averages. */
// Score colouring lives in utils/grading and follows the school's passing grade.

export default function Gradebook() {
  const passingGrade = usePassingGrade();
  const scoreTone = (v) => gradeChip(v, passingGrade, 'text-navy-300');
  const [searchParams] = useSearchParams();
  const classIdParam = searchParams.get('classId') || '';
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedClassId, setSelectedClassId] = useState(classIdParam);
  const [teacherClasses, setTeacherClasses] = useState([]); // classes list for section/class picker
  const [search, setSearch] = useState('');
  const [exportingSectionId, setExportingSectionId] = useState(null);
  const navigate = useNavigate();

  const handleSectionExport = async (sectionId, e) => {
    e.stopPropagation();
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return;
    setExportingSectionId(sectionId);
    try {
      const response = await apiFetch(`${API_URL}/api/teacher/${user.id}/gradebook/export?sectionId=${sectionId}&format=xlsx`);
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `grades_section_${sectionId}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export error:', err);
      alert('Failed to export grades. Please try again.');
    } finally {
      setExportingSectionId(null);
    }
  };

  useEffect(() => {
    if (classIdParam) setSelectedClassId(classIdParam);
  }, [classIdParam]);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return setIsLoading(false);
    // Fetch teacher-level classes for the section picker
    apiFetch(`${API_URL}/api/teacher/${user.id}/classes`).then(r => r.json()).then(d => { if (d.success) setTeacherClasses(d.classes || []); }).catch(() => {});
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

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-navy-400 font-bold">
      <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading gradebook...
    </div>
  );

  const allActivities = data?.activities || [];
  const classes = data?.classes || [];

  // Derive section list from teacherClasses
  const sections = Array.from(new Map((teacherClasses || []).map(c => [c.section?.id, c.section])).values()).filter(Boolean);
  const filteredSections = sections.filter(s => {
    if (!search) return true;
    return (s.name || '').toLowerCase().includes(search.toLowerCase());
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

  const activeTypes = allTypes.filter(type => typeGroups[type].length > 0);

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

  const typeClassAvg = {};
  activeTypes.forEach(type => {
    const allAvgs = uniqueStudents.map(s => getStudentTypeAvg(s.id, type)).filter(a => a !== null);
    typeClassAvg[type] = allAvgs.length ? Math.round(allAvgs.reduce((a, b) => a + b, 0) / allAvgs.length) : null;
  });

  return (
    <>
      <PageHeader
        title="Gradebook"
        subtitle="Student averages grouped by activity type"
        back={selectedClassId ? '/teacher/gradebook' : false}
      />

      <div className="tg-page pt-4 md:pt-0">
        {!selectedClassId ? (
          /* ── Section picker ── */
          <>
            <div className="relative mb-5 max-w-md">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-navy-400 pointer-events-none" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search sections..."
                onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                className="tg-input !pl-11" />
            </div>

            {filteredSections.length === 0 ? (
              <div className="text-center py-16 border-2 border-dashed border-cream-300 rounded-3xl">
                <BarChart2 className="w-10 h-10 mx-auto mb-3 text-navy-300" />
                <p className="font-bold text-navy-600">No sections available</p>
                <p className="text-sm text-navy-400 mt-1">Create a section to start tracking grades.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredSections.map(s => (
                  /* The card is a plain container: a nested <button> inside a
                     <button> is invalid markup and swallows the inner click. */
                  <div key={s.id} className="tg-card p-5 flex flex-col gap-4">
                    <button
                      onClick={() => navigate(`/teacher/gradebook/section/${s.id}`)}
                      className="text-left group"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="font-display font-extrabold text-lg text-navy-700 truncate group-hover:text-royal-600 transition-colors">
                            {s.name}
                          </h3>
                          <span className="text-xs font-semibold text-navy-500">
                            {s._count?.students || (s.students || []).length} students
                          </span>
                        </div>
                        <ChevronRight className="w-5 h-5 text-navy-300 group-hover:text-royal-500 shrink-0 transition-colors" />
                      </div>
                    </button>

                    <button
                      onClick={(e) => handleSectionExport(s.id, e)}
                      disabled={exportingSectionId === s.id}
                      className="tg-btn-ghost !py-2 !px-4 text-xs self-start"
                    >
                      {exportingSectionId === s.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Download className="w-3.5 h-3.5" />}
                      Export All
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : activeTypes.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed border-cream-300 rounded-3xl">
            <p className="font-bold text-navy-600">No activities yet for this class</p>
            <p className="text-sm text-navy-400 mt-1">Create activities in this class to see grades here.</p>
          </div>
        ) : (
          <>
            <div className="relative mb-4 max-w-md">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-navy-400 pointer-events-none" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search students..." className="tg-input !pl-11" />
            </div>

            <p className="md:hidden text-[11px] font-bold text-navy-400 mb-2">← Swipe the table to see all columns</p>

            <div className="overflow-x-auto rounded-3xl border-2 border-cream-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-cream-100 border-b-2 border-cream-200">
                    <th className="px-4 py-3 text-left font-extrabold text-navy-700 sticky left-0 bg-cream-100 min-w-[190px] z-10">
                      <div className="flex items-center gap-2"><Users className="w-4 h-4" /> Student</div>
                    </th>
                    {activeTypes.map(type => (
                      <th key={type} className="px-5 py-3 text-center font-extrabold text-navy-700 min-w-[130px] align-top">
                        <div>{type}</div>
                        <div className="text-[10px] text-navy-400 font-bold">
                          {typeGroups[type].length} item{typeGroups[type].length !== 1 ? 's' : ''}
                        </div>
                        <div className="text-[10px] text-navy-400 font-semibold leading-snug mt-1 max-w-[150px] mx-auto line-clamp-2">
                          {typeGroups[type].map(a => a.title).join(', ')}
                        </div>
                      </th>
                    ))}
                    <th className="px-4 py-3 text-center font-extrabold text-navy-700 min-w-[90px]">Overall</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.length === 0 ? (
                    <tr><td colSpan={activeTypes.length + 2} className="py-12 text-center font-bold text-navy-400">No students found</td></tr>
                  ) : filteredStudents.map(student => {
                    const typeAvgs = activeTypes.map(type => getStudentTypeAvg(student.id, type));
                    const validAvgs = typeAvgs.filter(a => a !== null);
                    const overall = validAvgs.length ? Math.round(validAvgs.reduce((a, b) => a + b, 0) / validAvgs.length) : null;

                    return (
                      <tr key={student.id} className="border-b border-cream-200 last:border-0 hover:bg-cream-50 transition-colors">
                        <td className="px-4 py-3 sticky left-0 bg-white z-10">
                          <div className="flex items-center gap-2.5">
                            <div className="w-9 h-9 rounded-xl bg-royal-100 flex items-center justify-center text-royal-700 font-extrabold text-xs shrink-0">
                              {student.name.charAt(0)}
                            </div>
                            <div className="min-w-0">
                              <Link to={`/teacher/gradebook/student/${student.id}`}
                                className="font-bold text-navy-700 text-sm hover:text-royal-600 truncate block">
                                {student.name}
                              </Link>
                              <p className="text-xs text-navy-400 font-semibold truncate">{student.username}</p>
                            </div>
                          </div>
                        </td>
                        {activeTypes.map((type, i) => {
                          const avg = typeAvgs[i];
                          if (avg === null) return <td key={type} className="px-5 py-3 text-center text-navy-300">—</td>;
                          return (
                            <td key={type} className="px-5 py-3 text-center">
                              <span className={cn('inline-block px-3 py-1 rounded-full text-xs font-extrabold', scoreTone(avg))}>{avg}%</span>
                            </td>
                          );
                        })}
                        <td className="px-4 py-3 text-center">
                          <span className={cn('font-extrabold text-sm', overall === null ? 'text-navy-300' : scoreTone(overall).split(' ')[0])}>
                            {overall !== null ? `${overall}%` : '—'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-royal-50 border-t-2 border-royal-100">
                    <td className="px-4 py-3 font-extrabold text-royal-700 text-sm sticky left-0 bg-royal-50 z-10">Class Average</td>
                    {activeTypes.map(type => (
                      <td key={type} className="px-5 py-3 text-center">
                        <span className="text-sm font-extrabold text-royal-700">
                          {typeClassAvg[type] !== null ? `${typeClassAvg[type]}%` : '—'}
                        </span>
                      </td>
                    ))}
                    <td className="px-4 py-3 text-center text-sm font-extrabold text-royal-700">—</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
