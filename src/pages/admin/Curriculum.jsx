import { useState, useEffect, useCallback, useRef } from 'react';
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
  // ── The school's own rubrics, optional, attached while the curriculum is set up ──
  //
  // A list, not one: a subject is rarely marked by a single rubric. A Grade 6
  // English curriculum realistically ships one for written output, one for
  // speaking and one for a performance task, and the form used to take exactly
  // one — so the other two had to be retyped afterwards on the School Rubrics
  // page, away from the curriculum they belong to. Each card is independent:
  // one that fails to save says so on its own without touching the others.
  //
  // Empty until the admin adds a card. Nothing is saved from a card unless it
  // has a name, criteria, and weights totalling 100.
  const [rubricDrafts, setRubricDrafts] = useState([]);
  // Card identity has to survive reordering and removal — an array index would
  // hand a half-read upload's result to whichever card slid into its place.
  const draftSeq = useRef(0);
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

  /** Add an empty rubric card and hand back its id. */
  const addRubricDraft = (mode) => {
    const id = ++draftSeq.current;
    setRubricDrafts(prev => [...prev, {
      id, mode, name: '', criteria: [{ ...BLANK_CRITERION }],
      // scaledFrom: the document's own total, when the weights had to be
      // rebased off it to reach 100. null when they already totalled 100.
      fileName: '', isReading: false, error: '', scaledFrom: null
    }]);
    return id;
  };

  /** Change one card, addressed by id — see the note on draftSeq. */
  const updateRubricDraft = (id, patch) =>
    setRubricDrafts(prev => prev.map(d => (d.id === id ? { ...d, ...patch } : d)));

  const removeRubricDraft = (id) =>
    setRubricDrafts(prev => prev.filter(d => d.id !== id));

  /** Transcribe an uploaded rubric into one card for the admin to check. */
  const readRubricFile = async (id, picked) => {
    updateRubricDraft(id, { fileName: picked.name, isReading: true, error: '' });
    try {
      const fd = new FormData();
      fd.append('rubricFile', picked);
      const res = await apiFetch(`${API_URL}/api/admin/${admin.id}/rubrics/extract`, { method: 'POST', body: fd });
      const d = await res.json();
      if (d.success && d.criteria?.length) {
        // The name is only filled in if the admin hasn't typed one — read from
        // the live card rather than a captured copy, because the upload takes
        // seconds and they may well have typed a name while it ran.
        setRubricDrafts(prev => prev.map(draft => draft.id === id ? {
          ...draft,
          isReading: false,
          error: '',
          criteria: d.criteria.map(c => ({
            name: c.name || '',
            points: c.points || 0,
            description: c.description || ''
          })),
          // Already rebased to total 100 by the server (scaleCriteriaTo100), so
          // a rubric written out of 16 or 40 points arrives publishable instead
          // of as a card the 100% rule would refuse until it was retyped by
          // hand. Recorded so the card can say the numbers were converted.
          scaledFrom: d.weightsScaled ? d.totalPoints : null,
          name: draft.name.trim() ? draft.name : picked.name.replace(/\.[^.]+$/, '')
        } : draft));
      } else {
        updateRubricDraft(id, {
          isReading: false,
          error: d.error || 'Nothing could be read from that file. You can type the criteria in below.'
        });
      }
    } catch {
      updateRubricDraft(id, {
        isReading: false,
        error: 'Could not reach the server. You can type the criteria in below.'
      });
    }
  };

  const resetRubricDrafts = () => setRubricDrafts([]);

  /**
   * Whether one card is filled in enough to save.
   *
   * Deliberately all-or-nothing per card: an admin who added a card and typed
   * nothing gets a curriculum without that rubric, which is a supported
   * outcome, not an error. A half-filled one is refused rather than saved
   * incomplete — and refused on its own, without blocking the cards beside it.
   */
  const draftReady = (d) =>
    !!d.name.trim() && d.criteria.some(c => c.name.trim()) && totalWeight(d.criteria) === 100;

  const draftStarted = (d) => !!d.name.trim() || d.criteria.some(c => c.name.trim());

  const readyDrafts = rubricDrafts.filter(draftReady);
  /**
   * Cards still having their uploaded file read.
   *
   * They have to be counted separately, because for the few seconds an
   * extraction takes a card looks exactly like one nobody typed in: no name, no
   * criteria. That made it neither ready (so never sent) nor started (so never
   * objected to), and publishing in that window dropped the rubric with the
   * success notice saying nothing about it — the admin had picked a file and
   * watched it disappear. Publishing waits for the read instead.
   */
  const readingDrafts = rubricDrafts.filter(d => d.isReading);
  const unfinishedDrafts = rubricDrafts.filter(d => !d.isReading && draftStarted(d) && !draftReady(d));

  /**
   * Two cards with the same name, caught here rather than at the server.
   *
   * Rubric names are unique within a school, so the second POST would come back
   * 409 with the curriculum already published — a confusing half-success for
   * something visible on screen before anything is sent.
   */
  const duplicateDraftName = (() => {
    const seen = new Set();
    for (const d of readyDrafts) {
      const key = d.name.trim().toLowerCase();
      if (seen.has(key)) return d.name.trim();
      seen.add(key);
    }
    return '';
  })();

  const handleCreate = async (e) => {
    e.preventDefault();
    if (isSaving) return;
    if (readingDrafts.length) {
      setError(readingDrafts.length === 1
        ? 'One rubric is still being read from the file you uploaded. Give it a moment — publishing now would leave it behind.'
        : `${readingDrafts.length} rubrics are still being read from the files you uploaded. Give them a moment — publishing now would leave them behind.`);
      return;
    }
    if (unfinishedDrafts.length) {
      setError(unfinishedDrafts.length === 1
        ? 'One rubric still needs a name and criteria weights totalling 100%. Finish it, or remove it and add it later.'
        : `${unfinishedDrafts.length} rubrics still need a name and criteria weights totalling 100%. Finish them, or remove them and add them later.`);
      return;
    }
    if (duplicateDraftName) {
      setError(`Two rubrics here are both called "${duplicateDraftName}". Rubric names have to be different — it is how your teachers tell them apart when picking one.`);
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
      const saved = [];
      const failed = [];
      for (const draft of readyDrafts) {
        const name = draft.name.trim();
        try {
          const rubricRes = await apiFetch(`${API_URL}/api/admin/${admin.id}/rubrics`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name,
              criteria: draft.criteria.filter(c => c.name.trim()),
              gradeLevel: form.gradeLevel,
              subject: form.subject
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
        rubricNotice += ` The curriculum was published, but ${failed.length} rubric${failed.length === 1 ? ' was' : 's were'} not saved: ${failed.join('; ')}. Add ${failed.length === 1 ? 'it' : 'them'} from School Rubrics.`;
      }

      setShowForm(false);
      setForm({ gradeLevel: '', subject: '', title: '', description: '' });
      setFile(null);
      resetRubricDrafts();
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
                  {rubricDrafts.length > 0 && (
                    <button type="button" onClick={resetRubricDrafts}
                      className="text-xs font-medium text-slate-500 hover:text-slate-700 shrink-0">Clear all</button>
                  )}
                </div>
                <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                  Add as many as this subject is marked with — your teachers choose from them when
                  building an activity. Skip this and they will pick or write their own.
                </p>

                <div className="space-y-3">
                  {rubricDrafts.map((draft, index) => (
                    <div key={draft.id} className="border border-slate-200 rounded-xl p-3 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                          Rubric {index + 1}
                          {draftReady(draft) && <span className="ml-2 text-emerald-600 normal-case tracking-normal">Ready</span>}
                        </p>
                        <button type="button" onClick={() => removeRubricDraft(draft.id)}
                          className="text-xs font-medium text-slate-400 hover:text-red-600 flex items-center gap-1 shrink-0">
                          <Trash2 className="w-3.5 h-3.5" /> Remove
                        </button>
                      </div>

                      {draft.fileName && (
                        <div className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-lg">
                          <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                          <span className="text-xs font-medium text-slate-600 truncate flex-1">{draft.fileName}</span>
                          {draft.isReading && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
                        </div>
                      )}

                      {draft.isReading ? (
                        <p className="text-xs text-slate-500">Reading the rubric…</p>
                      ) : (
                        <>
                          {draft.mode === 'upload' && !draft.error && (
                            <p className="text-xs text-slate-500 bg-blue-50 border border-blue-100 rounded-lg p-2.5 leading-relaxed">
                              Check these against your document before publishing — correct anything
                              that came out wrong.
                            </p>
                          )}
                          {draft.error && (
                            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">{draft.error}</p>
                          )}
                          {/* Said where the changed numbers are. The criteria
                              below no longer read the way the uploaded document
                              does, and an unexplained 25 where the paper says 4
                              looks like a misreading rather than a conversion. */}
                          {draft.scaledFrom != null && (
                            <p className="text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded-lg p-2.5 leading-relaxed">
                              Your rubric adds up to <strong>{draft.scaledFrom}</strong>, so these have been
                              converted to percentages of 100 — each criterion keeps exactly the share of the
                              mark it had in your document. Teachers apply this as weights; the points an
                              activity is worth stay theirs to set.
                            </p>
                          )}
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">Rubric name</label>
                            {/* Deliberately not `required`. A card the admin
                                added and then thought better of is meant to be
                                publishable — it is simply not saved — and the
                                browser's own validation refused that, popping
                                "Please fill out this field" on an input that
                                may be scrolled out of the modal. It also took
                                the nameless case away from the message below,
                                which explains the choice in words. A card with
                                criteria but no name is still caught there. */}
                            <input type="text" value={draft.name}
                              onChange={e => updateRubricDraft(draft.id, { name: e.target.value })}
                              placeholder="e.g. Grade 6 English — Written Output"
                              className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm" />
                          </div>
                          <RubricEditor criteria={draft.criteria}
                            onChange={next => updateRubricDraft(draft.id, { criteria: next })} />
                        </>
                      )}
                    </div>
                  ))}
                </div>

                {/* Both entry points stay on screen whatever is already added —
                    the second rubric is added exactly the way the first was. */}
                <div className={cn('grid grid-cols-2 gap-2', rubricDrafts.length > 0 && 'mt-3')}>
                  <label className="border-2 border-dashed border-slate-200 rounded-lg p-3 text-center cursor-pointer hover:border-brand-navy hover:bg-blue-50 transition-colors">
                    <UploadCloud className="w-5 h-5 mx-auto mb-1 text-slate-400" />
                    <span className="block text-xs font-medium text-slate-600">
                      {rubricDrafts.length ? 'Upload another' : 'Upload our rubric'}
                    </span>
                    <span className="block text-[11px] text-slate-400 mt-0.5">Read out for you to check</span>
                    <input type="file" accept=".pdf,.docx,image/*" className="hidden"
                      onChange={e => {
                        const input = e.target;
                        const picked = input.files?.[0];
                        if (!picked) return;
                        // Cleared straight away so picking the same file again
                        // still fires a change event. `picked` is already a File
                        // reference and survives this.
                        input.value = '';
                        readRubricFile(addRubricDraft('upload'), picked);
                      }} />
                  </label>
                  <button type="button" onClick={() => addRubricDraft('manual')}
                    className="border-2 border-dashed border-slate-200 rounded-lg p-3 text-center hover:border-brand-navy hover:bg-blue-50 transition-colors">
                    <PenLine className="w-5 h-5 mx-auto mb-1 text-slate-400" />
                    <span className="block text-xs font-medium text-slate-600">
                      {rubricDrafts.length ? 'Type another in' : 'Type it in'}
                    </span>
                    <span className="block text-[11px] text-slate-400 mt-0.5">Name and criteria</span>
                  </button>
                </div>
              </div>

              {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => { setShowForm(false); resetRubricDrafts(); }}
                  className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50">Cancel</button>
                {/* Held while a rubric is being read, as well as while saving —
                    the guard in handleCreate says why. Greyed rather than
                    hidden, so the reason is on screen next to the spinner in
                    the card that is holding it up. */}
                <button type="submit" disabled={isSaving || readingDrafts.length > 0}
                  className={cn('flex-1 py-2.5 rounded-lg text-white font-bold flex items-center justify-center gap-2',
                    isSaving || readingDrafts.length > 0 ? 'bg-slate-300 cursor-not-allowed' : 'bg-brand-navy hover:bg-blue-900')}>
                  {isSaving
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> {file ? 'Parsing...' : 'Saving...'}</>
                    : readingDrafts.length > 0
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
