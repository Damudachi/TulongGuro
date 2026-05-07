import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Users, FileText, BookOpen } from 'lucide-react';

const GRADE_LEVELS = ['Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12'];
const SUBJECTS = ['Filipino','English','Mathematics','Science','Araling Panlipunan','MAPEH','TLE','ESP','Pagsasaling-wika','Reading & Literacy'];
const SCHOOL_YEARS = ['2024-2025','2025-2026','2026-2027'];

export default function TeacherDashboard() {
  const [classes, setClasses] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [sections, setSections] = useState([]);
  const [form, setForm] = useState({ name: '', gradeLevel: '', subject: '', schoolYear: '2024-2025', sectionId: '' });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return setIsLoading(false);
    Promise.all([
      fetch(`http://localhost:3000/api/teacher/${user.id}/classes`).then(r => r.json()),
      fetch(`http://localhost:3000/api/teacher/${user.id}/sections`).then(r => r.json())
    ]).then(([clsData, secData]) => {
      if (clsData.success) setClasses(clsData.classes);
      if (secData.success) setSections(secData.sections);
    }).finally(() => setIsLoading(false));
  }, []);

  const handleAddClass = async (e) => {
    e.preventDefault();
    if (!form.sectionId) return alert('Please select a block section.');
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      // Auto-generate class name if not manually set
      const name = form.name || `${form.subject} ${form.gradeLevel}`.trim();
      const res = await fetch('http://localhost:3000/api/teacher/classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, gradeLevel: form.gradeLevel, subject: form.subject, schoolYear: form.schoolYear, teacherId: user.id, sectionId: form.sectionId })
      });
      const data = await res.json();
      if (data.success) {
        setIsModalOpen(false);
        setForm({ name: '', gradeLevel: '', subject: '', schoolYear: '2024-2025', sectionId: '' });
        window.location.reload();
      } else {
        alert('Failed: ' + data.error);
      }
    } catch (e) {
      alert('Network error');
    }
  };

  if (isLoading) return <div className="flex items-center justify-center h-64 text-slate-400 animate-pulse">Loading...</div>;

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-slate">Assigned Classes</h1>
          <p className="text-slate-500 text-sm">Manage your subjects and block sections</p>
        </div>
        <Link to="/teacher/sections" className="bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-900 shadow-md">
          Manage Block Sections
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {classes.map((cls) => (
          <Link key={cls.id} to={`/teacher/class/${cls.id}`}
            className="block bg-white border border-slate-200 rounded-xl p-6 hover:shadow-md transition-shadow relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-1 h-full bg-brand-navy group-hover:w-2 transition-all" />
            <div className="mb-2">
              {(cls.gradeLevel || cls.subject) && (
                <div className="flex gap-2 mb-2 flex-wrap">
                  {cls.gradeLevel && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">{cls.gradeLevel}</span>}
                  {cls.subject && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-100">{cls.subject}</span>}
                </div>
              )}
              <h3 className="font-bold text-lg text-brand-slate">{cls.name}</h3>
              <span className="text-xs text-slate-500">{cls.schoolYear} • {cls.section?.name}</span>
            </div>
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-100">
              <div className="text-sm text-slate-600 flex items-center gap-1">
                <Users className="w-4 h-4 text-slate-400" />
                <span className="font-semibold text-brand-slate">{cls.section?._count?.students || 0}</span> Students
              </div>
              {cls._count?.activities > 0 ? (
                <span className="bg-amber-100 text-brand-amber text-xs font-bold px-2 py-1 rounded-full">
                  {cls._count.activities} activities
                </span>
              ) : (
                <span className="bg-slate-100 text-slate-500 text-xs font-bold px-2 py-1 rounded-full">No activities</span>
              )}
            </div>
          </Link>
        ))}

        <button onClick={() => setIsModalOpen(true)}
          className="border-2 border-dashed border-slate-300 rounded-xl p-6 flex flex-col items-center justify-center text-slate-500 hover:text-brand-navy hover:border-brand-navy hover:bg-blue-50 transition-colors min-h-[160px]">
          <Plus className="w-8 h-8 mb-2" />
          <span className="font-medium">Add Subject Class</span>
        </button>
      </div>

      {/* Add Class Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-xl font-bold text-brand-slate mb-1">Create Subject Class</h2>
            <p className="text-slate-500 text-sm mb-5">Set up a new subject for a block section.</p>
            <form onSubmit={handleAddClass} className="space-y-4">

              {/* Grade Level + Subject side by side */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Grade Level *</label>
                  <select required value={form.gradeLevel} onChange={e => setForm({ ...form, gradeLevel: e.target.value })}
                    className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm">
                    <option value="">-- Grade --</option>
                    {GRADE_LEVELS.map(g => <option key={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Subject *</label>
                  <select required value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })}
                    className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm">
                    <option value="">-- Subject --</option>
                    {SUBJECTS.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              {/* Class Name (auto-generated preview, editable) */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Class Name</label>
                <input type="text" value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder={form.subject && form.gradeLevel ? `${form.subject} — ${form.gradeLevel}` : 'e.g. Filipino — Grade 10'}
                  className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm" />
                <p className="text-xs text-slate-400 mt-1">Leave blank to use "Subject — Grade Level" automatically</p>
              </div>

              {/* School Year */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">School Year *</label>
                <select required value={form.schoolYear} onChange={e => setForm({ ...form, schoolYear: e.target.value })}
                  className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm">
                  {SCHOOL_YEARS.map(sy => <option key={sy}>{sy}</option>)}
                </select>
              </div>

              {/* Block Section */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Block Section *</label>
                <select required value={form.sectionId} onChange={e => setForm({ ...form, sectionId: e.target.value })}
                  className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm">
                  <option value="">-- Choose a section --</option>
                  {sections.map(s => <option key={s.id} value={s.id}>{s.name} ({s._count?.students} students)</option>)}
                </select>
                {sections.length === 0 && (
                  <p className="text-xs text-amber-600 mt-1">⚠ No sections yet. <Link to="/teacher/sections" className="underline">Create a Block Section first.</Link></p>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-2 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50">Cancel</button>
                <button type="submit"
                  className="flex-1 py-2 rounded-lg bg-brand-navy text-white font-medium hover:bg-blue-900">Create Class</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
