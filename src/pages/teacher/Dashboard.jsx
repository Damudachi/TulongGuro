import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Users, FileText, BookOpen, Filter } from 'lucide-react';
import { API_URL } from '../../config';

const GRADE_LEVELS = ['Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6'];
const SUBJECTS = ['Filipino','English','Mathematics','Science','Araling Panlipunan','MAPEH','TLE','ESP','Pagsasaling-wika','Reading & Literacy'];
const SCHOOL_YEARS = ['2024-2025','2025-2026','2026-2027'];

export default function TeacherDashboard() {
  const [classes, setClasses] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [sections, setSections] = useState([]);
  const [form, setForm] = useState({ name: '', gradeLevel: '', subject: '', schoolYear: '2024-2025', sectionId: '' });
  const [filters, setFilters] = useState({ gradeLevel: '', subject: '' });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return setIsLoading(false);
    Promise.all([
      fetch(`${API_URL}/api/teacher/${user.id}/classes`).then(r => r.json()),
      fetch(`${API_URL}/api/teacher/${user.id}/sections`).then(r => r.json())
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
      const res = await fetch(`${API_URL}/api/teacher/classes`, {
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

  const filteredClasses = classes.filter((cls) => {
    if (filters.gradeLevel && cls.gradeLevel !== filters.gradeLevel) return false;
    if (filters.subject && cls.subject !== filters.subject) return false;
    return true;
  });

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

      {/* Quick Access — Rubrics */}
      <Link to="/teacher/rubrics" className="block mb-6 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4 hover:shadow-md transition-shadow group">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-brand-navy/10 flex items-center justify-center">
              <span className="text-lg">📋</span>
            </div>
            <div>
              <p className="font-bold text-brand-slate text-sm">Set Up Your Grading Rubrics</p>
              <p className="text-xs text-slate-500">Use DepEd-standard rubrics for consistent, standardized grading across your classes.</p>
            </div>
          </div>
          <span className="text-brand-navy font-medium text-sm group-hover:underline">Go to Rubrics →</span>
        </div>
      </Link>

      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-brand-slate mb-3">
          <Filter className="w-4 h-4" /> Filter
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Grade Level</label>
            <select
              value={filters.gradeLevel}
              onChange={(e) => setFilters((prev) => ({ ...prev, gradeLevel: e.target.value }))}
              className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm"
            >
              <option value="">All grade levels</option>
              {GRADE_LEVELS.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Subject</label>
            <select
              value={filters.subject}
              onChange={(e) => setFilters((prev) => ({ ...prev, subject: e.target.value }))}
              className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm"
            >
              <option value="">All subjects</option>
              {SUBJECTS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredClasses.map((cls) => (
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
            {/* Activities list (recent) */}
            {cls.activities && cls.activities.length > 0 && (
              <div className="mt-3 text-sm text-slate-600">
                <div className="text-xs text-slate-400 mb-1">Recent activities</div>
                <ul className="space-y-1">
                  {cls.activities.map(a => (
                    <li key={a.id} className="flex items-center justify-between">
                      <span className="truncate">{a.title} <span className="text-[11px] text-slate-400">• {a.type}</span></span>
                      <span className="text-[11px] text-slate-400">{a._count?.submissions || 0}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
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
