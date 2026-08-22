/**
 * Editing a curriculum that is already published.
 *
 * Three things a school actually needs after the day it first uploads its
 * guide, none of which were possible before: correct the title, upload the
 * revision that arrived in November, and attach the rubric that was still being
 * argued over in June. The only route to any of them was Delete → publish
 * again, which threw away every lesson the school's classes were built from.
 *
 * Each section commits on its own. They are three different decisions with
 * three different consequences — renaming a curriculum is not the same kind of
 * act as replacing its lessons — and one Save button over all of them would
 * make the smallest of the three feel as dangerous as the largest.
 */
import { useState } from 'react';
import { Loader2, UploadCloud, FileText, X, Trash2, ClipboardList, AlertTriangle, Check } from 'lucide-react';
import { API_URL, apiFetch } from '../config';
import { showAlert, showConfirm } from '../utils/dialog';
import { useRubricDrafts } from '../utils/useRubricDrafts';
import { RubricDraftCard, RubricDraftButtons } from './RubricDrafts';
import { lessonDisplayName } from '../utils/topics';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

const MODES = [
  {
    id: 'replace',
    label: 'Replace the lessons with this document',
    hint: 'The new guide becomes this curriculum. Lessons it no longer lists are removed; the rest are rewritten from it.'
  },
  {
    id: 'append',
    label: 'Add only the new lessons',
    hint: 'Everything already here is left untouched, and the lessons this document adds are appended.'
  },
  {
    id: 'file-only',
    label: 'Just store the file',
    hint: 'For a clearer scan of the same guide. No lesson is added, changed or removed.'
  }
];

export default function CurriculumEditor({ adminId, curriculum, onClose, onSaved }) {
  const [title, setTitle] = useState(curriculum.title || '');
  const [description, setDescription] = useState(curriculum.description || '');
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [detailsSaved, setDetailsSaved] = useState(false);

  const [guideFile, setGuideFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [reading, setReading] = useState(false);
  const [guideError, setGuideError] = useState('');
  const [mode, setMode] = useState('replace');
  const [applying, setApplying] = useState(false);
  const [guideResult, setGuideResult] = useState('');

  const drafts = useRubricDrafts(adminId);
  const [savingRubrics, setSavingRubrics] = useState(false);
  const [rubricError, setRubricError] = useState('');
  const [rubricNotice, setRubricNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const detailsDirty = title.trim() !== (curriculum.title || '')
    || description.trim() !== (curriculum.description || '');

  const saveDetails = async () => {
    if (!title.trim()) { setDetailsError('The curriculum needs a title.'); return; }
    setSavingDetails(true);
    setDetailsError('');
    setDetailsSaved(false);
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${adminId}/curriculums/${curriculum.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), description: description.trim() })
      });
      const d = await res.json();
      if (!d.success) { setDetailsError(d.error || 'Could not save those changes.'); return; }
      setDetailsSaved(true);
      onSaved();
    } catch {
      setDetailsError('Could not reach the server. Nothing has been changed.');
    } finally { setSavingDetails(false); }
  };

  /** Read the revised guide and show what it would change, saving nothing. */
  const readGuide = async (picked) => {
    setGuideFile(picked);
    setPreview(null);
    setGuideError('');
    setGuideResult('');
    setReading(true);
    try {
      const fd = new FormData();
      fd.append('curriculumFile', picked);
      const res = await apiFetch(`${API_URL}/api/admin/${adminId}/curriculums/${curriculum.id}/guide/preview`, {
        method: 'POST', body: fd
      });
      const d = await res.json();
      if (!d.success) { setGuideError(d.error || 'That file could not be read.'); return; }
      setPreview(d);
      setMode('replace');
    } catch {
      setGuideError('Could not reach the server. Nothing has been changed.');
    } finally { setReading(false); }
  };

  const applyGuide = async (chosenMode) => {
    if (!guideFile) return;
    setApplying(true);
    setGuideError('');
    try {
      const fd = new FormData();
      fd.append('curriculumFile', guideFile);
      fd.append('mode', chosenMode);
      // The lessons the admin approved, not a second reading of the document:
      // extraction is an AI call, and re-running it would save something other
      // than what was on screen when they pressed the button.
      if (chosenMode !== 'file-only') fd.append('lessons', JSON.stringify(preview?.lessons || []));
      const res = await apiFetch(`${API_URL}/api/admin/${adminId}/curriculums/${curriculum.id}/guide`, {
        method: 'PUT', body: fd
      });
      const d = await res.json();
      if (!d.success) { setGuideError(d.error || 'The revision could not be applied.'); return; }

      const a = d.applied || {};
      const p = d.propagation || {};
      const parts = [];
      if (a.added) parts.push(`${a.added} lesson${a.added === 1 ? '' : 's'} added`);
      if (a.refreshed) parts.push(`${a.refreshed} rewritten from the document`);
      if (a.removed) parts.push(`${a.removed} removed`);
      let text = parts.length
        ? `Guide updated — ${parts.join(', ')}.`
        : 'Guide updated. The lessons were left as they are.';
      if (p.classes) {
        const carried = [];
        if (p.added) carried.push(`${p.added} lesson${p.added === 1 ? '' : 's'} added`);
        if (p.refreshed) carried.push(`${p.refreshed} updated`);
        if (p.removed) carried.push(`${p.removed} removed`);
        text += ` Carried into ${p.classes} class${p.classes === 1 ? '' : 'es'} this school year: ${carried.join(', ')}.`;
      }
      if (p.keptInUse) {
        // Written without leaning on the sentence before it: when nothing else
        // about a class changed, that sentence is not there at all and "those
        // classes" would refer to nothing.
        const one = p.keptInUse === 1;
        text += ` ${p.keptInUse} lesson${one ? '' : 's'} the document no longer lists already ha${one ? 's' : 've'} activities on ${one ? 'it' : 'them'}, so ${one ? 'it was kept' : 'they were kept'} rather than removed — work already marked against a lesson keeps that lesson.`;
      }
      setGuideResult(text);
      setPreview(null);
      setGuideFile(null);
      onSaved();
    } catch {
      setGuideError('Could not reach the server. The revision has not been applied.');
    } finally { setApplying(false); }
  };

  const saveRubrics = async () => {
    const blocked = drafts.blockingMessage();
    if (blocked) { setRubricError(blocked); return; }
    if (!drafts.ready.length) { setRubricError('Add a rubric first — upload one, or type the criteria in.'); return; }
    setSavingRubrics(true);
    setRubricError('');
    setRubricNotice('');
    const saved = [];
    const failed = [];
    // One request each and sequential, so a failure is attributable to a named
    // rubric and the rest still go.
    for (const draft of drafts.ready) {
      const name = draft.name.trim();
      try {
        const res = await apiFetch(`${API_URL}/api/admin/${adminId}/curriculums/${curriculum.id}/rubrics`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, criteria: draft.criteria.filter(c => c.name.trim()) })
        });
        const d = await res.json();
        if (d.success) saved.push({ name, id: draft.id });
        else failed.push(`"${name}" (${d.error})`);
      } catch {
        failed.push(`"${name}" (could not reach the server)`);
      }
    }
    // Only the cards that were actually saved are cleared. A failed one keeps
    // its typed criteria on screen, which is the whole point of not closing.
    for (const s of saved) drafts.remove(s.id);
    if (saved.length) {
      setRubricNotice(`Saved ${saved.length} rubric${saved.length === 1 ? '' : 's'}: ${saved.map(s => `"${s.name}"`).join(', ')}.`);
      onSaved();
    }
    if (failed.length) {
      setRubricError(`${failed.length} rubric${failed.length === 1 ? ' was' : 's were'} not saved: ${failed.join('; ')}.`);
    }
    setSavingRubrics(false);
  };

  const removeRubric = async (rubric) => {
    if (!(await showConfirm(`Delete the rubric "${rubric.name}"? Activities already using it keep the copy they were built with.`,
      { confirmLabel: 'Delete rubric', danger: true }))) return;
    setBusy(true);
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${adminId}/rubrics/${rubric.id}`, { method: 'DELETE' });
      const d = await res.json();
      if (d.success) onSaved();
      else showAlert(d.error || 'Could not delete that rubric.');
    } catch {
      showAlert('Could not reach the server. The rubric has not been deleted.');
    } finally { setBusy(false); }
  };

  /**
   * Closing with work still on screen.
   *
   * Every section here commits on its own, so "Done" is not a Save — and a
   * previewed guide or a typed-in rubric that has not been applied yet is lost
   * the moment this closes. Asked about rather than silently discarded, and
   * only when there is actually something to lose.
   */
  const handleClose = async () => {
    const pending = [];
    if (detailsDirty) pending.push('unsaved title or description changes');
    if (preview) pending.push('a guide you have read but not applied');
    if (drafts.drafts.some(d => d.isReading || d.name.trim() || d.criteria.some(c => c.name.trim()))) {
      pending.push('a rubric you have not saved');
    }
    if (pending.length && !(await showConfirm(
      `You have ${pending.join(', and ')}. Closing loses that — nothing on this screen is saved until you press its own button.`,
      { confirmLabel: 'Close anyway', danger: true }
    ))) return;
    onClose();
  };

  const newCount = preview?.lessons.filter(l => l.isNew).length || 0;
  const goingCount = preview?.current.filter(l => !l.inRevision).length || 0;
  const rubrics = curriculum.rubrics || [];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl my-8">
        <div className="flex items-start justify-between gap-3 p-6 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-xl font-bold text-brand-slate">Edit curriculum</h2>
            <p className="text-slate-500 text-sm">{curriculum.gradeLevel} · {curriculum.subject}</p>
          </div>
          <button type="button" onClick={handleClose} className="text-slate-400 hover:text-slate-600 shrink-0 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-8">
          {/* ── Details ── */}
          <section className="space-y-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Details</h3>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Title *</label>
              <input type="text" value={title} onChange={e => { setTitle(e.target.value); setDetailsSaved(false); }}
                className="w-full border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
              <textarea rows={2} value={description}
                onChange={e => { setDescription(e.target.value); setDetailsSaved(false); }}
                className="w-full border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm resize-none" />
            </div>
            <p className="text-xs text-slate-400">
              Grade level and subject cannot be changed here — they are what decides which classes this
              curriculum is offered to. Publish a separate curriculum for another grade or subject.
            </p>
            {detailsError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">{detailsError}</p>}
            <div className="flex items-center gap-3">
              <button type="button" onClick={saveDetails} disabled={savingDetails || !detailsDirty}
                className={cn('text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2',
                  savingDetails || !detailsDirty ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-brand-navy text-white hover:bg-blue-900')}>
                {savingDetails && <Loader2 className="w-4 h-4 animate-spin" />} Save details
              </button>
              {detailsSaved && !detailsDirty && (
                <span className="text-xs font-medium text-emerald-600 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Saved</span>
              )}
            </div>
          </section>

          {/* ── The guide ── */}
          <section className="space-y-3 border-t border-slate-100 pt-6">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Curriculum guide</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Upload the revised document and its lessons are read out for you to check before anything is
              saved. This curriculum currently has {curriculum.lessons?.length || 0} lesson
              {(curriculum.lessons?.length || 0) === 1 ? '' : 's'}.
            </p>

            {!preview && !reading && (
              <label className="block border-2 border-dashed border-slate-200 rounded-lg p-4 text-center cursor-pointer hover:border-brand-navy hover:bg-blue-50 transition-colors">
                <UploadCloud className="w-6 h-6 mx-auto mb-1 text-slate-400" />
                <p className="text-xs text-slate-500">Upload the revised PDF or DOCX</p>
                <input type="file" accept=".pdf,.docx" className="hidden"
                  onChange={e => {
                    const input = e.target;
                    const picked = input.files?.[0];
                    if (!picked) return;
                    input.value = '';
                    readGuide(picked);
                  }} />
              </label>
            )}

            {reading && (
              <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-600">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                Reading {guideFile?.name} — this takes a moment, and nothing is saved until you choose.
              </div>
            )}

            {guideError && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
                <p>{guideError}</p>
                {guideFile && !applying && (
                  <button type="button" onClick={() => applyGuide('file-only')}
                    className="text-xs font-bold text-red-800 underline">
                    Store the file anyway and leave the lessons alone
                  </button>
                )}
              </div>
            )}

            {guideResult && (
              <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-3 leading-relaxed">{guideResult}</p>
            )}

            {preview && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-lg">
                  <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="text-xs font-medium text-slate-600 truncate flex-1">{guideFile?.name}</span>
                  <button type="button" onClick={() => { setPreview(null); setGuideFile(null); }}
                    className="text-red-400 hover:text-red-600" title="Discard this file">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <p className="text-sm text-slate-600">
                  <strong>{preview.lessons.length}</strong> lesson{preview.lessons.length === 1 ? '' : 's'} read
                  {' '}— <strong>{newCount}</strong> not in this curriculum yet.
                </p>

                <div className="max-h-52 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {preview.lessons.map((l, i) => (
                    <div key={i} className="flex items-start gap-2 p-2.5">
                      <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 mt-0.5',
                        l.isNew ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                        {l.isNew ? 'NEW' : 'ALREADY HERE'}
                      </span>
                      <span className="text-xs text-slate-700 leading-relaxed">
                        {lessonDisplayName(l)}
                      </span>
                    </div>
                  ))}
                </div>

                {goingCount > 0 && (
                  <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1.5">
                    <p className="font-bold flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {goingCount} lesson{goingCount === 1 ? '' : 's'} here {goingCount === 1 ? 'is' : 'are'} not in the new document
                    </p>
                    <ul className="list-disc list-inside space-y-0.5 leading-relaxed">
                      {preview.current.filter(l => !l.inRevision).map(l => (
                        <li key={l.id}>{lessonDisplayName(l)}</li>
                      ))}
                    </ul>
                    <p>Replacing removes {goingCount === 1 ? 'it' : 'them'} from the curriculum. Adding the new lessons keeps {goingCount === 1 ? 'it' : 'them'}.</p>
                  </div>
                )}

                {preview.classCount > 0 && (
                  <p className="text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded-lg p-3 leading-relaxed">
                    <strong>{preview.classCount}</strong> class{preview.classCount === 1 ? '' : 'es'} this school year
                    follow{preview.classCount === 1 ? 's' : ''} this curriculum, and the change is carried into
                    {preview.classCount === 1 ? ' it' : ' them'} too.
                    {preview.lessonsInUse > 0 && (
                      <> {preview.lessonsInUse} of their lesson{preview.lessonsInUse === 1 ? '' : 's'} already
                      ha{preview.lessonsInUse === 1 ? 's' : 've'} activities on {preview.lessonsInUse === 1 ? 'it' : 'them'}.
                      {preview.lessonsInUse === 1 ? ' It is' : ' Those are'} updated in place, so the learning
                      competencies in this document reach the work that already exists — the activities keep the
                      lesson they are on.</>
                    )}
                    {preview.lessonsKeptFromRemoval > 0 && (
                      <> {preview.lessonsKeptFromRemoval} of {preview.lessonsInUse === 1 ? 'them' : 'those'} {preview.lessonsKeptFromRemoval === 1 ? 'is' : 'are'} not
                      in the new document; {preview.lessonsKeptFromRemoval === 1 ? 'it is kept' : 'they are kept'} rather than removed,
                      because deleting {preview.lessonsKeptFromRemoval === 1 ? 'it' : 'them'} would cut that work loose from its lesson.</>
                    )}
                  </p>
                )}

                <div className="space-y-2">
                  {MODES.map(m => {
                    const pointless = m.id === 'append' && newCount === 0;
                    return (
                      <label key={m.id}
                        className={cn('flex items-start gap-2.5 p-2.5 border rounded-lg cursor-pointer',
                          mode === m.id ? 'border-brand-navy bg-blue-50/60' : 'border-slate-200 hover:border-slate-300',
                          pointless && 'opacity-50 cursor-not-allowed')}>
                        <input type="radio" name="guide-mode" value={m.id} checked={mode === m.id} disabled={pointless}
                          onChange={() => setMode(m.id)} className="mt-0.5 accent-brand-navy" />
                        <span>
                          <span className="block text-sm font-semibold text-brand-slate">{m.label}</span>
                          <span className="block text-xs text-slate-500 leading-relaxed">
                            {pointless ? 'Every lesson in this document is already here.' : m.hint}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>

                <button type="button" onClick={() => applyGuide(mode)} disabled={applying}
                  className={cn('w-full py-2.5 rounded-lg text-white font-bold flex items-center justify-center gap-2',
                    applying ? 'bg-slate-300 cursor-not-allowed' : 'bg-brand-navy hover:bg-blue-900')}>
                  {applying ? <><Loader2 className="w-4 h-4 animate-spin" /> Applying…</> : 'Apply this guide'}
                </button>
              </div>
            )}
          </section>

          {/* ── Rubrics ── */}
          <section className="space-y-3 border-t border-slate-100 pt-6">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">School rubrics for this subject</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Your teachers choose from these when building an activity. Add as many as this subject is
              marked with — written output, speaking and a performance task are rarely the same rubric.
            </p>

            {rubrics.length > 0 && (
              <div className="space-y-2">
                {rubrics.map(r => (
                  <div key={r.id} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                    <ClipboardList className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="text-sm font-medium text-brand-slate truncate flex-1">{r.name}</span>
                    <button type="button" onClick={() => removeRubric(r)} disabled={busy}
                      className="p-1.5 rounded-md text-slate-300 hover:text-red-500 hover:bg-red-50 shrink-0 disabled:opacity-40"
                      title="Delete rubric">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {drafts.drafts.length > 0 && (
              <div className="space-y-3">
                {drafts.drafts.map((draft, index) => (
                  <RubricDraftCard key={draft.id} draft={draft} index={index}
                    onChange={patch => drafts.update(draft.id, patch)}
                    onRemove={() => drafts.remove(draft.id)} />
                ))}
              </div>
            )}

            <RubricDraftButtons count={drafts.drafts.length}
              onUpload={picked => drafts.readFile(drafts.add('upload'), picked)}
              onManual={() => drafts.add('manual')} />

            {rubricError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">{rubricError}</p>}
            {rubricNotice && <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-2.5">{rubricNotice}</p>}

            {drafts.drafts.length > 0 && (
              <button type="button" onClick={saveRubrics} disabled={savingRubrics || drafts.reading.length > 0}
                className={cn('text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2',
                  savingRubrics || drafts.reading.length > 0
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    : 'bg-brand-navy text-white hover:bg-blue-900')}>
                {savingRubrics
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                  : drafts.reading.length > 0
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Reading rubric…</>
                    : `Save rubric${drafts.ready.length === 1 ? '' : 's'}`}
              </button>
            )}
          </section>
        </div>

        <div className="border-t border-slate-100 p-4">
          <button type="button" onClick={handleClose}
            className="w-full py-2.5 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
