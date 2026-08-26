import { useState, useEffect, useCallback } from 'react';
import {
  ClipboardList, Plus, Loader2, Trash2, BookOpen, Pencil, Check, X,
  UploadCloud, AlertTriangle, Percent, ListOrdered,
} from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { GRADE_LEVELS, SUBJECTS } from '../../constants/school';
import { ACTIVITY_TYPES } from '../../constants/activityTypes';
import RubricEditor from '../../components/RubricEditor';
import { BLANK_CRITERION, totalWeight, blankCriterion, detectRubricType } from '../../utils/rubric';

import { showAlert, showConfirm } from '../../utils/dialog';
function cn(...cls) { return cls.filter(Boolean).join(' '); }
const UNTAGGED = 'Any grade level / subject';

/** Groups rubrics into "Grade — Subject" buckets, untagged ones last. */
function groupRubrics(rubrics) {
  const groups = {};
  rubrics.forEach(r => {
    const key = r.gradeLevel || r.subject
      ? `${r.gradeLevel || 'Any grade'} — ${r.subject || 'Any subject'}`
      : UNTAGGED;
    (groups[key] = groups[key] || []).push(r);
  });
  const keys = Object.keys(groups).sort((a, b) => {
    if (a === UNTAGGED) return 1;
    if (b === UNTAGGED) return -1;
    const gi = (k) => GRADE_LEVELS.indexOf(k.split(' — ')[0]);
    return gi(a) - gi(b) || a.localeCompare(b);
  });
  return { groups, keys };
}

/**
 * School-wide rubric templates. Published by the admin and offered to every
 * teacher in the school alongside their own private templates.
 */
export default function AdminRubrics() {
  const admin = JSON.parse(localStorage.getItem('user') || '{}');
  const [rubrics, setRubrics] = useState([]);
  const [builtins, setBuiltins] = useState([]);
  // No admin id means there is nothing to fetch, so this must not open on a
  // spinner that only the first commit would take away again (see load below).
  const [isLoading, setIsLoading] = useState(() => !!admin.id);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [criteria, setCriteria] = useState([{ ...BLANK_CRITERION }]);
  const [meta, setMeta] = useState({ gradeLevel: '', subject: '', outputType: '' });
  /**
   * Which shape the rubric being written has.
   *
   * This page could only ever author the standard shape, so a school whose
   * rubric is a band ladder — which is most DepEd rubrics on paper — had to
   * hand it to a teacher to type in, and the copy then belonged to that
   * teacher rather than to the school. The two are marked in genuinely
   * different units and the editor renders differently for each, so it is a
   * choice made before the blank form opens rather than something inferred
   * from an empty rubric.
   */
  const [rubricType, setRubricType] = useState('standard');
  /** Set while the admin is being asked which shape a brand-new rubric has. */
  const [choosingType, setChoosingType] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  // Segmentation filters over the saved rubrics.
  const [filter, setFilter] = useState({ gradeLevel: '', subject: '' });
  const [retagId, setRetagId] = useState(null);
  const [retagForm, setRetagForm] = useState({ gradeLevel: '', subject: '' });

  const load = useCallback(() => {
    if (!admin.id) return;
    Promise.all([
      apiFetch(`${API_URL}/api/admin/${admin.id}/rubrics`).then(r => r.json()),
      apiFetch(`${API_URL}/api/rubric-templates/builtin`).then(r => r.json()).catch(() => ({}))
    ]).then(([mine, builtin]) => {
      if (mine.success) setRubrics(mine.rubrics || []);
      setBuiltins(builtin.templates || builtin.rubrics || []);
    }).finally(() => setIsLoading(false));
  }, [admin.id]);

  useEffect(() => { load(); }, [load]);

  const totalPoints = totalWeight(criteria);

  /** Open a blank form of the chosen shape. */
  const startCreating = (type) => {
    setChoosingType(false);
    setRubricType(type);
    setName('');
    setCriteria([blankCriterion(type)]);
    setMeta({ gradeLevel: '', subject: '', outputType: '' });
    setError('');
    setUploadError('');
    setShowForm(true);
  };

  const startFromBuiltin = (template) => {
    const parsed = typeof template.criteria === 'string' ? JSON.parse(template.criteria) : template.criteria;
    setName(template.name);
    // Bands are carried over rather than flattened away — a built-in that
    // ships a ladder is a banded rubric, and dropping them here would silently
    // turn it into a percentage split of the same numbers.
    setCriteria((parsed || []).map(c => ({
      name: c.name, points: c.points, description: c.description || '',
      ...(c.bands?.length ? { bands: c.bands } : {}),
    })));
    setRubricType(detectRubricType(parsed));
    setMeta({ gradeLevel: '', subject: '', outputType: '' });
    setError('');
    setShowForm(true);
  };

  /**
   * Read a rubric out of an uploaded document and open it in the form.
   *
   * Deliberately lands in the editor rather than saving straight off. What
   * comes back is an extraction, not a transcription — criterion weights get
   * rescaled, band descriptions get condensed — and this rubric is what every
   * paper in the school marked against it will be judged by. It is checked
   * before it is published, the same way the teacher's own upload works.
   */
  const handleRubricUpload = async (e) => {
    const file = e.target.files?.[0];
    // Cleared immediately so picking the same file twice still fires a change
    // event — otherwise a failed extraction cannot be retried without choosing
    // a different file first.
    e.target.value = '';
    if (!file) return;

    setUploadError('');
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append('rubricFile', file);
      // No activityPoints: a school template is not written for one activity,
      // so there is no total to divide the criteria into. The server falls back
      // to percentage weights, which is the right shape for a reusable one.
      const res = await apiFetch(`${API_URL}/api/admin/${admin.id}/rubrics/extract`, { method: 'POST', body: fd });
      const d = await res.json().catch(() => null);

      if (!res.ok || !d?.success || !Array.isArray(d.criteria) || d.criteria.length === 0) {
        setUploadError(d?.error
          || 'No criteria could be read from that file. A rubric table in Word, PDF or an image works best.');
        return;
      }

      // Bands first, the model's own label second. The extractor's prompt asks
      // for bands whenever levels are visible, whichever type it decided the
      // document was, so a ladder can arrive labelled 'standard' — and taking
      // the label there draws it in a table measured against a 100% total.
      setRubricType(detectRubricType(d.criteria) === 'range' ? 'range' : (d.rubricType || 'standard'));
      setCriteria(d.criteria);
      // The filename with its extension dropped: it is almost always what the
      // school calls this rubric, and it is editable in the very next field.
      setName(file.name.replace(/\.[^.]+$/, '').slice(0, 80));
      setMeta({ gradeLevel: '', subject: '', outputType: '' });
      setError('');
      setShowForm(true);
    } catch {
      setUploadError('Network error while reading that file. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const saveRetag = async (rubric) => {
    setBusyId(rubric.id);
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${admin.id}/rubrics/${rubric.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(retagForm)
      });
      const d = await res.json();
      if (d.success) { setRetagId(null); load(); }
      else showAlert(d.error);
    } finally { setBusyId(null); }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (isSaving) return;
    // The 100% rule belongs to the standard shape only. A banded rubric scores
    // each criterion on its own ladder, so there is no total for its weights to
    // hit — holding one to 100% is what made a band ladder unpublishable here.
    if (rubricType === 'standard' && totalPoints !== 100) {
      setError(`Criteria weights must total 100%. They currently total ${totalPoints}%.`);
      return;
    }
    if (criteria.some(c => !c.name?.trim())) {
      setError('Every criterion needs a name — an unnamed one tells neither the AI nor the student what was marked.');
      return;
    }
    setIsSaving(true);
    setError('');
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${admin.id}/rubrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          // Sent so the server can apply the same shape-dependent rule this
          // form does, rather than re-deriving it from the criteria.
          type: rubricType,
          criteria: criteria.map(c => ({ ...c, points: parseInt(c.points) || 0 })),
          ...meta
        })
      });
      const d = await res.json();
      if (d.success) {
        setShowForm(false);
        setName('');
        setMeta({ gradeLevel: '', subject: '', outputType: '' });
        setCriteria([{ ...BLANK_CRITERION }]);
        setRubricType('standard');
        load();
      } else setError(d.error || 'Could not save this rubric.');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (rubric) => {
    if (!(await showConfirm(`Delete "${rubric.name}"? Teachers will no longer see it.`,
      { confirmLabel: 'Delete rubric', danger: true }))) return;
    setBusyId(rubric.id);
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${admin.id}/rubrics/${rubric.id}`, { method: 'DELETE' });
      const d = await res.json();
      if (d.success) load(); else showAlert(d.error);
    } finally { setBusyId(null); }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2" />Loading rubrics...</div>;
  }

  // Untagged rubrics apply everywhere, so a filter never hides them.
  const visible = rubrics.filter(r =>
    (!filter.gradeLevel || !r.gradeLevel || r.gradeLevel === filter.gradeLevel) &&
    (!filter.subject || !r.subject || r.subject === filter.subject)
  );
  const { groups, keys } = groupRubrics(visible);

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-brand-slate">School Rubrics</h1>
          <p className="text-slate-500 text-sm">Templates every teacher in your school can apply to an activity</p>
        </div>
        <div className="flex gap-2 shrink-0">
          {/* A label wrapping a hidden input: a <button> cannot open a file
              picker without reaching for a ref, and the label already is the
              control the browser wants here. */}
          <label className={cn('border border-slate-200 bg-white text-brand-slate px-4 py-2.5 rounded-lg text-sm font-bold hover:border-brand-navy flex items-center gap-2',
            isUploading ? 'opacity-50 pointer-events-none' : 'cursor-pointer')}>
            {isUploading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Reading file…</>
              : <><UploadCloud className="w-4 h-4" /> Upload Rubric</>}
            <input type="file" className="hidden" disabled={isUploading}
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp"
              onChange={handleRubricUpload} />
          </label>
          <button onClick={() => { setChoosingType(true); setUploadError(''); }}
            className="bg-brand-navy text-white px-4 py-2.5 rounded-lg text-sm font-bold hover:bg-blue-900 shadow-md flex items-center gap-2">
            <Plus className="w-4 h-4" /> Add Rubric
          </button>
        </div>
      </div>

      {uploadError && (
        <div role="alert" className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-amber-800">Could not read that rubric</p>
            <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">{uploadError}</p>
          </div>
          <button onClick={() => setUploadError('')} aria-label="Dismiss" className="text-amber-500 hover:text-amber-700 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {rubrics.length === 0 ? (
        <div className="text-center py-14 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 mb-8">
          <ClipboardList className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No school rubrics yet</p>
          <p className="text-sm mt-1">Publish one here, or add your school&apos;s rubric while setting up a curriculum.</p>
        </div>
      ) : (
        <>
          {/* Segmentation filters */}
          <div className="flex flex-wrap items-center gap-2 mb-5">
            <select value={filter.gradeLevel} onChange={e => setFilter({ ...filter, gradeLevel: e.target.value })}
              className="border border-slate-200 bg-white px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-navy">
              <option value="">All grade levels</option>
              {GRADE_LEVELS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <select value={filter.subject} onChange={e => setFilter({ ...filter, subject: e.target.value })}
              className="border border-slate-200 bg-white px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-navy">
              <option value="">All subjects</option>
              {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {(filter.gradeLevel || filter.subject) && (
              <button onClick={() => setFilter({ gradeLevel: '', subject: '' })}
                className="text-xs font-medium text-slate-500 hover:text-slate-700 underline">Clear</button>
            )}
            <span className="text-xs text-slate-400 ml-auto">{visible.length} of {rubrics.length} rubric(s)</span>
          </div>

          {visible.length === 0 ? (
            <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 mb-8">
              <p className="text-sm font-medium">No rubrics match that filter</p>
            </div>
          ) : (
            <div className="space-y-6 mb-8">
              {keys.map(groupKey => (
                <div key={groupKey}>
                  <p className="text-xs font-bold text-brand-navy bg-blue-50 inline-block px-2.5 py-1 rounded-full mb-2">
                    {groupKey}
                  </p>
                  <div className="space-y-3">
                    {groups[groupKey].map(r => {
                      let parsed = [];
                      try { parsed = JSON.parse(r.criteria); } catch { /* malformed, show none */ }
                      return (
                        <div key={r.id} className="bg-white border border-slate-200 rounded-2xl p-4">
                          <div className="flex items-start justify-between gap-3 mb-3">
                            <div className="min-w-0">
                              <p className="font-bold text-brand-slate">{r.name}</p>
                              <p className="text-xs text-slate-500 flex items-center gap-1.5 flex-wrap mt-0.5">
                                <span>{parsed.length} criteria</span>
                                {r.outputType && <span className="text-slate-300">·</span>}
                                {r.outputType && <span>{r.outputType}</span>}
                                {/* A book, not a sparkle. This marks a rubric
                                    attached to a curriculum by an admin — no AI
                                    involved — and the sparkle read as though
                                    something had generated it. */}
                                {r.curriculum && (
                                  <span className="inline-flex items-center gap-1 text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">
                                    <BookOpen className="w-3 h-3" /> from {r.curriculum.title}
                                  </span>
                                )}
                              </p>
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <button onClick={() => { setRetagId(r.id); setRetagForm({ gradeLevel: r.gradeLevel || '', subject: r.subject || '' }); }}
                                title="Change grade level / subject"
                                className="p-2 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200">
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button onClick={() => handleDelete(r)} disabled={busyId === r.id}
                                className="p-2 rounded-lg bg-slate-100 text-slate-500 hover:bg-red-100 hover:text-red-600 disabled:opacity-40">
                                {busyId === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>

                          {retagId === r.id && (
                            <div className="flex flex-wrap items-center gap-2 mb-3 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                              <select value={retagForm.gradeLevel} onChange={e => setRetagForm({ ...retagForm, gradeLevel: e.target.value })}
                                className="border border-slate-200 bg-white px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-navy">
                                <option value="">Any grade level</option>
                                {GRADE_LEVELS.map(g => <option key={g} value={g}>{g}</option>)}
                              </select>
                              <select value={retagForm.subject} onChange={e => setRetagForm({ ...retagForm, subject: e.target.value })}
                                className="border border-slate-200 bg-white px-2 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-navy">
                                <option value="">Any subject</option>
                                {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                              <button onClick={() => saveRetag(r)} disabled={busyId === r.id}
                                className="text-xs font-bold text-white bg-brand-navy px-3 py-1.5 rounded-lg hover:bg-blue-900 flex items-center gap-1 disabled:opacity-40">
                                <Check className="w-3.5 h-3.5" /> Save
                              </button>
                              <button onClick={() => setRetagId(null)}
                                className="text-xs font-medium text-slate-500 hover:text-slate-700 flex items-center gap-1">
                                <X className="w-3.5 h-3.5" /> Cancel
                              </button>
                            </div>
                          )}

                          <div className="flex flex-wrap gap-2">
                            {parsed.map((c, i) => (
                              <span key={i} className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full font-medium">
                                {c.name} · {c.points}%
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Built-in starting points */}
      {builtins.length > 0 && (
        <>
          <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Start from a DepEd template</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {builtins.map(t => (
              <button key={t.id} onClick={() => startFromBuiltin(t)}
                className="bg-white border border-slate-200 rounded-xl p-4 text-left hover:border-brand-navy hover:shadow-sm transition-all">
                <p className="font-semibold text-brand-slate text-sm">{t.name}</p>
                {t.description && <p className="text-xs text-slate-500 mt-1 leading-relaxed">{t.description}</p>}
              </button>
            ))}
          </div>
        </>
      )}

      {/* ── Which shape, before the blank form opens ──
          Standard and Range are not two skins of one thing: one splits 100% of
          the mark between criteria, the other scores each criterion on its own
          band ladder, and the editor and the grader both branch on it. Asking
          once here is cheaper than an admin filling in five criteria and then
          finding the columns are the wrong units. */}
      {choosingType && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl my-8">
            <h2 className="text-xl font-bold text-brand-slate mb-1">Add a school rubric</h2>
            <p className="text-slate-500 text-sm mb-5">How is this one marked?</p>

            <button onClick={() => startCreating('standard')}
              className="w-full text-left border-2 border-slate-200 rounded-xl p-4 mb-3 hover:border-brand-navy hover:bg-slate-50 transition-colors flex gap-3">
              <span className="w-10 h-10 rounded-xl bg-green-100 text-green-700 grid place-items-center shrink-0">
                <Percent className="w-5 h-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-bold text-brand-slate">Standard — percentage weights</span>
                <span className="block text-xs text-slate-500 mt-0.5 leading-relaxed">
                  Each criterion takes a share of the mark, and the shares add up to 100%.
                  Content 40%, Organisation 30%, Grammar 30%.
                </span>
              </span>
            </button>

            <button onClick={() => startCreating('range')}
              className="w-full text-left border-2 border-slate-200 rounded-xl p-4 hover:border-brand-navy hover:bg-slate-50 transition-colors flex gap-3">
              <span className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 grid place-items-center shrink-0">
                <ListOrdered className="w-5 h-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-bold text-brand-slate">Range — scoring bands</span>
                <span className="block text-xs text-slate-500 mt-0.5 leading-relaxed">
                  Each criterion is scored on its own ladder, with a description per level.
                  Excellent 5, Very Good 4, Good 3, and so on.
                </span>
              </span>
            </button>

            <button onClick={() => setChoosingType(false)}
              className="mt-4 w-full py-2.5 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Rubric editor */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl shadow-xl my-8">
            <h2 className="text-xl font-bold text-brand-slate mb-1">
              New school rubric{' '}
              <span className="text-sm font-medium text-slate-400">
                ({rubricType === 'standard' ? 'percentage weights' : 'scoring bands'})
              </span>
            </h2>
            <p className="text-slate-500 text-sm mb-5">
              {rubricType === 'standard'
                ? 'Criteria weights must total 100%.'
                : 'Each criterion is scored on its own band ladder.'}
            </p>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Rubric name *</label>
                <input required type="text" value={name} onChange={e => setName(e.target.value)}
                  placeholder="e.g. Grade 6 Narrative Writing"
                  className="w-full border border-slate-200 p-2.5 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm" />
              </div>

              {/* Segmentation — leaving these blank makes the rubric apply everywhere */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Grade level</label>
                  <select value={meta.gradeLevel} onChange={e => setMeta({ ...meta, gradeLevel: e.target.value })}
                    className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm">
                    <option value="">Any</option>
                    {GRADE_LEVELS.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Subject</label>
                  <select value={meta.subject} onChange={e => setMeta({ ...meta, subject: e.target.value })}
                    className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm">
                    <option value="">Any</option>
                    {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Output type</label>
                  <select value={meta.outputType} onChange={e => setMeta({ ...meta, outputType: e.target.value })}
                    className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy text-sm">
                    <option value="">Any</option>
                    {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <p className="text-xs text-slate-400 -mt-2">Leave blank to make this rubric available for every class.</p>

              <RubricEditor criteria={criteria} onChange={setCriteria} type={rubricType} />

              {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => { setShowForm(false); setRubricType('standard'); }}
                  className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={isSaving}
                  className={cn('flex-1 py-2.5 rounded-lg text-white font-bold flex items-center justify-center gap-2',
                    isSaving ? 'bg-slate-300 cursor-not-allowed' : 'bg-brand-navy hover:bg-blue-900')}>
                  {isSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : 'Publish Rubric'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
