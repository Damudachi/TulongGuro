import { useState, useEffect, useCallback } from 'react';
import { BookOpen, Plus, Loader2, Trash2, UploadCloud, FileText, X, ChevronDown, ClipboardList, PenLine } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { GRADE_LEVELS, SUBJECTS } from '../../constants/school';
import { ACTIVITY_TYPES } from '../../constants/activityTypes';
import RubricEditor from '../../components/RubricEditor';
import { BLANK_CRITERION, totalWeight } from '../../utils/rubric';

function cn(...cls) { return cls.filter(Boolean).join(' '); }


/**
 * School curriculum library. One curriculum per grade level + subject; teachers
 * get it suggested automatically when they create a matching course shell.
 */
export default function AdminCurriculum() {
  const admin = JSON.parse(localStorage.getItem('user') || '{}');
  const [curriculums, setCurriculums] = useState([]);
  // No admin id means there is nothing to fetch, so this must not open on a
  // spinner that only the first commit would take away again (see load below).
  const [isLoading, setIsLoading] = useState(() => !!admin.id);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ gradeLevel: '', subject: '', title: '', description: '' });
  const [file, setFile] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // ── The school's own rubric, optional, attached while the curriculum is set up ──
  // 'none' until the admin chooses how to supply it. Nothing is saved unless
  // they fill the criteria in and the weights total 100.
  const [rubricMode, setRubricMode] = useState('none');   // 'none' | 'upload' | 'manual'
  const [rubricName, setRubricName] = useState('');
  const [rubricCriteria, setRubricCriteria] = useState([{ ...BLANK_CRITERION }]);
  const [rubricFile, setRubricFile] = useState(null);
  const [isReadingRubric, setIsReadingRubric] = useState(false);
  const [rubricError, setRubricError] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [lessonDraft, setLessonDraft] = useState({ title: '', outputType: 'Essay', weekNumber: '', description: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!admin.id) return;
    apiFetch(`${API_URL}/api/admin/${admin.id}/curriculums`)
      .then(r => r.json())
      .then(d => { if (d.success) setCurriculums(d.curriculums || []); })
      .catch(() => {}) /* a failed read leaves the empty state, which is what renders */
      .finally(() => setIsLoading(false));
  }, [admin.id]);

  useEffect(() => { load(); }, [load]);

  /** Transcribe an uploaded rubric into the editor for the admin to check. */
  const readRubricFile = async (picked) => {
    setRubricFile(picked);
    setRubricError('');
    setIsReadingRubric(true);
    try {
      const fd = new FormData();
      fd.append('rubricFile', picked);
      const res = await apiFetch(`${API_URL}/api/admin/${admin.id}/rubrics/extract`, { method: 'POST', body: fd });
      const d = await res.json();
      if (d.success && d.criteria?.length) {
        setRubricCriteria(d.criteria.map(c => ({
          name: c.name || '',
          points: c.points || 0,
          description: c.description || ''
        })));
        if (!rubricName.trim()) setRubricName(picked.name.replace(/\.[^.]+$/, ''));
      } else {
        setRubricError(d.error || 'Nothing could be read from that file. You can type the criteria in below.');
      }
    } catch {
      setRubricError('Could not reach the server. You can type the criteria in below.');
    } finally {
      setIsReadingRubric(false);
    }
  };

  const resetRubricDraft = () => {
    setRubricMode('none');
    setRubricName('');
    setRubricCriteria([{ ...BLANK_CRITERION }]);
    setRubricFile(null);
    setRubricError('');
  };

  /**
   * Whether the rubric half of the form is filled in enough to save.
   *
   * Deliberately all-or-nothing: an admin who opened the section and typed
   * nothing gets a curriculum with no rubric, which is a supported outcome, not
   * an error. A half-filled one is refused rather than saved incomplete.
   */
  const rubricDraftReady =
    rubricMode !== 'none' &&
    rubricName.trim() &&
    rubricCriteria.some(c => c.name.trim()) &&
    totalWeight(rubricCriteria) === 100;

  const rubricDraftStarted =
    rubricMode !== 'none' && (rubricName.trim() || rubricCriteria.some(c => c.name.trim()));

  const handleCreate = async (e) => {
    e.preventDefault();
    if (isSaving) return;
    if (rubricDraftStarted && !rubricDraftReady) {
      setError('The school rubric needs a name and criteria weights totalling 100%. Clear it if you would rather add it later.');
      return;
    }
    setIsSaving(true);
    setError('');
    setNotice('');
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (file) fd.append('curriculumFile', file);
      const res = await apiFetch(`${API_URL}/api/admin/${admin.id}/curriculums`, { method: 'POST', body: fd });
      const d = await res.json();
      if (!d.success) {
        setError(d.error || 'Could not publish this curriculum.');
        return;
      }

      // Saved after the curriculum, and separately: a rubric that fails to save
      // must not take a published curriculum down with it, and the admin needs
      // to be told which of the two happened.
      let rubricNotice = '';
      if (rubricDraftReady) {
        const rubricRes = await apiFetch(`${API_URL}/api/admin/${admin.id}/rubrics`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: rubricName.trim(),
            criteria: rubricCriteria.filter(c => c.name.trim()),
            gradeLevel: form.gradeLevel,
            subject: form.subject
          })
        });
        const rd = await rubricRes.json();
        rubricNotice = rd.success
          ? ` Saved "${rubricName.trim()}" to your School Rubrics for ${form.gradeLevel} · ${form.subject}.`
          : ` The curriculum was published, but the rubric was not saved: ${rd.error}`;
      }

      setShowForm(false);
      setForm({ gradeLevel: '', subject: '', title: '', description: '' });
      setFile(null);
      resetRubricDraft();
      const lessons = d.curriculum.lessons?.length || 0;
      setNotice(
        (d.warning || `Published "${d.curriculum.title}" with ${lessons} lesson(s).`) + rubricNotice
      );
      load();
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
      const res = await apiFetch(`${API_URL}/api/admin/${admin.id}/curriculums/${curriculum.id}`, { method: 'DELETE' });
      const d = await res.json();
      if (d.success) load(); else alert(d.error);
    } catch {
      // finally alone cleared the busy flag and said nothing, so a dropped
      // connection looked identical to a completed delete.
      alert('Could not reach the server. This curriculum has not been deleted.');
    } finally { setBusy(false); }
  };

  const handleAddLesson = async (curriculumId) => {
    if (!lessonDraft.title.trim()) return;
    setBusy(true);
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${admin.id}/curriculums/${curriculumId}/lessons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lessonDraft)
      });
      const d = await res.json();
      if (d.success) {
        setLessonDraft({ title: '', outputType: 'Essay', weekNumber: '', description: '' });
        load();
      } else alert(d.error);
    } catch {
      alert('Could not reach the server. The lesson has not been added.');
    } finally { setBusy(false); }
  };

  const handleDeleteLesson = async (curriculumId, lessonId, lessonTitle) => {
    // Confirmed, like every other delete on this page. This one alone removed a
    // lesson on a single click — and a curriculum lesson carries the rubric
    // that new classes are built from.
    if (!confirm(`Delete the lesson "${lessonTitle || 'this lesson'}"? Classes already created from it keep their own copy.`)) return;
    setBusy(true);
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${admin.id}/curriculums/${curriculumId}/lessons/${lessonId}`, { method: 'DELETE' });
      const d = await res.json();
      if (d.success) load(); else alert(d.error);
    } catch {
      alert('Could not reach the server. The lesson has not been deleted.');
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
          <p className="text-sm mt-1">Upload a curriculum guide and its lessons are read out for you.</p>
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
                                {/* Only lessons imported before rubric generation
                                    was removed still carry one. */}
                                {l.defaultRubric && (
                                  <span className="text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                                    <ClipboardList className="w-3 h-3" /> Rubric attached
                                  </span>
                                )}
                              </div>
                            </div>
                            <button onClick={() => handleDeleteLesson(c.id, l.id, l.title)} disabled={busy}
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
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl my-8">
            <h2 className="text-xl font-bold text-brand-slate mb-1">Add curriculum</h2>
            <p className="text-slate-500 text-sm mb-5">Upload a guide and its lessons are read out for you.</p>
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
              {/* ── The school's rubric for this subject ──
                  Optional and deliberately separate from the lesson upload: a
                  curriculum document says what is taught, and the rubric says
                  how the school marks it. Teachers pick this up as a template;
                  nothing is applied to their activities on their behalf. */}
              <div className="border-t border-slate-100 pt-4">
                <div className="flex items-start justify-between gap-3 mb-1">
                  <label className="block text-sm font-medium text-slate-700">
                    School rubric for this subject <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  {rubricMode !== 'none' && (
                    <button type="button" onClick={resetRubricDraft}
                      className="text-xs font-medium text-slate-500 hover:text-slate-700 shrink-0">Clear</button>
                  )}
                </div>
                <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                  Your teachers can then apply it to their activities. Skip this and they will
                  choose or write their own.
                </p>

                {rubricMode === 'none' ? (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="border-2 border-dashed border-slate-200 rounded-lg p-3 text-center cursor-pointer hover:border-brand-navy hover:bg-blue-50 transition-colors">
                      <UploadCloud className="w-5 h-5 mx-auto mb-1 text-slate-400" />
                      <span className="block text-xs font-medium text-slate-600">Upload our rubric</span>
                      <span className="block text-[11px] text-slate-400 mt-0.5">Read out for you to check</span>
                      <input type="file" accept=".pdf,.docx,image/*" className="hidden"
                        onChange={e => {
                          const picked = e.target.files?.[0];
                          if (!picked) return;
                          setRubricMode('upload');
                          readRubricFile(picked);
                        }} />
                    </label>
                    <button type="button" onClick={() => setRubricMode('manual')}
                      className="border-2 border-dashed border-slate-200 rounded-lg p-3 text-center hover:border-brand-navy hover:bg-blue-50 transition-colors">
                      <PenLine className="w-5 h-5 mx-auto mb-1 text-slate-400" />
                      <span className="block text-xs font-medium text-slate-600">Type it in</span>
                      <span className="block text-[11px] text-slate-400 mt-0.5">Name and criteria</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {rubricFile && (
                      <div className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-lg">
                        <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                        <span className="text-xs font-medium text-slate-600 truncate flex-1">{rubricFile.name}</span>
                        {isReadingRubric && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
                      </div>
                    )}
                    {isReadingRubric ? (
                      <p className="text-xs text-slate-500">Reading the rubric…</p>
                    ) : (
                      <>
                        {rubricMode === 'upload' && !rubricError && (
                          <p className="text-xs text-slate-500 bg-blue-50 border border-blue-100 rounded-lg p-2.5 leading-relaxed">
                            Check these against your document before publishing — correct anything
                            that came out wrong.
                          </p>
                        )}
                        {rubricError && (
                          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">{rubricError}</p>
                        )}
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">Rubric name</label>
                          <input type="text" value={rubricName} onChange={e => setRubricName(e.target.value)}
                            placeholder="e.g. Grade 6 English — Written Output"
                            className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm" />
                        </div>
                        <RubricEditor criteria={rubricCriteria} onChange={setRubricCriteria} />
                      </>
                    )}
                  </div>
                )}
              </div>

              {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => { setShowForm(false); resetRubricDraft(); }}
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
