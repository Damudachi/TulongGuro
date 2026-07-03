import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Users, Download } from 'lucide-react';
import { API_URL } from '../../config';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

export default function GradebookSection() {
  const { sectionId } = useParams();
  const navigate = useNavigate();
  const [teacherClasses, setTeacherClasses] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [exportingClassId, setExportingClassId] = useState(null);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return setIsLoading(false);
    fetch(`${API_URL}/api/teacher/${user.id}/classes`).then(r => r.json()).then(d => { if (d.success) setTeacherClasses(d.classes || []); }).finally(() => setIsLoading(false));
  }, [sectionId]);

  const classes = (teacherClasses || []).filter(c => c.sectionId === sectionId);

  const handleExport = async (classId, e) => {
    e.stopPropagation();
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return;
    setExportingClassId(classId);
    try {
      const response = await fetch(`${API_URL}/api/teacher/${user.id}/gradebook/export?classId=${classId}&format=xlsx`);
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `grades_${classId}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export error:', err);
      alert('Failed to export grades. Please try again.');
    } finally {
      setExportingClassId(null);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => navigate('/teacher/gradebook')} className="text-sm text-slate-600 hover:underline">← Back to Sections</button>
        <h2 className="text-lg font-bold">Subject Classes</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {classes.length === 0 && (
          <div className="text-center text-slate-400 py-6">No classes found for this section.</div>
        )}

        {classes.map(cls => (
          <div key={cls.id} className="block bg-white border border-slate-200 rounded-xl p-6 hover:shadow-md transition-shadow relative overflow-hidden">
            <h3 className="font-bold text-lg text-brand-slate mb-2">{cls.name}</h3>
            <p className="text-xs text-slate-500 mb-4">{cls.schoolYear} • {cls.section?.name}</p>
            <div className="flex items-center justify-between">
              <div className="text-sm text-slate-600 flex items-center gap-1">
                <Users className="w-4 h-4 text-slate-400" />
                <span className="font-semibold text-brand-slate">
                  {cls.section?._count?.students ?? (cls.section?.students || []).length ?? 0}
                </span>
                Students
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => handleExport(cls.id, e)}
                  disabled={exportingClassId === cls.id}
                  className="text-xs bg-brand-green hover:bg-emerald-600 text-white px-3 py-2 rounded-lg flex items-center gap-1 disabled:opacity-50 font-medium transition-colors"
                >
                  {exportingClassId === cls.id ? (
                    <span className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  Excel
                </button>
                <button onClick={() => navigate(`/teacher/gradebook/class/${cls.id}`)} className="text-sm bg-brand-navy text-white px-3 py-2 rounded-lg">View Grades</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
