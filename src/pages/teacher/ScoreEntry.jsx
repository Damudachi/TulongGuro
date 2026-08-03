import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, PenLine, Loader2, Check, AlertTriangle, Info } from 'lucide-react';
import { API_URL } from '../../config';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

/**
 * Score sheet for a MANUAL_SCORE activity — work that was marked in the room,
 * so there is no photo to review and nothing for the AI to read.
 *
 * Deliberately a single flat list with one box per student and one save: a
 * teacher entering recitation marks for forty students should not have to open
 * forty screens.
 */
export default function ScoreEntry() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const activityId = params.get('activityId');
  const classId = params.get('classId');

  const [activity, setActivity] = useState(null);
  const [students, setStudents] = useState([]);
  const [scores, setScores] = useState({});      // studentId -> raw points, as typed
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const load = useCallback(() => {
    if (!classId || !activityId) { setIsLoading(false); return; }
    Promise.all([
      fetch(`${API_URL}/api/classes/${classId}`).then(r => r.json()),
      fetch(`${API_URL}/api/activities/${activityId}/submissions`).then(r => r.json()),
    ]).then(([cls, subs]) => {
      if (cls.success) {
        setStudents(cls.classData?.section?.students || []);
        setActivity(cls.classData?.activities?.find(a => a.id === activityId) || null);
      }
      if (subs.success) {
        // Seed the boxes from whatever is already recorded, converting the
        // stored percentage back to the raw points the teacher originally typed.
        const max = cls.classData?.activities?.find(a => a.id === activityId)?.points || 100;
        const seeded = {};
        for (const s of subs.submissions || []) {
          const pct = s.hitlScore ?? s.aiScore;
          if (typeof pct === 'number') {
            seeded[s.studentId] = String(Math.round((pct / 100) * max));
          }
        }
        setScores(seeded);
      }
    }).catch(() => setError('Could not load the class list.'))
      .finally(() => setIsLoading(false));
  }, [classId, activityId]);

  useEffect(load, [load]);

  const maxPoints = activity?.points || 100;
  const invalid = Object.entries(scores).filter(([, v]) => {
    if (v === '') return false;
    const n = Number(v);
    return Number.isNaN(n) || n < 0 || n > maxPoints;
  });
  const enteredCount = Object.values(scores).filter(v => v !== '' && v !== undefined).length;

  const save = async () => {
    setIsSaving(true); setError(''); setSaved('');
    try {
      const payload = students.map(s => ({
        studentId: s.id,
        points: scores[s.id] === undefined ? '' : scores[s.id],
      }));
      const res = await fetch(`${API_URL}/api/teacher/activities/${activityId}/scores`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scores: payload }),
      });
      const d = await res.json();
      if (!d.success) return setError(d.error || 'Could not save scores.');
      setSaved(`Saved ${enteredCount} score${enteredCount === 1 ? '' : 's'}.`);
      setTimeout(() => setSaved(''), 3000);
      load();
    } catch {
      setError('Network error. Your scores were not saved.');
    } finally { setIsSaving(false); }
  };

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-navy-400 font-bold">
      <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading...
    </div>
  );

  if (!activity) return (
    <div className="p-8 text-center text-navy-500">Activity not found.</div>
  );

  if (activity.submissionMode !== 'MANUAL_SCORE') return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center text-sm text-navy-500 hover:text-navy-700 mb-4">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back
      </button>
      <div className="bg-sun-50 border-2 border-sun-200 rounded-2xl p-5">
        <p className="font-bold text-navy-700 mb-1">This activity collects student work.</p>
        <p className="text-sm text-navy-600">
          Scores come from reviewing each submission, so it opens in Scan &amp; Grade instead.
        </p>
      </div>
    </div>
  );

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-32">
      <button onClick={() => navigate(-1)} className="flex items-center text-sm text-navy-500 hover:text-navy-700 mb-4">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to class
      </button>

      <div className="flex items-center gap-3 mb-5">
        <span className="w-11 h-11 rounded-2xl bg-lilac-500 text-white grid place-items-center shadow-pop shrink-0">
          <PenLine className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-extrabold text-navy-700 truncate">{activity.title}</h1>
          <p className="text-sm text-navy-500">
            Scores only · {maxPoints} points{activity.component ? ` · ${activity.component}` : ''}
          </p>
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-4 bg-red-50 border-2 border-red-200 text-red-700 px-4 py-3 rounded-2xl text-sm font-bold">
          {error}
        </div>
      )}
      {saved && (
        <div role="status" className="mb-4 bg-aqua-100 border-2 border-aqua-200 text-aqua-800 px-4 py-3 rounded-2xl text-sm font-bold flex items-center gap-2">
          <Check className="w-4 h-4" /> {saved}
        </div>
      )}

      <div className="bg-white rounded-3xl border-2 border-slate-200 overflow-hidden">
        {students.length === 0 ? (
          <p className="p-6 text-sm text-navy-400 text-center">No students in this section yet.</p>
        ) : students.map((s, i) => {
          const val = scores[s.id] ?? '';
          const n = Number(val);
          const bad = val !== '' && (Number.isNaN(n) || n < 0 || n > maxPoints);
          return (
            <div key={s.id}
              className={cn('flex items-center gap-3 px-4 py-3',
                i > 0 && 'border-t border-slate-100', bad && 'bg-red-50')}>
              <span className="w-8 h-8 rounded-xl bg-royal-100 text-royal-700 grid place-items-center font-extrabold text-xs shrink-0">
                {(s.name || '?').charAt(0)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-navy-700 text-sm truncate">{s.name}</p>
                <p className="text-xs text-navy-400 truncate">{s.username}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <input
                  type="number" min="0" max={maxPoints} inputMode="numeric"
                  value={val}
                  onChange={e => setScores(prev => ({ ...prev, [s.id]: e.target.value }))}
                  aria-label={`Score for ${s.name}`}
                  className={cn('w-20 px-3 py-2 rounded-xl border-2 text-right font-bold outline-none transition-colors',
                    bad ? 'border-red-300 bg-white text-red-700' : 'border-slate-200 focus:border-royal-400')}
                />
                <span className="text-sm font-bold text-navy-400">/ {maxPoints}</span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-navy-400 flex items-start gap-2 leading-relaxed">
        <Info className="w-4 h-4 shrink-0 mt-px" />
        Leave a box empty for a student who hasn't been marked yet — that's different from
        a zero, and an empty box won't drag their average down.
      </p>

      {/* Sticky so the save button is reachable partway down a long class list. */}
      <div className="fixed bottom-0 left-0 right-0 md:left-64 bg-white/95 backdrop-blur border-t-2 border-slate-200 p-4 z-30">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <p className="text-sm font-bold text-navy-600 flex-1 min-w-0">
            {invalid.length > 0 ? (
              <span className="text-red-600 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {invalid.length} score{invalid.length === 1 ? '' : 's'} outside 0–{maxPoints}
              </span>
            ) : (
              <>{enteredCount} of {students.length} marked</>
            )}
          </p>
          <button onClick={save} disabled={isSaving || invalid.length > 0 || students.length === 0}
            className="tg-btn-primary shrink-0">
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Save scores
          </button>
        </div>
      </div>
    </div>
  );
}
