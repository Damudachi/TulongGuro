import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, TrendingUp, TrendingDown, Loader2, ChevronDown, Users,
} from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { bandsFor, gradeTone } from '../../utils/grading';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

const COMPONENT_LABEL = {
  WW: 'Written Work',
  PT: 'Performance Task',
  QA: 'Quarterly Assessment',
};

/**
 * One course shell's analytics, and each learner inside it.
 *
 * The school-wide page used to end in a flat "Student performance" list: every
 * learner in the school, one row per class they take, filtered with a dropdown.
 * It read as a leaderboard and it was the wrong unit — a coordinator does not
 * intervene on "the school", they intervene on a class, with the teacher who
 * teaches it. A student's average also means nothing until you know which
 * subject and whose weights produced it, and that list put five rows for the
 * same child next to each other with only a small grey subtitle to tell them
 * apart.
 *
 * So the entry point is now the course shell, and the roster lives inside it.
 * Each row opens onto that learner's own numbers — where a coordinator either
 * stops, or picks up the phone to the teacher named at the top of the page.
 *
 * Reads the same /analytics payload the school page reads and narrows it to one
 * classId rather than calling a per-shell endpoint. The response already
 * carries every student row keyed by class, so a second endpoint would be a
 * second way to compute the same numbers — and the two would drift.
 */
export default function AdminShellAnalytics() {
  const { classId } = useParams();
  const admin = JSON.parse(localStorage.getItem('user') || '{}');
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(() => !!admin.id);
  const [error, setError] = useState('');
  // Several learners can be open at once: comparing two struggling students in
  // the same class is the reason to open either of them.
  const [openIds, setOpenIds] = useState(() => new Set());

  useEffect(() => {
    if (!admin.id) return;
    apiFetch(`${API_URL}/api/admin/${admin.id}/analytics`)
      .then(r => r.json())
      .then(d => d.success ? setData(d) : setError(d.error || 'Could not load analytics.'))
      .catch(() => setError('Network error.'))
      .finally(() => setIsLoading(false));
  }, [admin.id]);

  const shell = useMemo(
    () => (data?.classes || []).find(c => c.classId === classId) || null,
    [data, classId]
  );
  // Lowest first — the order a coordinator reads in, and the same order the
  // school page used.
  const roster = useMemo(
    () => (data?.students || []).filter(s => s.classId === classId),
    [data, classId]
  );

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-navy-400 font-bold">
      <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading...
    </div>
  );
  if (error) return <div className="p-8 text-center text-red-600 font-bold">{error}</div>;
  if (!data) return null;

  const { passingGrade } = data;
  const toneFor = (avg) => gradeTone(avg, passingGrade);

  if (!shell) return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <Link to="/admin/analytics" className="text-sm font-bold text-royal-600 hover:underline flex items-center gap-1.5 mb-6">
        <ArrowLeft className="w-4 h-4" /> Back to analytics
      </Link>
      <p className="text-navy-500 font-bold">That course shell is not in your school, or it has been removed.</p>
    </div>
  );

  // The spread for this shell only, off the band each student row already
  // carries — the same ladder the school page draws, so a class bar and the
  // school bar above it mean the same thing.
  const ladder = bandsFor(passingGrade);
  const BANDS = [
    ...ladder.map((b, i) => ({
      key: b.key,
      label: i === 0 ? `${b.min}+` : b.key === 'failing' ? `Below ${passingGrade}` : `${b.min}–${ladder[i - 1].min - 1}`,
      cls: b.bar,
    })),
    { key: 'notGraded', label: 'Not graded', cls: 'bg-cream-300' },
  ];
  const bandCounts = BANDS.reduce((acc, b) => ({ ...acc, [b.key]: 0 }), {});
  for (const s of roster) bandCounts[s.band] = (bandCounts[s.band] || 0) + 1;
  const bandTotal = roster.length || 1;

  const toggle = (id) => setOpenIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto pb-24">
      <Link to="/admin/analytics" className="text-sm font-bold text-royal-600 hover:underline flex items-center gap-1.5 mb-5">
        <ArrowLeft className="w-4 h-4" /> Back to analytics
      </Link>

      {/* ── Which shell, whose, and under what weights ── */}
      <section className="bg-white rounded-3xl border-2 border-slate-200 p-5 mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-extrabold text-navy-700">{shell.className}</h1>
            <p className="text-sm text-navy-500 mt-0.5">
              {shell.teacherName || 'No teacher'} · {shell.sectionName} · {shell.subject} · {shell.gradeLevel}
            </p>
            <p className="text-[11px] text-navy-400 mt-1">
              WW {shell.weights.WW}% · PT {shell.weights.PT}% · QA {shell.weights.QA}% · passing is {passingGrade}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-navy-400">Course shell average</p>
            <p className={cn('font-display text-4xl font-extrabold leading-none mt-1', toneFor(shell.classAverage))}>
              {shell.classAverage ?? '—'}
            </p>
            <p className="text-xs text-navy-400 mt-1">
              {shell.gradedStudents}/{shell.studentCount} graded
              {shell.atRiskCount > 0 && ` · ${shell.atRiskCount} at risk`}
            </p>
          </div>
        </div>

        {roster.length > 0 && (
          <>
            <div className="flex h-2.5 rounded-full overflow-hidden mt-5 mb-2.5">
              {BANDS.map(b => bandCounts[b.key] > 0 && (
                <div key={b.key} className={b.cls} style={{ width: `${(bandCounts[b.key] / bandTotal) * 100}%` }} />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {BANDS.map(b => (
                <span key={b.key} className="flex items-center gap-1.5 text-[11px] font-bold text-navy-500">
                  <span className={cn('w-2 h-2 rounded-full', b.cls)} />
                  {b.label} · {bandCounts[b.key] || 0}
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      {/* ── The roster, each row opening onto that learner ── */}
      <section className="bg-white rounded-3xl border-2 border-slate-200 p-5">
        <h2 className="font-display text-lg font-extrabold text-navy-700 mb-1 flex items-center gap-2">
          <Users className="w-4 h-4 text-navy-400" /> Learners in this course shell
        </h2>
        <p className="text-xs text-navy-400 mb-4">
          Lowest first. Open a learner for their component standing — for their actual work, ask{' '}
          {shell.teacherName || 'their teacher'}.
        </p>

        {roster.length === 0 ? (
          <p className="text-sm text-navy-400 py-2">Nobody is enrolled in this course shell yet.</p>
        ) : (
          <div className="space-y-2">
            {roster.map(s => {
              const isOpen = openIds.has(s.studentId);
              return (
                <div key={s.studentId}
                  className={cn('rounded-2xl border-2 overflow-hidden',
                    s.needsSupport ? 'border-red-200 bg-red-50/50' : 'border-slate-200')}>
                  <button type="button"
                    onClick={() => toggle(s.studentId)}
                    aria-expanded={isOpen}
                    aria-controls={`learner-${s.studentId}`}
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-slate-50/60 transition-colors">
                    <ChevronDown className={cn('w-4 h-4 shrink-0 text-navy-300 transition-transform', isOpen && 'rotate-180')} />
                    <span className={cn('w-8 h-8 rounded-xl grid place-items-center font-extrabold text-xs shrink-0',
                      s.needsSupport ? 'bg-red-100 text-red-600' : 'bg-royal-100 text-royal-700')}>
                      {(s.name || '?').charAt(0)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold text-navy-700 text-sm truncate">{s.name}</span>
                      <span className="block text-[11px] text-navy-400">
                        {s.gradedCount === 0 ? 'No graded work yet' : `${s.gradedCount} graded`}
                      </span>
                    </span>
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
                    <span className={cn('font-display text-xl font-extrabold shrink-0 w-10 text-right', toneFor(s.average))}>
                      {s.average ?? '—'}
                    </span>
                  </button>

                  {isOpen && (
                    <div id={`learner-${s.studentId}`} className="px-4 pb-4 pt-1 border-t-2 border-slate-100 bg-white/60">
                      <p className="text-[10px] font-extrabold uppercase tracking-wider text-navy-400 mt-3 mb-2">
                        Where the marks are
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        {['WW', 'PT', 'QA'].map(key => {
                          const c = s.components?.[key] || { percent: null, count: 0 };
                          return (
                            <div key={key} className="rounded-xl border-2 border-slate-200 p-2.5">
                              <p className="text-[10px] font-extrabold uppercase tracking-wider text-navy-400 truncate"
                                title={COMPONENT_LABEL[key]}>
                                {key} · {shell.weights[key]}%
                              </p>
                              <p className={cn('font-display text-2xl font-extrabold leading-none mt-1', toneFor(c.percent))}>
                                {c.percent ?? '—'}
                              </p>
                              <p className="text-[11px] text-navy-400 mt-1">
                                {c.count === 0 ? 'nothing yet' : `${c.count} activit${c.count === 1 ? 'y' : 'ies'}`}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-[11px] text-navy-400 mt-3 leading-relaxed">
                        {s.needsSupport
                          ? `Below the passing line of ${passingGrade} on enough graded work to act on. Raise it with ${shell.teacherName || 'their teacher'}.`
                          : s.average === null
                            ? 'Nothing graded in this course shell yet, so there is no average to read.'
                            : `Averages only — ${shell.teacherName || 'their teacher'} holds the work, the feedback and the rubric detail.`}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
