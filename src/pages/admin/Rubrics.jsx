import { useState, useEffect, useCallback } from 'react';
import { ClipboardList, Plus, Loader2, Trash2, Sparkles, Pencil, Check, X } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { GRADE_LEVELS, SUBJECTS } from '../../constants/school';
import { ACTIVITY_TYPES } from '../../constants/activityTypes';
import RubricEditor from '../../components/RubricEditor';
import { BLANK_CRITERION, totalWeight } from '../../utils/rubric';

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

  const startFromBuiltin = (template) => {
    const parsed = typeof template.criteria === 'string' ? JSON.parse(template.criteria) : template.criteria;
    setName(template.name);
    setCriteria((parsed || []).map(c => ({ name: c.name, points: c.points, description: c.description || '' })));
    setMeta({ gradeLevel: '', subject: '', outputType: '' });
    setError('');
    setShowForm(true);
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
      else alert(d.error);
    } finally { setBusyId(null); }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (isSaving) return;
    if (totalPoints !== 100) {
      setError(`Criteria weights must total 100%. They currently total ${totalPoints}%.`);
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
        load();
      } else setError(d.error || 'Could not save this rubric.');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (rubric) => {
    if (!confirm(`Delete "${rubric.name}"? Teachers will no longer see it.`)) return;
    setBusyId(rubric.id);
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${admin.id}/rubrics/${rubric.id}`, { method: 'DELETE' });
      const d = await res.json();
      if (d.success) load(); else alert(d.error);
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
        <button onClick={() => { setShowForm(true); setError(''); }}
          className="bg-brand-navy text-white px-4 py-2.5 rounded-lg text-sm font-bold hover:bg-blue-900 shadow-md flex items-center gap-2 shrink-0">
          <Plus className="w-4 h-4" /> Add Rubric
        </button>
      </div>

      {rubrics.length === 0 ? (
        <div className="text-center py-14 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 mb-8">
          <ClipboardList className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No school rubrics yet</p>
          <p className="text-sm mt-1">Publish one, or upload a curriculum — its rubrics are saved here automatically.</p>
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
                                {r.curriculum && (
                                  <span className="inline-flex items-center gap-1 text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">
                                    <Sparkles className="w-3 h-3" /> from {r.curriculum.title}
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

      {/* Rubric editor */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl my-8">
            <h2 className="text-xl font-bold text-brand-slate mb-1">New school rubric</h2>
            <p className="text-slate-500 text-sm mb-5">Criteria weights must total 100%.</p>
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

              <RubricEditor criteria={criteria} onChange={setCriteria} />

              {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setShowForm(false)}
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
