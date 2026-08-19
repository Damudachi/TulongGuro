import { useState, useEffect, useCallback } from 'react';
import { Scale, Loader2, Check, AlertTriangle, RotateCcw, Info } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { GRADE_LEVELS, SUBJECTS } from '../../constants/school';

import { showConfirm } from '../../utils/dialog';
function cn(...cls) { return cls.filter(Boolean).join(' '); }

const COMPONENTS = [
  { key: 'WW', label: 'Written Work', hint: 'Quizzes, seatwork, written exercises' },
  { key: 'PT', label: 'Performance Task', hint: 'Essays, projects, demonstrations' },
  { key: 'QA', label: 'Quarterly Assessment', hint: 'The quarterly exam' },
];

/**
 * Grading policy, owned by the school admin acting as subject coordinator.
 *
 * Weights live here rather than with the teacher on purpose: if two teachers of
 * the same subject weight differently, their students' grades stop being
 * comparable and the analytics stop meaning anything. Teachers choose which
 * component each activity belongs to; this page decides what the components
 * are worth.
 */
export default function AdminGrading() {
  const admin = JSON.parse(localStorage.getItem('user') || '{}');
  const [data, setData] = useState(null);
  // No admin id means there is nothing to fetch, so this must not open on a
  // spinner that only the first commit would take away again (see load below).
  const [isLoading, setIsLoading] = useState(() => !!admin.id);
  const [error, setError] = useState('');
  const [savedNote, setSavedNote] = useState('');
  const [busy, setBusy] = useState(false);

  // Threshold form
  const [passingGrade, setPassingGrade] = useState(75);
  const [useTransmutation, setUseTransmutation] = useState(false);

  // Weight editor
  const [form, setForm] = useState({ gradeLevel: '', subject: '', WW: 30, PT: 50, QA: 20 });

  const load = useCallback(() => {
    if (!admin.id) return;
    apiFetch(`${API_URL}/api/admin/${admin.id}/grading`)
      .then(r => r.json())
      .then(d => {
        if (!d.success) return setError(d.error || 'Could not load grading settings.');
        setData(d);
        setPassingGrade(d.school.passingGrade);
        setUseTransmutation(d.school.useTransmutation);
      })
      .catch(() => setError('Network error. Please try again.'))
      .finally(() => setIsLoading(false));
  }, [admin.id]);

  useEffect(load, [load]);

  const flash = (msg) => { setSavedNote(msg); setTimeout(() => setSavedNote(''), 3000); };

  const saveSettings = async () => {
    setBusy(true); setError('');
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${admin.id}/grading/settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passingGrade, useTransmutation })
      });
      const d = await res.json();
      if (!d.success) return setError(d.error);
      flash('Thresholds saved.');
      load();
    } finally { setBusy(false); }
  };

  const total = Number(form.WW) + Number(form.PT) + Number(form.QA);

  const savePolicy = async () => {
    setBusy(true); setError('');
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${admin.id}/grading/policy`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const d = await res.json();
      if (!d.success) return setError(d.error);
      flash(`Weights saved for ${form.gradeLevel} ${form.subject}.`);
      setForm(f => ({ ...f, gradeLevel: '', subject: '' }));
      load();
    } finally { setBusy(false); }
  };

  const resetPolicy = async (policyId, label) => {
    if (!(await showConfirm(`Reset ${label} to the DepEd default weights?`, { confirmLabel: 'Reset weights' }))) return;
    setBusy(true); setError('');
    try {
      const res = await apiFetch(`${API_URL}/api/admin/${admin.id}/grading/policy/${policyId}`, { method: 'DELETE' });
      const d = await res.json().catch(() => null);
      // Checked, not assumed. This used to announce the reset whatever came
      // back, so a refused delete (404, or another school's policy id) left the
      // admin believing the subject was back on the DepEd weights while it was
      // still running their override — and every grade in it computed on the
      // weights they thought they had just removed.
      if (!res.ok || !d?.success) {
        return setError(d?.error || `Could not reset ${label}. Its weights are unchanged.`);
      }
      flash(`${label} is back on the DepEd default.`);
      load();
    } catch {
      setError('Network error. Nothing was changed.');
    } finally { setBusy(false); }
  };

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-navy-400 font-bold">
      <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading...
    </div>
  );

  // Ordered by the canonical grade list, then subject. Sorting the composed
  // label instead put "Grade 10" between "Grade 1" and "Grade 2" — neither
  // localeCompare nor a plain sort reads the number as a number.
  const allRows = [
    ...(data?.policies || []).map(p => ({ ...p, label: `${p.gradeLevel} — ${p.subject}` })),
    ...(data?.usingDefaults || []).map(p => ({ ...p, label: `${p.gradeLevel} — ${p.subject}` })),
  ].sort((a, b) =>
    GRADE_LEVELS.indexOf(a.gradeLevel) - GRADE_LEVELS.indexOf(b.gradeLevel) ||
    String(a.subject).localeCompare(String(b.subject))
  );

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24">
      <div className="flex items-center gap-3 mb-2">
        <span className="w-11 h-11 rounded-2xl bg-royal-500 tg-on-brand grid place-items-center shadow-pop shrink-0">
          <Scale className="w-5 h-5" />
        </span>
        <div>
          <h1 className="font-display text-2xl font-extrabold text-navy-700">Grading Policy</h1>
          <p className="text-sm text-navy-500">How activity scores become a quarter grade, school-wide.</p>
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-4 bg-red-50 border-2 border-red-200 text-red-700 px-4 py-3 rounded-2xl text-sm font-bold">
          {error}
        </div>
      )}
      {savedNote && (
        <div role="status" className="mt-4 bg-aqua-100 border-2 border-aqua-200 text-aqua-800 px-4 py-3 rounded-2xl text-sm font-bold flex items-center gap-2">
          <Check className="w-4 h-4" /> {savedNote}
        </div>
      )}

      {/* ── Thresholds ── */}
      <section className="mt-6 bg-white rounded-3xl border-2 border-slate-200 p-5">
        <h2 className="font-display text-lg font-extrabold text-navy-700 mb-1">Thresholds</h2>
        <p className="text-xs text-navy-400 mb-4">
          Applies to every class in the school, so "needs help" means the same thing everywhere.
        </p>

        <label className="block mb-5">
          <span className="tg-label">Passing grade</span>
          <input type="number" min="1" max="100" value={passingGrade}
            onChange={e => setPassingGrade(e.target.value)}
            className="tg-input max-w-[8rem]" />
          <span className="block text-xs text-navy-400 mt-1.5">
            Students below this appear in the teacher's support list. DepEd uses 75.
          </span>
        </label>

        <div className={cn('rounded-2xl border-2 p-4',
          useTransmutation ? 'border-sun-300 bg-sun-50' : 'border-slate-200 bg-slate-50')}>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={useTransmutation}
              onChange={e => setUseTransmutation(e.target.checked)}
              className="mt-1 w-5 h-5 rounded accent-royal-500 shrink-0" />
            <span className="min-w-0">
              <span className="block font-bold text-navy-700 text-sm">
                Apply the DepEd transmutation table to report-card grades
              </span>
              <span className="block text-xs text-navy-500 mt-1 leading-relaxed">
                The table has a floor of 60 and never lowers a grade, so switching this on
                raises every grade in the school. It applies to the <span className="font-bold">gradebook
                export</span> — the report-card record — and the exported file states which basis was used.
                Analytics, the support list and each student&apos;s own progress view always use the
                untransmuted grade, so a struggling learner stays visible either way.
              </span>
            </span>
          </label>
          {useTransmutation && !data?.school?.useTransmutation && (
            <p className="mt-3 text-xs font-bold text-sun-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
              This changes grades that students and parents may already have seen. Announce it before saving.
            </p>
          )}
        </div>

        <button onClick={saveSettings} disabled={busy} className="tg-btn-primary mt-5">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Save thresholds
        </button>
      </section>

      {/* ── Component weights ── */}
      <section className="mt-6 bg-white rounded-3xl border-2 border-slate-200 p-5">
        <h2 className="font-display text-lg font-extrabold text-navy-700 mb-1">Component weights</h2>
        <p className="text-xs text-navy-400 mb-4">
          Set per subject. Subjects you haven't customised run on the DepEd default for their
          subject group — they're still graded, just not overridden.
        </p>

        {allRows.length === 0 ? (
          <p className="text-sm text-navy-400 py-4">
            No curriculum set up yet, so there are no subjects to weight.
          </p>
        ) : (
          <div className="space-y-2 mb-6">
            {allRows.map(row => (
              <div key={row.id || row.label}
                className="flex items-center gap-3 p-3 rounded-2xl border-2 border-slate-200">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-navy-700 text-sm truncate">{row.label}</p>
                  <p className="text-xs text-navy-400">
                    {COMPONENTS.map(c => `${c.key} ${row.weights[c.key]}%`).join(' · ')}
                  </p>
                </div>
                {row.isDefault ? (
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-navy-400 bg-slate-100 px-2.5 py-1 rounded-full shrink-0">
                    DepEd default
                  </span>
                ) : (
                  <button onClick={() => resetPolicy(row.id, row.label)} disabled={busy}
                    className="text-xs font-bold text-navy-500 hover:text-red-600 flex items-center gap-1.5 shrink-0">
                    <RotateCcw className="w-3.5 h-3.5" /> Reset
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="border-t-2 border-slate-100 pt-5">
          <h3 className="font-bold text-navy-700 text-sm mb-3">Set weights for a subject</h3>
          <div className="grid sm:grid-cols-2 gap-3 mb-4">
            <label className="block">
              <span className="tg-label">Grade level</span>
              <select value={form.gradeLevel} onChange={e => setForm(f => ({ ...f, gradeLevel: e.target.value }))}
                className="tg-input">
                <option value="">Choose...</option>
                {GRADE_LEVELS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="tg-label">Subject</span>
              <select value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                className="tg-input">
                <option value="">Choose...</option>
                {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            {COMPONENTS.map(c => (
              <label key={c.key} className="block">
                <span className="tg-label">{c.label}</span>
                <input type="number" min="0" max="100" value={form[c.key]}
                  onChange={e => setForm(f => ({ ...f, [c.key]: e.target.value }))}
                  className="tg-input" />
                <span className="block text-[11px] text-navy-400 mt-1">{c.hint}</span>
              </label>
            ))}
          </div>

          <div className={cn('mt-4 flex items-center gap-2 text-sm font-bold',
            total === 100 ? 'text-aqua-700' : 'text-red-600')}>
            {total === 100
              ? <><Check className="w-4 h-4" /> Totals 100%</>
              : <><AlertTriangle className="w-4 h-4" /> Totals {total}% — must be exactly 100%</>}
          </div>

          <button onClick={savePolicy}
            disabled={busy || total !== 100 || !form.gradeLevel || !form.subject}
            className="tg-btn-primary mt-4">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Save weights
          </button>
        </div>
      </section>

      <p className="mt-6 text-xs text-navy-400 flex items-start gap-2 leading-relaxed">
        <Info className="w-4 h-4 shrink-0 mt-px" />
        Within a component, a student's score is total points earned over total points
        possible — so a 50-point activity counts half as much as a 100-point one, rather
        than equally. Teachers pick each activity's component when they create it.
      </p>
    </div>
  );
}
