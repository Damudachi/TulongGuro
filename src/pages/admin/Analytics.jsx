import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, Loader2, Users, BookOpen, ChevronRight } from 'lucide-react';
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
 * A summary by design: which subjects and course shells are struggling. Student
 * work, AI feedback and rubric detail stay with the teacher — a coordinator
 * needs the pattern, not the papers.
 *
 * This page used to end in a flat roster of every learner in the school, one
 * row per class they take, narrowed with a search box and two filters. It read
 * as a leaderboard and it was the wrong unit: a coordinator does not intervene
 * on "the school", they intervene on a class, with the teacher who teaches it.
 * The same child also appeared once per subject with only a grey subtitle to
 * tell the rows apart. Learners now live one level down, inside the course
 * shell whose weights produced the number — see ShellAnalytics.jsx.
 */
export default function AdminAnalytics() {
  const admin = JSON.parse(localStorage.getItem('user') || '{}');
  const [data, setData] = useState(null);
  // No admin id means there is nothing to fetch, so this must not open on a
  // spinner that only the first commit would take away again (see load below).
  const [isLoading, setIsLoading] = useState(() => !!admin.id);
  const [error, setError] = useState('');

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

  const { summary, bySubject, classes, passingGrade } = data;
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

      {/* No school average. One number averaged over every subject in the
          school moves for reasons nobody can name — a section split in two, a
          quarter of Filipino not yet graded — and it invited the reading that
          the school itself has a grade. An average is only actionable once it
          has a teacher and a set of weights attached to it, which is what the
          per-course-shell figures below carry. */}
      <div className="grid grid-cols-3 gap-3 mb-6">
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
        <p className="text-xs text-navy-400 mb-4">
          Each course shell with its teacher and the weights in force. Open one for its learners.
        </p>
        <div className="space-y-2">
          {/* The whole row is the target rather than a small "view" link at the
              end of it: the row already reads as one thing, and that thing is
              what you want to open. */}
          {classes.map(c => (
            <Link key={c.classId} to={`/admin/analytics/shell/${c.classId}`}
              className="flex items-center gap-3 p-3 rounded-2xl border-2 border-slate-200 hover:border-royal-400 hover:bg-royal-50/40 transition-colors group">
              <div className="min-w-0 flex-1">
                <p className="font-bold text-navy-700 text-sm truncate group-hover:text-royal-700">{c.className}</p>
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
              <ChevronRight className="w-4 h-4 text-navy-300 shrink-0 group-hover:text-royal-600" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
