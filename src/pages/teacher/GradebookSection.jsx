import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Users, Download, Loader2, BookOpen } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { getStoredUser } from '../../utils/session';
import PageHeader from '../../components/PageHeader';
import { fileNameFromDisposition, gradebookFileName } from '../../utils/exportFile';

import { showAlert } from '../../utils/dialog';
export default function GradebookSection() {
  const { sectionId } = useParams();
  const navigate = useNavigate();
  const [teacherClasses, setTeacherClasses] = useState([]);
  // Nobody signed in means there is nothing to fetch, so this must not open on
  // a spinner that only the first commit would take away again.
  const [isLoading, setIsLoading] = useState(() => !!getStoredUser().id);
  const [exportingClassId, setExportingClassId] = useState(null);

  useEffect(() => {
    const user = getStoredUser();
    if (!user.id) return;
    apiFetch(`${API_URL}/api/teacher/${user.id}/classes`).then(r => r.json()).then(d => { if (d.success) setTeacherClasses(d.classes || []); }).catch(() => {}) /* a failed read leaves the empty state, which is what renders */
      .finally(() => setIsLoading(false));
  }, [sectionId]);

  const classes = (teacherClasses || []).filter(c => c.sectionId === sectionId);
  const sectionName = classes[0]?.section?.name;

  const handleExport = async (classId, e) => {
    e.stopPropagation();
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return;
    setExportingClassId(classId);
    try {
      const response = await apiFetch(`${API_URL}/api/teacher/${user.id}/gradebook/export?classId=${classId}&format=xlsx`);
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // The name the API chose — class, term, date. This used to be
      // `grades_<classId>.xlsx`, and classId is a uuid, so every class's
      // export landed in the downloads folder under an unreadable name that
      // looked exactly like every other one.
      a.download = fileNameFromDisposition(response.headers.get('content-disposition'))
        || gradebookFileName(classes.find(c => c.id === classId)?.name, null, 'xlsx');
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export error:', err);
      showAlert('Failed to export grades. Please try again.');
    } finally {
      setExportingClassId(null);
    }
  };

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-navy-400 font-bold">
      <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading...
    </div>
  );

  return (
    <>
      <PageHeader
        title="Subject Classes"
        subtitle={sectionName ? `Section ${sectionName}` : undefined}
        back="/teacher/gradebook"
      />

      <div className="tg-page pt-4 md:pt-0">
        {classes.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed border-cream-300 rounded-3xl">
            <BookOpen className="w-10 h-10 mx-auto mb-3 text-navy-300" />
            <p className="font-bold text-navy-600">No classes found for this section</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {classes.map(cls => (
              <div key={cls.id} className="tg-card p-5 flex flex-col">
                <h3 className="font-display font-extrabold text-lg text-navy-700 truncate">{cls.name}</h3>
                <p className="text-xs text-navy-500 font-semibold mt-0.5 mb-4">
                  {cls.schoolYear} • {cls.section?.name}
                </p>

                <div className="flex items-center gap-1.5 text-sm text-navy-600 mb-4">
                  <Users className="w-4 h-4 text-navy-400" />
                  <span className="font-extrabold text-navy-700">
                    {cls.section?._count?.students ?? (cls.section?.students || []).length ?? 0}
                  </span>
                  Students
                </div>

                <div className="flex items-center gap-2 mt-auto">
                  <button
                    onClick={() => navigate(`/teacher/gradebook/class/${cls.id}`)}
                    className="tg-btn-primary !py-2.5 !px-4 text-xs flex-1"
                  >
                    View Grades
                  </button>
                  <button
                    onClick={(e) => handleExport(cls.id, e)}
                    disabled={exportingClassId === cls.id}
                    className="tg-btn-ghost !py-2.5 !px-4 text-xs"
                  >
                    {exportingClassId === cls.id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Download className="w-3.5 h-3.5" />}
                    Excel
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
