import { useState, useEffect } from 'react';
import { Users, Plus, ChevronDown, User } from 'lucide-react';
import { API_URL } from '../../config';

export default function ManageSections() {
  const [sections, setSections] = useState([]);
  const [name, setName] = useState('');
  const [studentsText, setStudentsText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    fetchSections();
  }, []);

  const fetchSections = async () => {
    try {
      const user = JSON.parse(localStorage.getItem('user'));
      if (!user) return;
      const res = await fetch(`${API_URL}/api/teacher/${user.id}/sections`);
      const data = await res.json();
      if (data.success) setSections(data.sections);
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const user = JSON.parse(localStorage.getItem('user'));
      const studentNames = studentsText.split('\n').filter(s => s.trim());

      const res = await fetch(`${API_URL}/api/teacher/sections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, teacherId: user.id, studentsList: studentNames })
      });
      const data = await res.json();

      if (data.success) {
        setName('');
        setStudentsText('');
        fetchSections();
        let msg = data.message || `Created ${data.createdStudents.length} student accounts.`;
        if (data.skippedStudents?.length > 0) {
          msg += `\n\nSkipped (already in section):\n${data.skippedStudents.map(s => `• ${s.name}`).join('\n')}`;
        }
        if (data.linkedStudents?.length > 0) {
          msg += `\n\nLinked existing accounts:\n${data.linkedStudents.map(s => `• ${s.name} (${s.username})`).join('\n')}`;
        }
        alert(msg);
      } else {
        alert("Error: " + data.error);
      }
    } catch (error) {
      alert("Network error.");
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSection = (id) => setExpandedId(prev => prev === id ? null : id);

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-brand-slate">Manage Block Sections</h1>
        <p className="text-slate-500 text-sm">Create sections and auto-generate student accounts • Sections are shared school-wide</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Create Section Form */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h2 className="text-lg font-bold text-brand-slate mb-4 flex items-center">
            <Plus className="w-5 h-5 mr-2 text-brand-navy" />
            Create New Section
          </h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Section Name</label>
              <input type="text" required value={name} onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none"
                placeholder="e.g. Grade 10 - Rizal" />
              <p className="text-xs text-slate-400 mt-1">If this section already exists, students will be added to it.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Student Names (One per line)</label>
              <textarea required value={studentsText} onChange={(e) => setStudentsText(e.target.value)}
                rows={8} className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none"
                placeholder={"Juan Dela Cruz\nMaria Clara\nJose Rizal"} />
              <p className="text-xs text-slate-500 mt-1">Existing students won't be duplicated. Default password: 'password123'.</p>
            </div>
            <button type="submit" disabled={isLoading}
              className="w-full py-3 bg-brand-navy text-white rounded-lg font-medium hover:bg-blue-900 transition-colors disabled:opacity-50 flex items-center justify-center">
              {isLoading ? 'Creating...' : 'Create Section & Accounts'}
            </button>
          </form>
        </div>

        {/* Existing Sections List */}
        <div>
          <h2 className="text-lg font-bold text-brand-slate mb-4 flex items-center">
            <Users className="w-5 h-5 mr-2 text-brand-navy" />
            All Sections
          </h2>
          <div className="space-y-3">
            {sections.length === 0 ? (
              <div className="text-center p-8 border-2 border-dashed border-slate-200 rounded-2xl text-slate-500">
                No sections created yet.
              </div>
            ) : (
              sections.map(section => {
                const isOpen = expandedId === section.id;
                const studentCount = section._count?.students || section.students?.length || 0;
                return (
                  <div key={section.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <button onClick={() => toggleSection(section.id)}
                      className="w-full p-4 flex justify-between items-center hover:bg-slate-50 transition-colors text-left">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-blue-50 text-brand-navy flex items-center justify-center font-bold text-sm">
                          {studentCount}
                        </div>
                        <div>
                          <h3 className="font-bold text-brand-slate">{section.name}</h3>
                          <p className="text-xs text-slate-500">{studentCount} student{studentCount !== 1 ? 's' : ''}</p>
                        </div>
                      </div>
                      <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {isOpen && section.students && (
                      <div className="border-t border-slate-100 px-4 pb-4 pt-2">
                        {section.students.length === 0 ? (
                          <p className="text-sm text-slate-400 py-2">No students in this section.</p>
                        ) : (
                          <div className="space-y-1.5 max-h-60 overflow-y-auto">
                            {section.students.map((s, i) => (
                              <div key={s.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-50">
                                <span className="text-xs text-slate-400 w-5 text-right font-mono">{i + 1}</span>
                                <div className="w-7 h-7 rounded-full bg-brand-navy/10 text-brand-navy flex items-center justify-center text-xs font-bold shrink-0">
                                  {s.name.charAt(0)}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-brand-slate truncate">{s.name}</p>
                                  <p className="text-[11px] text-slate-400 font-mono">ID: {s.username}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
