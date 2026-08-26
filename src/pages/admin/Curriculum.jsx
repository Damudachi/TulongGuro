import { useState, useEffect, useCallback } from 'react';
import { BookOpen, Plus, Loader2, Trash2, UploadCloud, FileText, X, ChevronDown, ClipboardList, PenLine } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { GRADE_LEVELS, SUBJECTS } from '../../constants/school';
import { ACTIVITY_TYPES } from '../../constants/activityTypes';
import { useRubricDrafts } from '../../utils/useRubricDrafts';
import { RubricDraftCard, RubricDraftButtons } from '../../components/RubricDrafts';
import CurriculumEditor from '../../components/CurriculumEditor';
import { lessonDisplayName } from '../../utils/topics';

import { showAlert, showConfirm } from '../../utils/dialog';
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
  // ── The school's own rubrics, optional, attached while the curriculum is set up ──
  //
  // A list, not one: a subject is rarely marked by a single rubric. A Grade 6
  // English curriculum realistically ships one for written output, one for
  // speaking and one for a performance task, and the form used to take exactly
  // one — so the other two had to be retyped afterwards on the School Rubrics
  // page, away from the curriculum they belong to. Each card is independent:
  // one that fails to save says so on its own without touching the others.
  //
  // The cards and their rules live in useRubricDrafts, because the editor for
  // an already-published curriculum takes rubrics exactly the same way.
  const drafts = useRubricDrafts(admin.id);
  const [expandedId, setExpandedId] = useState(null);
  // Which curriculum the editor is open on. An id rather than the row itself,
  // so that a reload after each save re-renders the editor from the fresh list
  // instead of a snapshot taken when it opened.
  const [editingId, setEditingId] = useState(null);
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

  const handleCreate = async (e) => {
    e.preventDefault();
    if (isSaving) return;
    // The guide is what a curriculum IS. Without it the record is an empty
    // shell — no lessons, so no competencies, so every activity tagged to it
    // reaches the AI checker with nothing to mark against but the rubric. The
    // server refuses this too; this is what says so before the round trip.
    if (!file) {
      setError('Upload the curriculum guide (PDF or DOCX). Its lessons are read out of the document — without it this curriculum would be published empty.');
      return;
    }
    const blocked = drafts.blockingMessage();
    if (blocked) {
      setError(blocked);
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

      // Saved after the curriculum, one request each, and separately from it: a
      // rubric that fails to save must not take a published curriculum down
      // with it, and the admin needs to be told exactly which of them happened.
      // Sequential rather than Promise.all so that a failure is attributable to
      // a named rubric and the rest still go.
      //
      // Posted against the curriculum rather than to the school-wide rubric
      // route, so each one is linked to the curriculum it was written for and
      // is listed under it afterwards — the link the editor needs in order to
      // show them at all.
      const saved = [];
      const failed = [];
      for (const draft of drafts.ready) {
        const name = draft.name.trim();
        try {
          const rubricRes = await apiFetch(`${API_URL}/api/admin/${admin.id}/curriculums/${d.curriculum.id}/rubrics`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name,
              criteria: draft.criteria.filter(c => c.name.trim())
            })
          });
          const rd = await rubricRes.json();
          if (rd.success) saved.push(name);
          else failed.push(`"${name}" (${rd.error})`);
        } catch {
          failed.push(`"${name}" (could not reach the server)`);
        }
      }

      let rubricNotice = '';
      if (saved.length) {
        rubricNotice += ` Saved ${saved.length} rubric${saved.length === 1 ? '' : 's'} to your School Rubrics for ${form.gradeLevel} · ${form.subject}: ${saved.map(n => `"${n}"`).join(', ')}.`;
      }
      if (failed.length) {
        // Named, with the reason, and pointed somewhere — the form closes with
        // the curriculum published, so re-submitting it is not the way back and
        // the typed criteria are gone. The commonest reason is a name the
        // school already uses, where the rubric itself already exists.
        rubricNotice += ` The curriculum was published, but ${failed.length} rubric${failed.length === 1 ? ' was' : 's were'} not saved: ${failed.join('; ')}. Add ${failed.length === 1 ? 'it' : 'them'} from Edit on this curriculum.`;
      }

      setShowForm(false);
      setForm({ gradeLevel: '', subject: '', title: '', description: '' });
      setFile(null);
      drafts.reset();
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
    if (!(await showConfirm(`Delete the ${curriculum.subject} curriculum for ${curriculum.gradeLevel}? Classes already created keep their copied lessons, and its rubrics stay in your School Rubrics.`,
      { confirmLabel: 'Delete curriculum', danger: true }))) return;
    setBusy(true);
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${admin.id}/curriculums/${curriculum.id}`, { method: 'DELETE' });
      const d = await res.json();
      if (d.success) load(); else showAlert(d.error);
    } catch {
      // finally alone cleared the busy flag and said nothing, so a dropped
      // connection looked identical to a completed delete.
      showAlert('Could not reach the server. This curriculum has not been deleted.');
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
      } else showAlert(d.error);
    } catch {
      showAlert('Could not reach the server. The lesson has not been added.');
    } finally { setBusy(false); }
  };

  const handleDeleteLesson = async (curriculumId, lessonId, lessonTitle) => {
    // Confirmed, like every other delete on this page. This one alone removed a
    // lesson on a single click — and a curriculum lesson carries the rubric
    // that new classes are built from.
    if (!(await showConfirm(`Delete the lesson "${lessonTitle || 'this lesson'}"? Classes already created from it keep their own copy.`,
      { confirmLabel: 'Delete lesson', danger: true }))) return;
    setBusy(true);
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${admin.id}/curriculums/${curriculumId}/lessons/${lessonId}`, { method: 'DELETE' });
      const d = await res.json();
      if (d.success) load(); else showAlert(d.error);
    } catch {
      showAlert('Could not reach the server. The lesson has not been deleted.');
    } finally { setBusy(false); }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2" />Loading curriculum...</div>;
  }

  const editing = curriculums.find(c => c.id === editingId) || null;

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
            const rubrics = c.rubrics || [];
            return (
              <div key={c.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="flex items-center gap-3 p-4">
                  <button onClick={() => setExpandedId(isOpen ? null : c.id)} className="flex-1 flex items-center gap-3 text-left min-w-0">
                    <div className="bg-blue-50 p-2 rounded-lg text-brand-navy shrink-0"><BookOpen className="w-5 h-5" /></div>
                    <div className="min-w-0">
                      <p className="font-bold text-brand-slate truncate">{c.title}</p>
                      <p className="text-xs text-slate-500">
                        {c.gradeLevel} · {c.subject} · {c.lessons.length} lesson{c.lessons.length === 1 ? '' : 's'}
                        {rubrics.length > 0 && ` · ${rubrics.length} rubric${rubrics.length === 1 ? '' : 's'}`}
                      </p>
                    </div>
                    <ChevronDown className={cn('w-4 h-4 text-slate-400 ml-auto shrink-0 transition-transform', isOpen && 'rotate-180')} />
                  </button>
                  {/* A curriculum is revised, not republished — see
                      CurriculumEditor. Before this, changing one word of the
                      title meant deleting the whole thing. */}
                  <button onClick={() => setEditingId(c.id)} disabled={busy} title="Edit curriculum"
                    className="p-2 rounded-lg bg-slate-100 text-slate-500 hover:bg-blue-100 hover:text-brand-navy shrink-0 disabled:opacity-40">
                    <PenLine className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleDelete(c)} disabled={busy} title="Delete curriculum"
                    className="p-2 rounded-lg bg-slate-100 text-slate-500 hover:bg-red-100 hover:text-red-600 shrink-0 disabled:opacity-40">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {isOpen && (
                  <div className="border-t border-slate-100 p-4 space-y-3">
                    {c.description && <p className="text-sm text-slate-600">{c.description}</p>}

                    {rubrics.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {rubrics.map(r => (
                          <span key={r.id} className="text-[11px] font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <ClipboardList className="w-3 h-3" /> {r.name}
                          </span>
                        ))}
                      </div>
                    )}

                    {c.lessons.length === 0 ? (
                      <p className="text-sm text-slate-400 italic">No lessons yet — add them below.</p>
                    ) : (
                      <div className="space-y-2">
                        {c.lessons.map(l => (
                          <div key={l.id} className="flex items-start gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-brand-slate">
                                {lessonDisplayName(l)}
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

      {editing && (
        <CurriculumEditor adminId={admin.id} curriculum={editing}
          onClose={() => setEditingId(null)} onSaved={load} />
      )}

      {/* Add curriculum modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
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
                <label className="block text-sm font-medium text-slate-700 mb-1">Curriculum file *</label>
                <p className="text-xs text-slate-500 mb-1.5">
                  The lessons and learning competencies are read out of this document — they are what activities are tagged to, and what the AI checker marks against.
                </p>
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
                <p className="text-xs text-slate-400 mt-1.5">
                  A revised guide can be uploaded later from Edit — the lessons are read out again and you
                  choose what happens to the ones already here.
                </p>
              </div>
              {/* ── The school's rubrics for this subject ──
                  Optional and deliberately separate from the lesson upload: a
                  curriculum document says what is taught, and the rubrics say
                  how the school marks it. Teachers pick these up as templates;
                  nothing is applied to their activities on their behalf.

                  As many as the subject needs. One rubric per subject was never
                  how a school actually works — written output, speaking and a
                  performance task are marked against different things — and the
                  extras had to be retyped later on the School Rubrics page. */}
              <div className="border-t border-slate-100 pt-4">
                <div className="flex items-start justify-between gap-3 mb-1">
                  <label className="block text-sm font-medium text-slate-700">
                    School rubrics for this subject <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  {drafts.drafts.length > 0 && (
                    <button type="button" onClick={drafts.reset}
                      className="text-xs font-medium text-slate-500 hover:text-slate-700 shrink-0">Clear all</button>
                  )}
                </div>
                <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                  Add as many as this subject is marked with — your teachers choose from them when
                  building an activity. Skip this and they will pick or write their own.
                </p>

                <div className="space-y-3">
                  {drafts.drafts.map((draft, index) => (
                    <RubricDraftCard key={draft.id} draft={draft} index={index}
                      onChange={patch => drafts.update(draft.id, patch)}
                      onRemove={() => drafts.remove(draft.id)} />
                  ))}
                </div>

                <RubricDraftButtons count={drafts.drafts.length}
                  className={drafts.drafts.length > 0 ? 'mt-3' : ''}
                  onUpload={picked => drafts.readFile(drafts.add('upload'), picked)}
                  onManual={() => drafts.add('manual')} />
              </div>

              {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => { setShowForm(false); drafts.reset(); }}
                  className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50">Cancel</button>
                {/* Held until the guide is attached, while a rubric is being
                    read, and while saving — the guards in handleCreate say why.
                    Greyed rather than hidden, so the reason is on screen next to
                    the field or the spinner that is holding it up. */}
                <button type="submit" disabled={isSaving || drafts.reading.length > 0 || !file}
                  className={cn('flex-1 py-2.5 rounded-lg text-white font-bold flex items-center justify-center gap-2',
                    isSaving || drafts.reading.length > 0 || !file ? 'bg-slate-300 cursor-not-allowed' : 'bg-brand-navy hover:bg-blue-900')}
                  title={!file ? 'Attach the curriculum guide first' : undefined}>
                  {isSaving
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Parsing...</>
                    : drafts.reading.length > 0
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Reading rubric...</>
                      : 'Publish'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
