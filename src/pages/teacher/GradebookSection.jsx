import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Users } from 'lucide-react';
import { API_URL } from '../../config';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

export default function GradebookSection() {
  const { sectionId } = useParams();
  const navigate = useNavigate();
  const [teacherClasses, setTeacherClasses] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return setIsLoading(false);
    fetch(`${API_URL}/api/teacher/${user.id}/classes`).then(r => r.json()).then(d => { if (d.success) setTeacherClasses(d.classes || []); }).finally(() => setIsLoading(false));
  }, [sectionId]);

  const classes = (teacherClasses || []).filter(c => c.sectionId === sectionId);

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
              <div>
                <button onClick={() => navigate(`/teacher/gradebook/class/${cls.id}`)} className="text-sm bg-brand-navy text-white px-3 py-2 rounded-lg">View Grades</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
