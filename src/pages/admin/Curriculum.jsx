import { useState, useEffect, useCallback } from 'react';
import { BookOpen, Plus, Loader2, Trash2, UploadCloud, FileText, X, ChevronDown, Sparkles } from 'lucide-react';
import { API_URL } from '../../config';
import { GRADE_LEVELS, SUBJECTS } from '../../constants/school';
import { ACTIVITY_TYPES } from '../../constants/activityTypes';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

/**
 * School curriculum library. One curriculum per grade level + subject; teachers
 * get it suggested automatically when they create a matching course shell.
 */
export default function AdminCurriculum() {
  const admin = JSON.parse(localStorage.getItem('user') || '{}');
  const [curriculums, setCurriculums] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ gradeLevel: '', subject: '', title: '', description: '' });
  const [file, setFile] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [lessonDraft, setLessonDraft] = useState({ title: '', outputType: 'Essay', weekNumber: '', description: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!admin.id) return setIsLoading(false);
    fetch(`${API_URL}/api/admin/${admin.id}/curriculums`)
      .then(r => r.json())
      .then(d => { if (d.success) setCurriculums(d.curriculums || []); })
      .finally(() => setIsLoading(false));
  }, [admin.id]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    setError('');
    setNotice('');
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (file) fd.append('curriculumFile', file);
      const res = await fetch(`${API_URL}/api/admin/${admin.id}/curriculums`, { method: 'POST', body: fd });
      const d = await res.json();
      if (d.success) {
        setShowForm(false);
        setForm({ gradeLevel: '', subject: '', title: '', description: '' });
        setFile(null);
        setNotice(d.warning || `Published "${d.curriculum.title}" with ${d.curriculum.lessons?.length || 0} lesson(s).`);
        load();
      } else {
        setError(d.error || 'Could not publish this curriculum.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (curriculum) => {
    if (!confirm(`Delete the ${curriculum.subject} curriculum for ${curriculum.gradeLevel}? Classes already created keep their copied lessons.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/${admin.id}/curriculums/${curriculum.id}`, { method: 'DELETE' });
      const d = await res.json();
      if (d.success) load(); else alert(d.error);
    } finally { setBusy(false); }
  };

  const handleAddLesson = async (curriculumId) => {
    if (!lessonDraft.title.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/${admin.id}/curriculums/${curriculumId}/lessons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lessonDraft)
      });
      const d = await res.json();
      if (d.success) {
        setLessonDraft({ title: '', outputType: 'Essay', weekNumber: '', description: '' });
        load();
      } else alert(d.error);
    } finally { setBusy(false); }
  };

  const handleDeleteLesson = async (curriculumId, lessonId) => {
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/${admin.id}/curriculums/${curriculumId}/lessons/${lessonId}`, { method: 'DELETE' });
      const d = await res.json();
      if (d.success) load(); else alert(d.error);
    } finally { setBusy(false); }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2" />Loading curriculum...</div>;
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto pb-24">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-brand-slate">Curriculum</h1>
          <p className="text-slate-500 text-sm">
            One curriculum per grade level and subject. Teachers get it suggested when they create a matching class.
          </p>
        </div>
        <button onClick={() => { setShowForm(true); setError(''); }}
          className="bg-brand-navy text-white px-4 py-2.5 rounded-lg text-sm font-bold hover:bg-blue-900 shadow-md flex items-center gap-2 shrink-0">
          <Plus className="w-4 h-4" /> Add Curriculum
        </button>
      </div>

      {notice && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-6 text-sm text-blue-800 flex items-start justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="text-blue-400 hover:text-blue-600 shrink-0"><X className="w-4 h-4" /></button>
        </div>
      )}

      {curriculums.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
          <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No curriculum published yet</p>
          <p className="text-sm mt-1">Upload a curriculum guide and the AI will extract its lessons and rubrics.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {curriculums.map(c => {
            const isOpen = expandedId === c.id;
            return (
              <div key={c.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="flex items-center gap-3 p-4">
                  <button onClick={() => setExpandedId(isOpen ? null : c.id)} className="flex-1 flex items-center gap-3 text-left min-w-0">
                    <div className="bg-blue-50 p-2 rounded-lg text-brand-navy shrink-0"><BookOpen className="w-5 h-5" /></div>
                    <div className="min-w-0">
                      <p className="font-bold text-brand-slate truncate">{c.title}</p>
                      <p className="text-xs text-slate-500">
                        {c.gradeLevel} · {c.subject} · {c.lessons.length} lesson{c.lessons.length === 1 ? '' : 's'}
                      </p>
                    </div>
                    <ChevronDown className={cn('w-4 h-4 text-slate-400 ml-auto shrink-0 transition-transform', isOpen && 'rotate-180')} />
                  </button>
                  <button onClick={() => handleDelete(c)} disabled={busy} title="Delete curriculum"
                    className="p-2 rounded-lg bg-slate-100 text-slate-500 hover:bg-red-100 hover:text-red-600 shrink-0 disabled:opacity-40">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {isOpen && (
                  <div className="border-t border-slate-100 p-4 space-y-3">
                    {c.description && <p className="text-sm text-slate-600">{c.description}</p>}

                    {c.lessons.length === 0 ? (
                      <p className="text-sm text-slate-400 italic">No lessons yet — add them below.</p>
                    ) : (
                      <div className="space-y-2">
                        {c.lessons.map(l => (
                          <div key={l.id} className="flex items-start gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-brand-slate">
                                {l.weekNumber ? `Week ${l.weekNumber}: ` : ''}{l.title}
                              </p>
                              {l.description && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{l.description}</p>}
                              <div className="flex items-center gap-2 mt-1.5">
                                <span className="text-[11px] font-bold bg-blue-50 text-brand-navy px-2 py-0.5 rounded-full">{l.outputType}</span>
                                {l.defaultRubric && (
                                  <span className="text-[11px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                                    <Sparkles className="w-3 h-3" /> Rubric included
                                  </span>
                                )}
                              </div>
                            </div>
                            <button onClick={() => handleDeleteLesson(c.id, l.id)} disabled={busy}
                              className="p-1.5 rounded-md text-slate-300 hover:text-red-500 hover:bg-red-50 shrink-0 disabled:opacity-40">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add a lesson by hand */}
                    <div className="border-t border-slate-100 pt-3">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Add a lesson</p>
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                        <input type="text" value={lessonDraft.title} placeholder="Lesson title"
                          onChange={e => setLessonDraft({ ...lessonDraft, title: e.target.value })}
                          className="sm:col-span-2 border border-slate-200 p-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-navy" />
                        <select value={lessonDraft.outputType}
                          onChange={e => setLessonDraft({ ...lessonDraft, outputType: e.target.value })}
                          className="border border-slate-200 p-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-navy">
                          {ACTIVITY_TYPES.map(t => <option key={t}>{t}</option>)}
                        </select>
                        <input type="number" min={1} value={lessonDraft.weekNumber} placeholder="Week"
                          onChange={e => setLessonDraft({ ...lessonDraft, weekNumber: e.target.value })}
                          className="border border-slate-200 p-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-navy" />
                      </div>
                      <button onClick={() => handleAddLesson(c.id)} disabled={busy || !lessonDraft.title.trim()}
                        className="mt-2 text-xs font-bold text-white bg-brand-navy px-3 py-2 rounded-lg hover:bg-blue-900 disabled:opacity-40 flex items-center gap-1.5">
                        <Plus className="w-3.5 h-3.5" /> Add Lesson
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add curriculum modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl my-8">
            <h2 className="text-xl font-bold text-brand-slate mb-1">Add curriculum</h2>
            <p className="text-slate-500 text-sm mb-5">Upload a guide and the AI extracts lessons and default rubrics.</p>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Grade Level *</label>
                  <select required value={form.gradeLevel} onChange={e => setForm({ ...form, gradeLevel: e.target.value })}
                    className="w-full border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm">
                    <option value="">-- Select --</option>
                    {GRADE_LEVELS.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Subject *</label>
                  <select required value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })}
                    className="w-full border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm">
                    <option value="">-- Select --</option>
                    {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Title *</label>
                <input required type="text" value={form.title}
                  onChange={e => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. MATATAG English 6 — SY 2026-2027"
                  className="w-full border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <textarea rows={2} value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  className="w-full border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Curriculum file (optional)</label>
                {!file ? (
                  <label className="block border-2 border-dashed border-slate-200 rounded-lg p-4 text-center cursor-pointer hover:border-brand-navy hover:bg-blue-50 transition-colors">
                    <UploadCloud className="w-6 h-6 mx-auto mb-1 text-slate-400" />
                    <p className="text-xs text-slate-500">Upload PDF or DOCX</p>
                    <input type="file" accept=".pdf,.docx" className="hidden"
                      onChange={e => { if (e.target.files?.[0]) setFile(e.target.files[0]); }} />
                  </label>
                ) : (
                  <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded-lg">
                    <FileText className="w-4 h-4 text-green-600 shrink-0" />
                    <span className="text-xs font-medium text-green-800 truncate flex-1">{file.name}</span>
                    <button type="button" onClick={() => setFile(null)} className="text-red-400 hover:text-red-600">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
              {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setShowForm(false)}
                  className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={isSaving}
                  className={cn('flex-1 py-2.5 rounded-lg text-white font-bold flex items-center justify-center gap-2',
                    isSaving ? 'bg-slate-300 cursor-not-allowed' : 'bg-brand-navy hover:bg-blue-900')}>
                  {isSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> {file ? 'Parsing...' : 'Saving...'}</> : 'Publish'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
