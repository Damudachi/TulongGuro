import { useState, useEffect, useCallback } from 'react';
import { ClipboardList, Plus, Loader2, Trash2 } from 'lucide-react';
import { API_URL } from '../../config';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

const BLANK_CRITERION = { name: '', points: 0, description: '' };

/**
 * School-wide rubric templates. Published by the admin and offered to every
 * teacher in the school alongside their own private templates.
 */
export default function AdminRubrics() {
  const admin = JSON.parse(localStorage.getItem('user') || '{}');
  const [rubrics, setRubrics] = useState([]);
  const [builtins, setBuiltins] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [criteria, setCriteria] = useState([{ ...BLANK_CRITERION }]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    if (!admin.id) return setIsLoading(false);
    Promise.all([
      fetch(`${API_URL}/api/admin/${admin.id}/rubrics`).then(r => r.json()),
      fetch(`${API_URL}/api/rubric-templates/builtin`).then(r => r.json()).catch(() => ({}))
    ]).then(([mine, builtin]) => {
      if (mine.success) setRubrics(mine.rubrics || []);
      setBuiltins(builtin.templates || builtin.rubrics || []);
    }).finally(() => setIsLoading(false));
  }, [admin.id]);

  useEffect(() => { load(); }, [load]);

  const totalPoints = criteria.reduce((sum, c) => sum + (parseInt(c.points) || 0), 0);

  const updateCriterion = (idx, field, value) =>
    setCriteria(prev => prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c)));

  const startFromBuiltin = (template) => {
    const parsed = typeof template.criteria === 'string' ? JSON.parse(template.criteria) : template.criteria;
    setName(template.name);
    setCriteria((parsed || []).map(c => ({ name: c.name, points: c.points, description: c.description || '' })));
    setError('');
    setShowForm(true);
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
      const res = await fetch(`${API_URL}/api/admin/${admin.id}/rubrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, criteria: criteria.map(c => ({ ...c, points: parseInt(c.points) || 0 })) })
      });
      const d = await res.json();
      if (d.success) {
        setShowForm(false);
        setName('');
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
      const res = await fetch(`${API_URL}/api/admin/${admin.id}/rubrics/${rubric.id}`, { method: 'DELETE' });
      const d = await res.json();
      if (d.success) load(); else alert(d.error);
    } finally { setBusyId(null); }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2" />Loading rubrics...</div>;
  }

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
          <p className="text-sm mt-1">Publish one so your teachers grade consistently.</p>
        </div>
      ) : (
        <div className="space-y-3 mb-8">
          {rubrics.map(r => {
            let parsed = [];
            try { parsed = JSON.parse(r.criteria); } catch { /* malformed, show none */ }
            return (
              <div key={r.id} className="bg-white border border-slate-200 rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <p className="font-bold text-brand-slate">{r.name}</p>
                    <p className="text-xs text-slate-500">{parsed.length} criteria · school-wide</p>
                  </div>
                  <button onClick={() => handleDelete(r)} disabled={busyId === r.id}
                    className="p-2 rounded-lg bg-slate-100 text-slate-500 hover:bg-red-100 hover:text-red-600 shrink-0 disabled:opacity-40">
                    {busyId === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>
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

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-slate-700">Criteria</label>
                  <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full',
                    totalPoints === 100 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700')}>
                    {totalPoints}% / 100%
                  </span>
                </div>
                <div className="space-y-2">
                  {criteria.map((c, i) => (
                    <div key={i} className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                      <div className="flex gap-2">
                        <input required type="text" value={c.name} placeholder="Criterion name"
                          onChange={e => updateCriterion(i, 'name', e.target.value)}
                          className="flex-1 border border-slate-200 p-2 rounded text-sm outline-none focus:ring-1 focus:ring-brand-navy" />
                        <input required type="number" min={0} max={100} value={c.points === 0 ? '' : c.points}
                          placeholder="%"
                          onChange={e => updateCriterion(i, 'points', e.target.value === '' ? 0 : parseInt(e.target.value))}
                          className="w-20 border border-slate-200 p-2 rounded text-sm outline-none focus:ring-1 focus:ring-brand-navy" />
                        {criteria.length > 1 && (
                          <button type="button" onClick={() => setCriteria(prev => prev.filter((_, idx) => idx !== i))}
                            className="text-slate-400 hover:text-red-500 px-1">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      <input type="text" value={c.description} placeholder="What this criterion evaluates"
                        onChange={e => updateCriterion(i, 'description', e.target.value)}
                        className="w-full border border-slate-200 p-2 rounded text-sm outline-none focus:ring-1 focus:ring-brand-navy" />
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => setCriteria(prev => [...prev, { ...BLANK_CRITERION }])}
                  className="mt-2 text-xs font-bold text-brand-navy bg-blue-50 px-3 py-2 rounded-lg hover:bg-blue-100 flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5" /> Add Criterion
                </button>
              </div>

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
