import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Download, ChevronDown, Loader2 } from 'lucide-react';
import { API_URL } from '../../config';
import PageHeader from '../../components/PageHeader';
import { gradeChip } from '../../utils/grading';
import { usePassingGrade } from '../../utils/useSchool';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

// Score colouring lives in utils/grading and follows the school's passing grade.

export default function GradebookClass() {
  const passingGrade = usePassingGrade();
  const scoreTone = (v) => gradeChip(v, passingGrade, 'text-navy-300');
  const { classId } = useParams();
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exporting, setExporting] = useState(false);
  const menuRef = useRef(null);

  // Dismiss the export menu on an outside click — without this it stays open
  // until something else re-renders.
  useEffect(() => {
    if (!showExportMenu) return;
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowExportMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showExportMenu]);

  const handleExport = async (format) => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    setExporting(true);
    setShowExportMenu(false);
    try {
      const response = await fetch(`${API_URL}/api/teacher/${user.id}/gradebook/export?classId=${classId}&format=${format}`);
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `grades_${classId}.${format === 'csv' ? 'csv' : 'xlsx'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export error:', err);
      alert('Failed to export grades. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return setIsLoading(false);
    fetch(`${API_URL}/api/teacher/${user.id}/gradebook?classId=${classId}`).then(r => r.json()).then(d => { if (d.success) setData(d); }).finally(() => setIsLoading(false));
  }, [classId]);

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-navy-400 font-bold">
      <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading...
    </div>
  );
  if (!data) return <div className="p-8 text-center font-bold text-navy-500">No data.</div>;

  const activities = data.activities || [];
  const classes = data.classes || [];
  const targetClass = classes.find(c => c.id === classId) || {};
  const students = targetClass.section?.students || [];

  const scoreMap = {};
  activities.forEach(a => (a.submissions || []).forEach(s => {
    if (!scoreMap[s.studentId]) scoreMap[s.studentId] = {};
    scoreMap[s.studentId][a.id] = s;
  }));

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

  const exportButton = (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setShowExportMenu(!showExportMenu)}
        disabled={exporting}
        aria-expanded={showExportMenu}
        className="tg-btn-primary !py-2.5 !px-4 text-xs"
      >
        {exporting
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <><Download className="w-4 h-4" /> <span className="hidden sm:inline">Export</span> <ChevronDown className="w-3.5 h-3.5" /></>}
      </button>
      {showExportMenu && (
        <div className="absolute right-0 mt-2 w-52 bg-white border-2 border-cream-200 rounded-2xl shadow-card-lg py-1.5 z-50">
          <button onClick={() => handleExport('csv')}
            className="w-full px-4 py-2.5 hover:bg-cream-100 flex items-center gap-2 text-sm font-bold text-navy-700">
            📄 Export as CSV
          </button>
          <button onClick={() => handleExport('xlsx')}
            className="w-full px-4 py-2.5 hover:bg-cream-100 flex items-center gap-2 text-sm font-bold text-navy-700">
            📊 Export as Excel
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      <PageHeader
        title={targetClass.name || 'Class'}
        subtitle={targetClass.section?.name ? `Section ${targetClass.section.name}` : undefined}
        back
        actions={exportButton}
      />

      <div className="tg-page pt-4 md:pt-0">
        <p className="md:hidden text-[11px] font-bold text-navy-400 mb-2">← Swipe the table to see all columns</p>

        <div className="overflow-x-auto rounded-3xl border-2 border-cream-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-cream-100 border-b-2 border-cream-200">
                <th className="px-4 py-3 text-left font-extrabold text-navy-700 sticky left-0 bg-cream-100 min-w-[190px] z-10">Student</th>
                {activeTypes.map(type => (
                  <th key={type} className="px-5 py-3 text-center font-extrabold text-navy-700 min-w-[130px] align-top">
                    <div>{type}</div>
                    <div className="text-[10px] text-navy-400 font-bold">
                      {(typeGroups[type] || []).length} item{(typeGroups[type] || []).length !== 1 ? 's' : ''}
                    </div>
                    {/* Spell out which activities feed this column — a column only
                        splits off when an activity's Type differs, so seeing the
                        grouping makes a mis-typed activity obvious. */}
                    <div className="text-[10px] text-navy-400 font-semibold leading-snug mt-1 max-w-[150px] mx-auto line-clamp-2">
                      {(typeGroups[type] || []).map(a => a.title).join(', ')}
                    </div>
                  </th>
                ))}
                <th className="px-4 py-3 text-center font-extrabold text-navy-700 min-w-[90px]">GWA</th>
              </tr>
            </thead>
            <tbody>
              {students.length === 0 ? (
                <tr><td colSpan={activeTypes.length + 2} className="py-12 text-center font-bold text-navy-400">No students found</td></tr>
              ) : students.map(student => {
                const gwa = computeGWA(student.id);
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
                    {activeTypes.map((type) => {
                      const avg = getStudentTypeAvg(student.id, type);
                      if (avg === null) return <td key={type} className="px-5 py-3 text-center text-navy-300">—</td>;
                      return (
                        <td key={type} className="px-5 py-3 text-center">
                          <span className={cn('inline-block px-3 py-1 rounded-full text-xs font-extrabold', scoreTone(avg))}>{avg}%</span>
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-center">
                      <span className={cn('font-extrabold text-sm', gwa === null ? 'text-navy-300' : scoreTone(gwa).split(' ')[0])}>
                        {gwa !== null ? `${gwa}%` : '—'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
