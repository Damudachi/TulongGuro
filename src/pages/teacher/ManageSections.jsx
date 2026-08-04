import { useState, useEffect, useRef } from 'react';
import { Users, Plus, ChevronDown, X, Upload, Pencil, UserPlus, Loader2, Search } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { GRADE_LEVELS } from '../../constants/school';

export default function ManageSections() {
  const [sections, setSections] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [name, setName] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [studentsText, setStudentsText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const fileInputRef = useRef(null);
  const [editingSectionId, setEditingSectionId] = useState(null);
  const [addStudentsText, setAddStudentsText] = useState('');
  const [isAddingStudents, setIsAddingStudents] = useState(false);
  const [isExtractingEdit, setIsExtractingEdit] = useState(false);
  const editFileRef = useRef(null);

  useEffect(() => { fetchSections(); }, []);

  const fetchSections = async () => {
    try {
      const user = JSON.parse(localStorage.getItem('user'));
      if (!user) return;
      const res = await apiFetch(`${API_URL}/api/teacher/${user.id}/sections`);
      const data = await res.json();
      if (data.success) setSections(data.sections);
    } catch (e) { console.error(e); }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const user = JSON.parse(localStorage.getItem('user'));
      const studentNames = studentsText.split('\n').filter(s => s.trim());
      const res = await apiFetch(`${API_URL}/api/teacher/sections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, gradeLevel, teacherId: user.id, studentsList: studentNames })
      });
      const data = await res.json();
      if (data.success) {
        setName(''); setGradeLevel(''); setStudentsText(''); setShowForm(false);
        fetchSections();
        let msg = data.message || `Created ${data.createdStudents.length} student accounts.`;
        if (data.skippedStudents?.length > 0) msg += `\n\nSkipped (already in section):\n${data.skippedStudents.map(s => `• ${s.name}`).join('\n')}`;
        if (data.linkedStudents?.length > 0) msg += `\n\nLinked existing accounts:\n${data.linkedStudents.map(s => `• ${s.name} (${s.username})`).join('\n')}`;
        alert(msg);
      } else { alert("Error: " + data.error); }
    } catch (error) { alert("Network error."); }
    finally { setIsLoading(false); }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsExtracting(true);
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const res = await apiFetch(`${API_URL}/api/teacher/extract-students`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success && data.names) {
        const newNames = data.names.join('\n');
        setStudentsText(prev => prev ? prev + '\n' + newNames : newNames);
      } else {
        alert("Extraction failed: " + data.error);
      }
    } catch (error) {
      alert("Network error during extraction.");
    } finally {
      setIsExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const toggleSection = (id) => setExpandedId(prev => prev === id ? null : id);

  const handleAddStudents = async (section) => {
    const studentNames = addStudentsText.split('\n').filter(s => s.trim());
    if (studentNames.length === 0) return alert('Please enter at least one student name.');
    setIsAddingStudents(true);
    try {
      const user = JSON.parse(localStorage.getItem('user'));
      const res = await apiFetch(`${API_URL}/api/teacher/sections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: section.name, teacherId: user.id, studentsList: studentNames })
      });
      const data = await res.json();
      if (data.success) {
        setAddStudentsText('');
        setEditingSectionId(null);
        fetchSections();
        let msg = data.message || `Added ${data.createdStudents?.length || 0} student(s).`;
        if (data.skippedStudents?.length > 0) msg += `\n\nSkipped (already in section):\n${data.skippedStudents.map(s => `• ${s.name}`).join('\n')}`;
        if (data.linkedStudents?.length > 0) msg += `\n\nLinked existing accounts:\n${data.linkedStudents.map(s => `• ${s.name} (${s.username})`).join('\n')}`;
        alert(msg);
      } else { alert('Error: ' + data.error); }
    } catch (e) { alert('Network error.'); }
    finally { setIsAddingStudents(false); }
  };

  const handleEditFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsExtractingEdit(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await apiFetch(`${API_URL}/api/teacher/extract-students`, { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success && data.names) {
        const newNames = data.names.join('\n');
        setAddStudentsText(prev => prev ? prev + '\n' + newNames : newNames);
      } else { alert('Extraction failed: ' + data.error); }
    } catch (error) { alert('Network error during extraction.'); }
    finally {
      setIsExtractingEdit(false);
      if (editFileRef.current) editFileRef.current.value = '';
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-brand-slate">Block Sections</h1>
          <p className="text-slate-500 text-sm">Shared school-wide sections and student accounts</p>
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all shadow-sm ${showForm ? 'bg-slate-100 text-slate-600 hover:bg-slate-200' : 'bg-brand-navy text-white hover:bg-blue-900'}`}>
          {showForm ? <><X className="w-4 h-4" /> Close</> : <><Plus className="w-4 h-4" /> Create Section</>}
        </button>
      </div>

      <div className="mb-6 relative">
        <Search className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input 
          type="text" 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search sections by name..." 
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-navy outline-none shadow-sm"
        />
      </div>

      {/* Collapsible Create Form */}
      {showForm && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm mb-8 animate-in slide-in-from-top">
          <h2 className="text-lg font-bold text-brand-slate mb-4 flex items-center">
            <Plus className="w-5 h-5 mr-2 text-brand-navy" /> New Section
          </h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Section Name</label>
                <input type="text" required value={name} onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none"
                  placeholder="e.g. Rizal" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Grade Level *</label>
                <select required value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none">
                  <option value="">-- Select --</option>
                  {GRADE_LEVELS.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            </div>
            <p className="text-xs text-slate-400 -mt-2">
              Sections are shared with everyone at your school and grouped by grade level. If this
              section already exists, students will be added to it.
            </p>
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-sm font-medium text-slate-700">Student Names (One per line)</label>
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isExtracting}
                  className="text-xs font-bold text-brand-navy bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors disabled:opacity-50">
                  {isExtracting ? 'Extracting...' : <><Upload className="w-3.5 h-3.5" /> Auto-fill from Excel/Image</>}
                </button>
                <input type="file" accept=".xlsx,.xls,image/*" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
              </div>
              <textarea required value={studentsText} onChange={(e) => setStudentsText(e.target.value)}
                rows={6} className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none"
                placeholder={"Juan Dela Cruz\nMaria Clara\nJose Rizal"} />
              <p className="text-xs text-slate-500 mt-1">Existing students won't be duplicated. Default password: 'password123'.</p>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setShowForm(false)}
                className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-lg font-medium hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={isLoading}
                className="flex-1 py-2.5 bg-brand-navy text-white rounded-lg font-medium hover:bg-blue-900 transition-colors disabled:opacity-50">
                {isLoading ? 'Creating...' : 'Create Section & Accounts'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Sections List */}
      <div className="space-y-3">
        {(() => {
          const filteredSections = sections.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase()));
          
          if (sections.length === 0) {
            return (
              <div className="text-center p-12 border-2 border-dashed border-slate-200 rounded-2xl text-slate-500">
                <Users className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                <p className="font-medium">No sections yet</p>
                <p className="text-sm mt-1">Click "Create Section" above to get started.</p>
              </div>
            );
          }

          if (filteredSections.length === 0) {
            return (
              <div className="text-center p-12 border border-slate-200 bg-white rounded-2xl text-slate-500">
                <Search className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                <p className="font-medium">No sections found matching "{searchQuery}"</p>
              </div>
            );
          }

          // Segment by grade level, ordered by the canonical grade list so
          // "Grade 10" doesn't sort between "Grade 1" and "Grade 2".
          const byGrade = filteredSections.reduce((acc, s) => {
            const key = s.gradeLevel || 'Unassigned grade level';
            (acc[key] = acc[key] || []).push(s);
            return acc;
          }, {});
          const gradeOrder = [...GRADE_LEVELS, 'Unassigned grade level'];
          const gradeKeys = Object.keys(byGrade).sort((a, b) => gradeOrder.indexOf(a) - gradeOrder.indexOf(b));

          return gradeKeys.map(grade => (
            <div key={grade} className="pt-2">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-brand-navy bg-blue-50 px-2.5 py-1 rounded-full">{grade}</span>
                <span className="text-xs text-slate-400">
                  {byGrade[grade].length} section{byGrade[grade].length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="space-y-3">
          {byGrade[grade].map(section => {
            const isOpen = expandedId === section.id;
            const studentCount = section._count?.students || section.students?.length || 0;
            return (
              <div key={section.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="w-full p-4 flex justify-between items-center hover:bg-slate-50 transition-colors">
                  <button onClick={() => toggleSection(section.id)} className="flex items-center gap-3 flex-1 text-left">
                    <div className="w-10 h-10 rounded-full bg-blue-50 text-brand-navy flex items-center justify-center font-bold text-sm">
                      {studentCount}
                    </div>
                    <div>
                      <h3 className="font-bold text-brand-slate flex items-center gap-2">
                        {section.name}
                        {section.isOwn === false && (
                          <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                            {section.teacher?.name || 'Colleague'}
                          </span>
                        )}
                      </h3>
                      <p className="text-xs text-slate-500">{studentCount} student{studentCount !== 1 ? 's' : ''}</p>
                    </div>
                  </button>
                  <div className="flex items-center gap-2">
                    <button onClick={(e) => { e.stopPropagation(); setEditingSectionId(prev => prev === section.id ? null : section.id); setAddStudentsText(''); if (expandedId !== section.id) setExpandedId(section.id); }}
                      className={`p-2 rounded-lg transition-colors ${editingSectionId === section.id ? 'bg-brand-navy text-white' : 'text-slate-400 hover:text-brand-navy hover:bg-blue-50'}`}
                      title="Add students to this section">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => toggleSection(section.id)}>
                      <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                </div>
                {isOpen && section.students && (
                  <div className="border-t border-slate-100 px-4 pb-4 pt-2">
                    {/* Add Students Form */}
                    {editingSectionId === section.id && (
                      <div className="mb-4 p-4 bg-blue-50/50 border border-blue-200 rounded-xl">
                        <h4 className="text-sm font-bold text-brand-navy mb-3 flex items-center gap-2">
                          <UserPlus className="w-4 h-4" /> Add Students to {section.name}
                        </h4>
                        <div className="space-y-3">
                          <div>
                            <div className="flex justify-between items-center mb-1">
                              <label className="text-xs font-medium text-slate-600">Student Names (One per line)</label>
                              <button type="button" onClick={() => editFileRef.current?.click()} disabled={isExtractingEdit}
                                className="text-xs font-bold text-brand-navy bg-white hover:bg-blue-100 px-2.5 py-1 rounded-lg flex items-center gap-1 transition-colors disabled:opacity-50 border border-blue-200">
                                {isExtractingEdit ? 'Extracting...' : <><Upload className="w-3 h-3" /> Auto-fill</>}
                              </button>
                              <input type="file" accept=".xlsx,.xls,image/*" className="hidden" ref={editFileRef} onChange={handleEditFileUpload} />
                            </div>
                            <textarea value={addStudentsText} onChange={(e) => setAddStudentsText(e.target.value)}
                              rows={4} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none text-sm"
                              placeholder={"Juan Dela Cruz\nMaria Clara"} />
                            <p className="text-[11px] text-slate-400 mt-1">Existing students won't be duplicated. Default password: 'password123'.</p>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => { setEditingSectionId(null); setAddStudentsText(''); }}
                              className="flex-1 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-white">Cancel</button>
                            <button onClick={() => handleAddStudents(section)} disabled={isAddingStudents || !addStudentsText.trim()}
                              className="flex-1 py-2 bg-brand-navy text-white rounded-lg text-sm font-medium hover:bg-blue-900 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                              {isAddingStudents ? <><Loader2 className="w-4 h-4 animate-spin" /> Adding...</> : <><UserPlus className="w-4 h-4" /> Add Students</>}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    {section.students.length === 0 ? (
                      <p className="text-sm text-slate-400 py-2">No students in this section.</p>
                    ) : (
                      <div className="space-y-1.5 max-h-72 overflow-y-auto">
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
          })}
              </div>
            </div>
          ));
        })()}
      </div>
    </div>
  );
}
