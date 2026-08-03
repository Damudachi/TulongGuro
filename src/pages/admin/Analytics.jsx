import { useState, useEffect } from 'react';
import { TrendingUp, Loader2, AlertTriangle, Users, BookOpen } from 'lucide-react';
import { API_URL } from '../../config';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

const toneFor = (avg, passing) =>
  avg === null ? 'text-navy-300'
    : avg >= 90 ? 'text-aqua-700'
      : avg >= 80 ? 'text-royal-600'
        : avg >= passing ? 'text-sun-700' : 'text-red-600';

function Stat({ label, value, hint, tone = 'text-navy-700' }) {
  return (
    <div className="bg-white rounded-3xl border-2 border-slate-200 p-4">
      <p className="text-[10px] font-extrabold uppercase tracking-wider text-navy-400">{label}</p>
      <p className={cn('font-display text-3xl font-extrabold mt-1', tone)}>{value}</p>
      {hint && <p className="text-xs text-navy-400 mt-0.5">{hint}</p>}
    </div>
  );
}

/**
 * School-wide analytics for the admin acting as subject coordinator.
 *
 * A summary by design: which subjects and sections are struggling, and who
 * needs support. Student work, AI feedback and rubric detail stay with the
 * teacher — a coordinator needs the pattern, not the papers.
 */
export default function AdminAnalytics() {
  const admin = JSON.parse(localStorage.getItem('user') || '{}');
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!admin.id) return setIsLoading(false);
    fetch(`${API_URL}/api/admin/${admin.id}/analytics`)
      .then(r => r.json())
      .then(d => d.success ? setData(d) : setError(d.error || 'Could not load analytics.'))
      .catch(() => setError('Network error.'))
      .finally(() => setIsLoading(false));
  }, [admin.id]);

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-navy-400 font-bold">
      <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading...
    </div>
  );
  if (error) return <div className="p-8 text-center text-red-600 font-bold">{error}</div>;
  if (!data) return null;

  const { summary, bySubject, classes, atRisk, passingGrade } = data;
  const bandTotal = Object.values(summary.bands).reduce((a, b) => a + b, 0) || 1;
  const BANDS = [
    { key: 'excellent', label: '90+', cls: 'bg-aqua-500' },
    { key: 'good', label: '80–89', cls: 'bg-royal-500' },
    { key: 'fair', label: `${passingGrade}–79`, cls: 'bg-sun-400' },
    { key: 'needsWork', label: `Below ${passingGrade}`, cls: 'bg-red-500' },
    { key: 'notGraded', label: 'Not graded', cls: 'bg-cream-300' },
  ];

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto pb-24">
      <div className="flex items-center gap-3 mb-5">
        <span className="w-11 h-11 rounded-2xl bg-royal-500 tg-on-brand grid place-items-center shadow-pop shrink-0">
          <TrendingUp className="w-5 h-5" />
        </span>
        <div>
          <h1 className="font-display text-2xl font-extrabold text-navy-700">School Analytics</h1>
          <p className="text-sm text-navy-500">Summary across every section. Student work stays with the teacher.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="School average" value={summary.schoolAverage ?? '—'}
          tone={toneFor(summary.schoolAverage, passingGrade)} hint={`Passing is ${passingGrade}`} />
        <Stat label="Students" value={summary.studentCount} />
        <Stat label="Classes" value={summary.classCount} />
        <Stat label="Need support" value={summary.atRiskCount}
          tone={summary.atRiskCount > 0 ? 'text-red-600' : 'text-aqua-700'}
          hint={`Below ${passingGrade}`} />
      </div>

      {/* ── Spread ── */}
      <section className="bg-white rounded-3xl border-2 border-slate-200 p-5 mb-6">
        <h2 className="font-display text-lg font-extrabold text-navy-700 mb-3">How the school is spread</h2>
        <div className="flex h-3 rounded-full overflow-hidden mb-3">
          {BANDS.map(b => summary.bands[b.key] > 0 && (
            <div key={b.key} className={b.cls}
              style={{ width: `${(summary.bands[b.key] / bandTotal) * 100}%` }} />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {BANDS.map(b => (
            <span key={b.key} className="flex items-center gap-1.5 text-xs font-bold text-navy-500">
              <span className={cn('w-2.5 h-2.5 rounded-full', b.cls)} />
              {b.label} · {summary.bands[b.key]}
            </span>
          ))}
        </div>
      </section>

      {/* ── By subject ── */}
      <section className="bg-white rounded-3xl border-2 border-slate-200 p-5 mb-6">
        <h2 className="font-display text-lg font-extrabold text-navy-700 mb-1 flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-navy-400" /> By subject
        </h2>
        <p className="text-xs text-navy-400 mb-4">Lowest first — where coordination is most needed.</p>
        {bySubject.length === 0 ? (
          <p className="text-sm text-navy-400 py-2">No graded work yet.</p>
        ) : (
          <div className="space-y-2">
            {bySubject.map(s => (
              <div key={s.subject} className="flex items-center gap-3 p-3 rounded-2xl border-2 border-slate-200">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-navy-700 text-sm truncate">{s.subject}</p>
                  <p className="text-xs text-navy-400">
                    {s.studentCount} graded{s.atRiskCount > 0 && ` · ${s.atRiskCount} need support`}
                  </p>
                </div>
                <span className={cn('font-display text-2xl font-extrabold shrink-0', toneFor(s.average, passingGrade))}>
                  {s.average ?? '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── By class ── */}
      <section className="bg-white rounded-3xl border-2 border-slate-200 p-5 mb-6">
        <h2 className="font-display text-lg font-extrabold text-navy-700 mb-1 flex items-center gap-2">
          <Users className="w-4 h-4 text-navy-400" /> By class
        </h2>
        <p className="text-xs text-navy-400 mb-4">Each class with its teacher and the weights in force.</p>
        <div className="space-y-2">
          {classes.map(c => (
            <div key={c.classId} className="flex items-center gap-3 p-3 rounded-2xl border-2 border-slate-200">
              <div className="min-w-0 flex-1">
                <p className="font-bold text-navy-700 text-sm truncate">{c.className}</p>
                <p className="text-xs text-navy-400 truncate">
                  {c.teacherName || 'No teacher'} · {c.sectionName} · {c.gradedStudents}/{c.studentCount} graded
                </p>
                <p className="text-[11px] text-navy-300 mt-0.5">
                  WW {c.weights.WW}% · PT {c.weights.PT}% · QA {c.weights.QA}%
                </p>
              </div>
              {c.atRiskCount > 0 && (
                <span className="text-[10px] font-extrabold text-red-700 bg-red-50 px-2 py-1 rounded-full shrink-0">
                  {c.atRiskCount} at risk
                </span>
              )}
              <span className={cn('font-display text-2xl font-extrabold shrink-0 w-12 text-right', toneFor(c.classAverage, passingGrade))}>
                {c.classAverage ?? '—'}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Who needs support ── */}
      <section className="bg-white rounded-3xl border-2 border-slate-200 p-5">
        <h2 className="font-display text-lg font-extrabold text-navy-700 mb-1 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-sun-600" /> Students needing support
        </h2>
        <p className="text-xs text-navy-400 mb-4">
          Averaging below {passingGrade}. Talk to the teacher for the detail — their work isn't shown here.
        </p>
        {atRisk.length === 0 ? (
          <p className="text-sm font-bold text-aqua-700 py-2">Everyone is at or above {passingGrade}.</p>
        ) : (
          <div className="space-y-2">
            {atRisk.map(s => (
              <div key={`${s.studentId}-${s.className}`}
                className="flex items-center gap-3 p-3 rounded-2xl border-2 border-slate-200">
                <span className="w-8 h-8 rounded-xl bg-red-50 text-red-600 grid place-items-center font-extrabold text-xs shrink-0">
                  {(s.name || '?').charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-navy-700 text-sm truncate">{s.name}</p>
                  <p className="text-xs text-navy-400 truncate">{s.className} · {s.teacherName}</p>
                </div>
                <span className="font-display text-xl font-extrabold text-red-600 shrink-0">{s.average}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
