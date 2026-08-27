import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, GraduationCap, Layers, BookOpen, ClipboardList, TrendingUp,
  Loader2, AlertTriangle, ArrowRight, Check, Sparkles, UserCircle, ChevronRight,
} from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { getStoredUser } from '../../utils/session';
import { DEFAULT_SCHOOL_YEAR } from '../../constants/school';
import { bandsFor, gradeTone } from '../../utils/grading';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

/** Morning/afternoon/evening, from the admin's own clock. */
function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** The name to greet by — the given name, not the whole registered string. */
function firstName(name) {
  return (name || '').trim().split(/\s+/)[0] || 'there';
}

/**
 * One number and what it counts, as a link to the page it came from.
 *
 * Every tile here is a route. A count with no way through to the thing it
 * counts is how the old landing screen ended up teaching admins that the way
 * to their sections was via the Teachers page.
 */
function Tile({ label, value, icon: Icon, to, tone }) {
  return (
    <Link to={to}
      className="bg-white border border-slate-200 rounded-2xl p-4 hover:border-brand-navy hover:shadow-sm transition-all group">
      <Icon className={cn('w-5 h-5 mb-2 transition-colors', tone || 'text-slate-300 group-hover:text-brand-navy')} />
      <p className="text-2xl font-extrabold text-brand-slate">{value}</p>
      <p className="text-xs text-slate-500 font-medium">{label}</p>
    </Link>
  );
}

function Card({ title, icon: Icon, action, children, className }) {
  return (
    <section className={cn('bg-white border border-slate-200 rounded-2xl p-5', className)}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-bold text-brand-slate flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-slate-400" />} {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * The admin console's landing screen.
 *
 * Opening the console used to mean opening the teacher list, because that was
 * the first route in the navigation and something had to be. It is a good page
 * and the wrong answer to "how is my school doing this morning" — it reports
 * one of the six things this console holds, sorted by when each account was
 * created, and says nothing at all about whether any teaching is happening.
 *
 * What an admin actually arrives with is three questions, in this order:
 * is the school set up, how are the learners doing, and what is waiting on me.
 * So: a checklist while the school is still being built, the performance
 * summary once there is work to summarise, and a list of gaps that names the
 * empty section and the teacher with nothing assigned.
 *
 * Three calls, drawn in two passes. The structural half (`/overview` and
 * `/classes`) is cheap and paints immediately; analytics walks every graded
 * submission in the school and is allowed to arrive late rather than holding
 * the whole page on a spinner.
 */
export default function AdminDashboard() {
  const admin = getStoredUser();

  const [core, setCore] = useState(null);       // overview + classes, merged
  const [perf, setPerf] = useState(null);       // analytics, or null
  // Tracked apart from `perf` so a school with no graded work yet is told that,
  // rather than being shown a spinner that never resolves into anything.
  const [perfState, setPerfState] = useState('loading');
  const [isLoading, setIsLoading] = useState(() => !!admin.id);

  const load = useCallback(() => {
    if (!admin.id) return;

    Promise.all([
      apiFetch(`${API_URL}/api/admin/${admin.id}/overview`).then(r => r.json()).catch(() => null),
      apiFetch(`${API_URL}/api/admin/${admin.id}/classes`).then(r => r.json()).catch(() => null),
    ])
      .then(([overview, shells]) => {
        if (!overview?.success && !shells?.success) return;
        setCore({
          school: overview?.school || null,
          rubricCount: overview?.rubricCount || 0,
          curriculums: shells?.curriculums || overview?.curriculums || [],
          // The shells route carries each section's adviser and roster size and
          // each shell's section, which is what the gaps below are read off.
          teachers: shells?.teachers || overview?.teachers || [],
          sections: shells?.sections || overview?.sections || [],
          classes: shells?.classes || [],
        });
      })
      .finally(() => setIsLoading(false));

    apiFetch(`${API_URL}/api/admin/${admin.id}/analytics`)
      .then(r => r.json())
      .then(d => {
        if (d?.success) { setPerf(d); setPerfState('ready'); }
        else setPerfState('error');
      })
      .catch(() => setPerfState('error'));
  }, [admin.id]);

  useEffect(() => { load(); }, [load]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />Loading your school...
      </div>
    );
  }

  const teachers = core?.teachers || [];
  const sections = core?.sections || [];
  const shells = core?.classes || [];
  const curriculums = core?.curriculums || [];
  const learnerCount = sections.reduce((n, s) => n + (s._count?.students || 0), 0);

  // ── Is the school built yet ──
  // Ordered the way it has to be done: a section needs an adviser, and a shell
  // needs a section to be taught to.
  const steps = [
    { key: 'teachers', done: teachers.length > 0, title: 'Add your teachers',
      body: 'Every section needs an adviser and every course shell needs a teacher, so this comes first.',
      to: '/admin/teachers', cta: 'Add a teacher' },
    { key: 'sections', done: sections.length > 0, title: 'Create the block sections',
      body: 'One homeroom group per section, with its class list. The learners get their accounts from it.',
      to: '/admin/sections', cta: 'Create a section' },
    { key: 'shells', done: shells.length > 0, title: 'Open the course shells',
      body: 'One subject taught to one section by one teacher. This is what appears on a teacher’s dashboard.',
      to: '/admin/classes', cta: 'Open a course shell' },
    { key: 'curriculum', done: curriculums.length > 0, title: 'Publish a curriculum',
      body: 'Lessons the whole school marks against, so a Grade 6 English score means the same in every section.',
      to: '/admin/curriculum', cta: 'Publish a curriculum' },
  ];
  const doneCount = steps.filter(s => s.done).length;
  const nextStep = steps.find(s => !s.done) || null;

  // ── What is waiting on the admin ──
  // Each one is a thing only this console can fix, and each names the row.
  const sectionShellCount = shells.reduce((acc, c) => {
    const id = c.section?.id;
    if (id) acc[id] = (acc[id] || 0) + 1;
    return acc;
  }, {});
  const teacherShellCount = shells.reduce((acc, c) => {
    const id = c.teacher?.id;
    if (id) acc[id] = (acc[id] || 0) + 1;
    return acc;
  }, {});

  const emptySections = sections.filter(s => (s._count?.students || 0) === 0);
  const sectionsWithoutShell = sections.filter(s => !sectionShellCount[s.id]);
  const teachersWithoutShell = teachers.filter(t => !teacherShellCount[t.id]);
  const shellsWithoutActivity = shells.filter(c => (c.activityCount || 0) === 0);

  const gaps = [
    emptySections.length > 0 && {
      key: 'emptySections',
      text: `${emptySections.length} section${emptySections.length === 1 ? ' has' : 's have'} no learners on the roster`,
      detail: emptySections.slice(0, 3).map(s => s.name).join(', '),
      to: '/admin/sections',
    },
    sectionsWithoutShell.length > 0 && {
      key: 'sectionsWithoutShell',
      text: `${sectionsWithoutShell.length} section${sectionsWithoutShell.length === 1 ? ' is' : 's are'} not being taught anything yet`,
      detail: sectionsWithoutShell.slice(0, 3).map(s => s.name).join(', '),
      to: '/admin/classes',
    },
    teachersWithoutShell.length > 0 && {
      key: 'teachersWithoutShell',
      text: `${teachersWithoutShell.length} teacher${teachersWithoutShell.length === 1 ? ' has' : 's have'} no course shell assigned`,
      detail: teachersWithoutShell.slice(0, 3).map(t => t.name).join(', '),
      to: '/admin/teachers',
    },
    shellsWithoutActivity.length > 0 && {
      key: 'shellsWithoutActivity',
      text: `${shellsWithoutActivity.length} course shell${shellsWithoutActivity.length === 1 ? ' has' : 's have'} no activity in them`,
      detail: shellsWithoutActivity.slice(0, 3).map(c => c.name).join(', '),
      to: '/admin/classes',
    },
  ].filter(Boolean);

  // ── Performance, once analytics has landed ──
  const summary = perf?.summary || null;
  const passingGrade = perf?.passingGrade ?? 75;
  const bandTotal = summary ? Object.values(summary.bands).reduce((a, b) => a + b, 0) || 1 : 1;
  const BANDS = summary
    ? [
        ...bandsFor(passingGrade).map((b, i, all) => ({
          key: b.key,
          label: i === 0 ? `${b.min}+` : b.key === 'failing' ? `Below ${passingGrade}` : `${b.min}–${all[i - 1].min - 1}`,
          cls: b.bar,
        })),
        { key: 'notGraded', label: 'Not graded', cls: 'bg-slate-200' },
      ]
    : [];
  const atRisk = (perf?.atRisk || []).slice(0, 5);
  const weakSubjects = (perf?.bySubject || []).filter(s => s.average !== null).slice(0, 4);

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto pb-24">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-brand-slate">{core?.school?.name || 'Your school'}</h1>
        <p className="text-slate-500 text-sm">
          {greeting()}, {firstName(admin.name)} — school year {DEFAULT_SCHOOL_YEAR}
        </p>
      </div>

      {/* ── Set-up, while there is any left ──
          Falls away entirely once the school is running, rather than becoming
          four permanent green ticks nobody reads. */}
      {nextStep && (
        <section className="bg-white border-2 border-brand-navy/20 rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-sm font-bold text-brand-slate flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-brand-navy" /> Getting the school running
            </h2>
            <span className="text-xs font-bold text-slate-400 shrink-0">{doneCount} of {steps.length} done</span>
          </div>
          <ol className="space-y-1.5">
            {steps.map((step, i) => {
              const isNext = step.key === nextStep.key;
              return (
                <li key={step.key} className={cn('flex gap-3 rounded-xl p-2.5', isNext && 'bg-blue-50/70')}>
                  <span className={cn('w-6 h-6 rounded-full grid place-items-center shrink-0 text-[11px] font-bold',
                    step.done ? 'bg-brand-green text-white' : isNext ? 'bg-brand-navy text-white' : 'bg-slate-200 text-slate-500')}>
                    {step.done ? <Check className="w-3.5 h-3.5" /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-sm font-bold', step.done ? 'text-slate-400 line-through decoration-slate-300' : 'text-brand-slate')}>
                      {step.title}
                    </p>
                    {/* Only the step in hand carries its explanation — four at
                        once is a wall, one is an instruction. */}
                    {isNext && (
                      <>
                        <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{step.body}</p>
                        <Link to={step.to}
                          className="inline-flex items-center gap-1 text-xs font-bold text-brand-navy hover:underline mt-1.5">
                          {step.cta} <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <Tile label="Teachers" value={teachers.length} icon={Users} to="/admin/teachers" />
        <Tile label="Sections" value={sections.length} icon={GraduationCap} to="/admin/sections" />
        <Tile label="Course Shells" value={shells.length} icon={Layers} to="/admin/classes" />
        <Tile label="Learners" value={learnerCount} icon={UserCircle} to="/admin/sections" />
        <Tile label="Curriculums" value={curriculums.length} icon={BookOpen} to="/admin/curriculum" />
        <Tile label="Rubrics" value={core?.rubricCount || 0} icon={ClipboardList} to="/admin/rubrics" />
      </div>

      {/* ── How the school is doing ── */}
      <Card
        title="How the school is doing"
        icon={TrendingUp}
        className="mb-6"
        action={
          <Link to="/admin/analytics" className="text-xs font-bold text-brand-navy hover:underline shrink-0 flex items-center gap-1">
            Open analytics <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        }
      >
        {perfState === 'loading' ? (
          <p className="text-sm text-slate-400 flex items-center gap-2 py-3">
            <Loader2 className="w-4 h-4 animate-spin" /> Working out the school average...
          </p>
        ) : perfState === 'error' || !summary ? (
          <p className="text-sm text-slate-400 py-3">The performance summary could not be read just now.</p>
        ) : summary.schoolAverage === null ? (
          <p className="text-sm text-slate-500 py-3">
            No graded work yet. Averages appear here as soon as teachers start releasing scores.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-x-8 gap-y-3 mb-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">School average</p>
                <p className={cn('text-4xl font-extrabold leading-none mt-1', gradeTone(summary.schoolAverage, passingGrade))}>
                  {summary.schoolAverage}
                </p>
                <p className="text-xs text-slate-400 mt-1">Passing is {passingGrade}</p>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Need support</p>
                <p className={cn('text-4xl font-extrabold leading-none mt-1',
                  summary.atRiskCount > 0 ? 'text-red-600' : 'text-brand-green')}>
                  {summary.atRiskCount}
                </p>
                <p className="text-xs text-slate-400 mt-1">of {summary.studentCount} learners</p>
              </div>
            </div>

            {/* Every learner once, under their own general average — the same
                population the two numbers above describe. */}
            <div className="flex h-2.5 rounded-full overflow-hidden mb-2.5">
              {BANDS.map(b => summary.bands[b.key] > 0 && (
                <div key={b.key} className={b.cls} style={{ width: `${(summary.bands[b.key] / bandTotal) * 100}%` }} />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {BANDS.map(b => (
                <span key={b.key} className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
                  <span className={cn('w-2 h-2 rounded-full', b.cls)} />
                  {b.label} · {summary.bands[b.key]}
                </span>
              ))}
            </div>
          </>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* ── Who needs help ──
            Names and the teacher to raise it with. No work, no feedback, no
            scores beyond the average — a coordinator needs to know who to ask
            about, not to read the child's paper themselves. */}
        <Card
          title="Learners needing support"
          icon={AlertTriangle}
          action={atRisk.length > 0 && (
            <Link to="/admin/analytics" className="text-xs font-bold text-brand-navy hover:underline shrink-0">See all</Link>
          )}
        >
          {perfState === 'loading' ? (
            <p className="text-sm text-slate-400 flex items-center gap-2 py-2"><Loader2 className="w-4 h-4 animate-spin" /> Checking...</p>
          ) : atRisk.length === 0 ? (
            <p className="text-sm text-slate-500 py-2">
              {summary?.schoolAverage === null || !summary
                ? 'Nothing graded yet, so nobody has been flagged.'
                : 'Nobody is below the passing line right now.'}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 -my-1">
              {atRisk.map((s, i) => (
                <li key={`${s.studentId}-${i}`} className="flex items-center gap-3 py-2">
                  <span className="w-8 h-8 rounded-full bg-red-50 text-red-600 grid place-items-center text-xs font-bold shrink-0">
                    {s.average}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-brand-slate truncate">{s.name}</p>
                    <p className="text-[11px] text-slate-400 truncate">
                      {s.className}{s.teacherName ? ` · ${s.teacherName}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ── What only this console can fix ── */}
        <Card title="Gaps to close" icon={ClipboardList}>
          {gaps.length === 0 ? (
            <p className="text-sm text-slate-500 py-2">
              Nothing outstanding — every section has a roster, a teacher and something being taught into it.
            </p>
          ) : (
            <ul className="space-y-2">
              {gaps.map(g => (
                <li key={g.key}>
                  <Link to={g.to}
                    className="flex items-start gap-2.5 rounded-xl border border-slate-200 p-2.5 hover:border-brand-navy hover:bg-blue-50/40 transition-colors group">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-brand-slate group-hover:text-brand-navy">{g.text}</span>
                      {g.detail && <span className="block text-[11px] text-slate-400 truncate">{g.detail}</span>}
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-300 shrink-0 mt-0.5 group-hover:text-brand-navy" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* ── Subjects, lowest first ──
          Where a coordinator's own time goes: a subject running three points
          under the rest of the school is a conversation with one department,
          not with forty children. */}
      {weakSubjects.length > 0 && (
        <Card
          title="Subjects, lowest first"
          icon={BookOpen}
          action={
            <Link to="/admin/analytics" className="text-xs font-bold text-brand-navy hover:underline shrink-0">Full breakdown</Link>
          }
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {weakSubjects.map(s => (
              <div key={s.subject} className="rounded-xl border border-slate-200 p-3">
                <p className="text-xs font-semibold text-slate-500 truncate" title={s.subject}>{s.subject}</p>
                <p className={cn('text-2xl font-extrabold mt-0.5', gradeTone(s.average, passingGrade))}>{s.average}</p>
                <p className="text-[11px] text-slate-400">
                  {s.atRiskCount > 0 ? `${s.atRiskCount} need support` : 'all above the line'}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
