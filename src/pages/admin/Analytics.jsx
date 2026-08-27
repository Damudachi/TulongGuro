import { useState, useEffect, useMemo } from 'react';
import { TrendingUp, TrendingDown, Loader2, AlertTriangle, Users, BookOpen } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { bandsFor, gradeTone } from '../../utils/grading';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

// Tone comes from the shared ladder in utils/grading.
const toneFor = (avg, passing) => gradeTone(avg, passing);

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
  // No admin id means there is nothing to fetch, so this must not open on a
  // spinner that only the first commit would take away again (see load below).
  const [isLoading, setIsLoading] = useState(() => !!admin.id);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [onlyRisk, setOnlyRisk] = useState(false);

  // Hooks must run on every render, so this sits above the loading/error
  // returns and tolerates `data` still being null.
  const visibleStudents = useMemo(() => {
    const rows = data?.students || [];
    const q = query.trim().toLowerCase();
    return rows.filter(s =>
      (!classFilter || s.classId === classFilter) &&
      (!onlyRisk || s.needsSupport) &&
      (!q || s.name?.toLowerCase().includes(q) || s.teacherName?.toLowerCase().includes(q))
    );
  }, [data, query, classFilter, onlyRisk]);

  useEffect(() => {
    if (!admin.id) return;
    apiFetch(`${API_URL}/api/admin/${admin.id}/analytics`)
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

  const { summary, bySubject, classes, students, passingGrade } = data;
  const bandTotal = Object.values(summary.bands).reduce((a, b) => a + b, 0) || 1;
  // Built from the school's own passing grade rather than a fixed 90/80/75
  // ladder, which mislabelled its bands for any school passing above 80.
  // Ranges are derived from the neighbouring rung so the labels stay truthful.
  const ladder = bandsFor(passingGrade);
  const BANDS = [
    ...ladder.map((b, i) => ({
      key: b.key,
      label: i === 0
        ? `${b.min}+`
        : b.key === 'failing'
          ? `Below ${passingGrade}`
          : `${b.min}–${ladder[i - 1].min - 1}`,
      cls: b.bar,
    })),
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
        <Stat label="Course Shells" value={summary.classCount} />
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

      {/* ── By course shell ── */}
      <section className="bg-white rounded-3xl border-2 border-slate-200 p-5 mb-6">
        <h2 className="font-display text-lg font-extrabold text-navy-700 mb-1 flex items-center gap-2">
          <Users className="w-4 h-4 text-navy-400" /> By course shell
        </h2>
        <p className="text-xs text-navy-400 mb-4">Each course shell with its teacher and the weights in force.</p>
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

      {/* ── Every student ──
          A coordinator can only intervene by naming a student and the teacher
          to raise it with, so this is the whole roster rather than only the
          students already below the line — a strong student sliding three
          activities in a row is the one worth catching early. */}
      <section className="bg-white rounded-3xl border-2 border-slate-200 p-5">
        <h2 className="font-display text-lg font-extrabold text-navy-700 mb-1 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-sun-600" /> Student performance
        </h2>
        <p className="text-xs text-navy-400 mb-4">
          Lowest first. Averages and trends only — for a student's actual work, ask their teacher.
        </p>

        <div className="flex flex-wrap gap-2 mb-4">
          <input
            type="search" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search student or teacher..."
            aria-label="Search students"
            className="tg-input flex-1 min-w-[12rem] py-2 text-sm"
          />
          <select value={classFilter} onChange={e => setClassFilter(e.target.value)}
            aria-label="Filter by course shell" className="tg-input w-auto py-2 text-sm">
            <option value="">All course shells</option>
            {classes.map(c => <option key={c.classId} value={c.classId}>{c.className}</option>)}
          </select>
          <button type="button" onClick={() => setOnlyRisk(v => !v)}
            aria-pressed={onlyRisk}
            className={cn('px-3.5 py-2 rounded-2xl text-sm font-bold border-2 transition-colors shrink-0',
              onlyRisk ? 'border-red-500 bg-red-500 text-white' : 'border-slate-200 text-navy-500 hover:border-red-300')}>
            Needs support
          </button>
        </div>

        {visibleStudents.length === 0 ? (
          <p className="text-sm text-navy-400 py-2">No students match that filter.</p>
        ) : (
          <div className="space-y-2">
            {visibleStudents.map(s => (
              <div key={`${s.studentId}-${s.classId}`}
                className={cn('flex items-center gap-3 p-3 rounded-2xl border-2',
                  s.needsSupport ? 'border-red-200 bg-red-50/50' : 'border-slate-200')}>
                <span className={cn('w-8 h-8 rounded-xl grid place-items-center font-extrabold text-xs shrink-0',
                  s.needsSupport ? 'bg-red-100 text-red-600' : 'bg-royal-100 text-royal-700')}>
                  {(s.name || '?').charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-navy-700 text-sm truncate">{s.name}</p>
                  <p className="text-xs text-navy-400 truncate">
                    {s.className} · {s.teacherName || 'No teacher'}
                  </p>
                  <p className="text-[11px] text-navy-300">
                    {s.gradedCount === 0 ? 'No graded work yet' : `${s.gradedCount} graded`}
                  </p>
                </div>
                {/* A slide is worth flagging even while the average still looks fine. */}
                {s.trend === 'down' && (
                  <span title="Last three scores went down"
                    className="flex items-center gap-1 text-[10px] font-extrabold text-red-700 bg-red-100 px-2 py-1 rounded-full shrink-0">
                    <TrendingDown className="w-3 h-3" /> Slipping
                  </span>
                )}
                {s.trend === 'up' && (
                  <span title="Last three scores went up"
                    className="flex items-center gap-1 text-[10px] font-extrabold text-aqua-800 bg-aqua-100 px-2 py-1 rounded-full shrink-0">
                    <TrendingUp className="w-3 h-3" /> Improving
                  </span>
                )}
                <span className={cn('font-display text-xl font-extrabold shrink-0 w-10 text-right',
                  toneFor(s.average, passingGrade))}>
                  {s.average ?? '—'}
                </span>
              </div>
            ))}
          </div>
        )}

        {students.length > visibleStudents.length && (
          <p className="text-xs text-navy-400 mt-3">
            Showing {visibleStudents.length} of {students.length} rows. A student appears once per class.
          </p>
        )}
      </section>
    </div>
  );
}
