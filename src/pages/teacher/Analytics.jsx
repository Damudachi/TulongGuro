import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  BarChart2, Users, Loader2, ArrowLeft, FileText, ChevronRight, Sparkles,
  AlertTriangle, Trophy, Target, TrendingUp, TrendingDown, Minus, ClipboardList,
  Scale,
} from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { getStoredUser } from '../../utils/session';
import { bandsFor, bandFor, toPoints, pct, DEFAULT_PASSING_GRADE } from '../../utils/grading';
import SkillProgressChart from '../../components/SkillProgressChart';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

/** The three DepEd grading components, spelled out for the weights panel. */
const COMPONENT_LABELS = {
  WW: 'Written Work',
  PT: 'Performance Task',
  QA: 'Quarterly Assessment',
};

const SKILL_LABELS = {
  vocabulary: 'Vocabulary',
  punctuation: 'Punctuation',
  thematicFlow: 'Ideas & Flow',
  sentenceStructure: 'Sentence Structure',
};

// Bands, colours and points now come from utils/grading, which builds the
// ladder from the school's own passing grade. The fixed 90/80/75 ladder that
// lived here inverted for any school passing above 80.

function TrendArrow({ history }) {
  if (!history || history.length < 2) return <Minus className="w-4 h-4 text-slate-300" />;
  const delta = history[history.length - 1] - history[history.length - 2];
  if (delta > 2) return <TrendingUp className="w-4 h-4 text-lime-600" />;
  if (delta < -2) return <TrendingDown className="w-4 h-4 text-magenta-500" />;
  return <Minus className="w-4 h-4 text-slate-300" />;
}

function Spark({ values }) {
  if (!values || values.length < 2) return null;
  const w = 64, h = 24;
  const min = Math.min(...values, 0), max = Math.max(...values, 100);
  const y = (v) => h - ((v - min) / (max - min || 1)) * h;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${y(v)}`).join(' ');
  const rising = values[values.length - 1] >= values[0];
  const stroke = rising ? '#AAC029' : '#EE2F80';
  return (
    <svg width={w} height={h} className="shrink-0 hidden sm:block" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={w} cy={y(values[values.length - 1])} r="2.5" fill={stroke} />
    </svg>
  );
}

/** Horizontal bar showing how the class is spread across the bands. */
function ClassSpread({ bands, total, passingGrade }) {
  // Driven by whichever rungs exist at this passing grade rather than a fixed
  // four, so a school passing at 85 sees three bands and not two empty ones.
  const segs = bandsFor(passingGrade)
    .map(b => ({ ...b, n: bands[b.key] || 0, label: b.short }))
    .filter(s => s.n > 0);
  if (!segs.length) return <p className="text-sm text-slate-400">No graded work yet.</p>;
  const scored = segs.reduce((n, s) => n + s.n, 0);
  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden bg-slate-100">
        {segs.map(s => (
          <div key={s.label} className={s.dot} style={{ width: `${(s.n / scored) * 100}%` }}
            title={`${s.label}: ${s.n} student(s)`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {segs.map(s => (
          <span key={s.label} className="text-[11px] font-semibold text-slate-500 flex items-center gap-1.5">
            <span className={cn('w-2 h-2 rounded-full', s.dot)} /> {s.label} · {s.n}
          </span>
        ))}
        {bands.notGraded > 0 && (
          <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-slate-200" /> Nothing graded yet · {bands.notGraded}
          </span>
        )}
      </div>
      <p className="sr-only">{scored} of {total} students have graded work.</p>
    </div>
  );
}

export default function Analytics() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  // The teacher's own classes, which is what "my sections" has to be derived
  // from. This used to read /api/teacher/:id/sections — but that endpoint
  // deliberately returns every section in the *school*, because colleagues
  // share blocks and the section screen needs to show them all. Here that was
  // wrong twice over: the chooser listed sections this teacher has nothing to
  // do with, and picking one produced a blank page, since the analytics query
  // below is scoped to classes they teach and matched none.
  const [myClasses, setMyClasses] = useState([]);
  // Nobody signed in means there is nothing to fetch, so this must not open on
  // a spinner that only the first commit would take away again.
  const [isLoading, setIsLoading] = useState(() => !!getStoredUser().id);
  const [selectedSectionId, setSelectedSectionId] = useState(null);
  // Null means every subject this teacher takes in whatever section is in
  // scope. A self-contained homeroom teacher takes five subjects with the same
  // children, and averaging Filipino into Mathematics tells them nothing about
  // either.
  const [selectedSubject, setSelectedSubject] = useState(null);
  const [showSelector, setShowSelector] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [studentData, setStudentData] = useState(null);
  const [loadingStudent, setLoadingStudent] = useState(false);

  // When the Dashboard warning panel links here with ?sectionId=..., skip the
  // section chooser and jump straight into that section's insights.
  useEffect(() => {
    const sid = searchParams.get('sectionId');
    if (sid) {
      setSelectedSectionId(sid);
      setShowSelector(false);
      // Clean the URL so a later "Back" doesn't re-trigger this effect.
      setSearchParams({}, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const user = getStoredUser();
    if (!user.id) return;
    apiFetch(`${API_URL}/api/teacher/${user.id}/classes`)
      .then(r => r.json())
      .then(d => { if (d.success) setMyClasses(d.classes || []); })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    if (showSelector) return;
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- flipping the loading flag ahead of an async read; the rule's alternative is a data-fetching library this app doesn't use
    setIsLoading(true);
    const params = new URLSearchParams();
    if (selectedSectionId) params.set('sectionId', selectedSectionId);
    if (selectedSubject) params.set('subject', selectedSubject);
    const query = params.toString();
    apiFetch(`${API_URL}/api/teacher/${user.id}/analytics${query ? `?${query}` : ''}`)
      .then(r => r.json())
      .then(d => setData(d.success ? d : null))
      .catch(() => {}) /* a failed read leaves the empty state, which is what renders */
      .finally(() => setIsLoading(false));
  }, [selectedSectionId, selectedSubject, showSelector]);

  const loadStudentDetail = (student) => {
    setSelectedStudent(student);
    setLoadingStudent(true);
    apiFetch(`${API_URL}/api/teacher/student/${student.id}/analytics`)
      .then(r => r.json())
      .then(d => { if (d.success) setStudentData(d); })
      .catch(() => {}) /* a failed read leaves the empty state, which is what renders */
      .finally(() => setLoadingStudent(false));
  };

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-slate-400">
      <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading class insights...
    </div>
  );

  const {
    summary = {}, studentTrends = [],
    needsSupport = [], sections = [],
  } = data || {};

  // The school's threshold drives every band, colour and label below. Falls
  // back to DepEd's 75 only until the analytics payload lands.
  const passingGrade = summary.passingGrade ?? DEFAULT_PASSING_GRADE;
  // How much graded work stands behind a "needs support" call. Reported by the
  // server so this copy can never claim a bar the rule isn't actually applying.
  const minGradedForRisk = summary.minGradedForRisk ?? 3;

  // ── What this teacher actually handles ──
  // One entry per section they teach into, carrying the subjects they take
  // there. A section they merely advise, with no class of their own in it,
  // has nothing to report and is left out.
  const mySections = [...myClasses.reduce((acc, c) => {
    if (!c.section) return acc;
    const entry = acc.get(c.section.id) || {
      id: c.section.id,
      name: c.section.name,
      studentCount: c.section._count?.students ?? 0,
      subjects: new Set(),
    };
    if (c.subject) entry.subjects.add(c.subject);
    acc.set(c.section.id, entry);
    return acc;
  }, new Map()).values()].map(s => ({ ...s, subjects: [...s.subjects].sort() }));

  // Subjects offered by the chip row: those taught in the chosen section, or
  // every subject this teacher takes when the view spans all their sections.
  const subjectOptions = [...new Set(
    myClasses
      .filter(c => !selectedSectionId || c.sectionId === selectedSectionId)
      .map(c => c.subject)
      .filter(Boolean)
  )].sort();

  // The class skill timeline is scoped to whatever the section and subject
  // chips have in view, so the line and the numbers above it are describing
  // the same body of work.
  const classSkillProgressUrl = (() => {
    const params = new URLSearchParams();
    if (selectedSectionId) params.set('sectionId', selectedSectionId);
    if (selectedSubject) params.set('subject', selectedSubject);
    const query = params.toString();
    return `${API_URL}/api/teacher/${getStoredUser().id}/skill-progress${query ? `?${query}` : ''}`;
  })();

  // ── One student's detail ──
  if (selectedStudent) {
    return (
      <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6 pb-24">
        <button onClick={() => { setSelectedStudent(null); setStudentData(null); }}
          className="flex items-center gap-2 text-sm font-bold text-royal-600 hover:text-royal-700">
          <ArrowLeft className="w-4 h-4" /> Back to class insights
        </button>

        <div className="bg-white border-2 border-navy-700/10 rounded-3xl p-6 shadow-pop">
          <div className="flex items-center gap-4 mb-5">
            <div className="w-14 h-14 rounded-2xl bg-royal-100 text-royal-700 grid place-items-center font-extrabold text-xl shrink-0">
              {selectedStudent.name.charAt(0)}
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-extrabold text-navy-800 truncate">{selectedStudent.name}</h1>
              <p className="text-sm text-slate-500">{selectedStudent.username}</p>
            </div>
          </div>

          {loadingStudent ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
            </div>
          ) : studentData ? (
            <div className="space-y-6">
              {(() => {
                // Excused work is out of both totals, the way it is out of the
                // average. Excusing sets excusedAt and leaves `status` alone, so
                // a paper marked and then excused is still 'GRADED' and still
                // carries its score — filtering on status alone counted work
                // the learner was told not to hand in, and did so in the two
                // cards printed next to an average that had dropped it.
                const graded = studentData.submissions.filter(s => s.status === 'GRADED' && !s.excusedAt);
                const excusedCount = studentData.submissions.filter(s => s.excusedAt).length;
                const earned = graded.reduce((sum, s) => sum + toPoints(s.hitlScore ?? s.aiScore ?? 0, s.points), 0);
                const possible = graded.reduce((sum, s) => sum + (s.points || 100), 0);
                const band = bandFor(studentData.avgScore, passingGrade);
                // What the raw points total would be if it were a percentage.
                // Shown next to the average because the gap between the two is
                // exactly what the component weights do, and a teacher looking
                // at two unrelated-looking numbers has no way to see that. Both
                // now cover the same set of work, so the weighting is the only
                // thing left that can explain a difference.
                const rawPercent = possible > 0 ? Math.round((earned / possible) * 100) : null;
                return (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="bg-royal-50 rounded-2xl p-4">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-royal-600 mb-1">Average</p>
                      <p className="text-3xl font-extrabold text-royal-700">{pct(studentData.avgScore)}%</p>
                      {band && <span className={cn('inline-block mt-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full', band.chip)}>{band.emoji} {band.short}</span>}
                      <p className="text-[11px] text-royal-500 mt-1.5">Weighted by DepEd components</p>
                      {/* Flags an average that only covers some of this student's
                          subjects with this teacher — otherwise it renders
                          identically to one covering all of them. */}
                      {studentData.avgScorePartial && (
                        <p className="text-[11px] text-royal-500 mt-1.5">
                          Based on {studentData.avgScoreSubjectsIncluded} of {studentData.avgScoreSubjectsTotal} subjects — the rest have no graded work yet
                        </p>
                      )}
                    </div>
                    <div className="bg-aqua-50 rounded-2xl p-4">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-aqua-700 mb-1">Points earned</p>
                      <p className="text-3xl font-extrabold text-aqua-700">{Math.round(earned)}<span className="text-lg text-aqua-400">/{possible}</span></p>
                      {/* Said plainly, because the obvious reading of these two
                          cards is that one is the other as a percentage — and
                          it is not. This is a straight sum of marks; the
                          average above runs each component through its weight.
                          Where they differ, the difference is the weighting,
                          and a teacher is entitled to see that rather than
                          wonder which number is wrong. */}
                      <p className="text-[11px] text-slate-500 mt-1.5">
                        Raw total, not weighted{rawPercent !== null && ` · ${rawPercent}%`}
                      </p>
                      {excusedCount > 0 && (
                        <p className="text-[11px] text-lilac-700 mt-1">
                          {excusedCount} excused {excusedCount === 1 ? 'activity is' : 'activities are'} left out
                        </p>
                      )}
                    </div>
                    <div className="bg-sun-50 rounded-2xl p-4">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-sun-700 mb-1">Graded</p>
                      <p className="text-3xl font-extrabold text-sun-700">{graded.length}<span className="text-lg text-sun-400">/{studentData.totalSubmissions - excusedCount}</span></p>
                      <p className="text-[11px] text-slate-500 mt-1.5">
                        Activities returned{excusedCount > 0 && `, ${excusedCount} excused`}
                      </p>
                    </div>
                  </div>
                );
              })()}

              {/* ── How the average was actually worked out ──
                  DepEd grades a subject by component, not by pooling marks:
                  each of Written Work, Performance Task and Quarterly
                  Assessment is scored on its own points total, then combined
                  under weights that differ per subject. That is why the average
                  above and the raw points beside it disagree. Components with
                  nothing graded yet are dropped and the rest renormalised, so
                  the applied weight is shown next to the school's configured
                  one whenever the two differ — a teacher reading "30%" against
                  a grade computed at 37.5% would be right to call it wrong. */}
              {studentData.gradeBreakdown?.length > 0 && (
                <div className="border border-slate-200 rounded-2xl p-4">
                  <h3 className="text-sm font-extrabold text-navy-700 mb-3 flex items-center gap-2">
                    <Scale className="w-4 h-4 text-slate-400" /> How this average is worked out
                  </h3>
                  <div className="space-y-4">
                    {studentData.gradeBreakdown.map(b => (
                      <div key={`${b.subject}|${b.gradeLevel}`}>
                        {studentData.gradeBreakdown.length > 1 && (
                          <p className="text-xs font-bold text-navy-600 mb-1.5">{b.subject || 'This subject'}</p>
                        )}
                        <div className="space-y-1">
                          {['WW', 'PT', 'QA'].map(key => {
                            const score = b.componentPercents?.[key];
                            const configured = b.weights?.[key] ?? 0;
                            const applied = b.usedWeights?.[key];
                            const missing = typeof score !== 'number';
                            return (
                              <div key={key} className="flex items-baseline justify-between gap-3 text-[12px]">
                                <span className={cn('font-semibold', missing ? 'text-slate-400' : 'text-slate-600')}>
                                  {COMPONENT_LABELS[key]}
                                </span>
                                <span className="flex items-baseline gap-2 shrink-0">
                                  <span className={cn('font-bold tabular-nums', missing ? 'text-slate-300' : 'text-navy-700')}>
                                    {missing ? 'nothing graded' : `${Math.round(score)}%`}
                                  </span>
                                  <span className="text-slate-400 tabular-nums">
                                    ×{configured}%
                                    {!missing && applied !== undefined && applied !== configured && (
                                      <span className="text-amber-600"> → {applied}%</span>
                                    )}
                                  </span>
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex items-baseline justify-between gap-3 text-[12px] mt-2 pt-2 border-t border-slate-100">
                          <span className="font-extrabold text-navy-700">Subject grade</span>
                          <span className="font-extrabold text-navy-800 tabular-nums">
                            {b.subjectGrade === null ? '—' : `${b.subjectGrade}%`}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {studentData.gradeBreakdown.some(b => b.missingComponents?.length > 0) && (
                    <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
                      A component with nothing graded yet is left out and the remaining weights are
                      shared out to fill the gap — the amber figure is what was actually applied. It
                      settles back to the school&rsquo;s own weights once every component has work in it.
                    </p>
                  )}
                </div>
              )}

              <SkillProgressChart
                studentId={selectedStudent.id}
                title="How their writing skills are growing"
                emptyMessage="A couple more graded activities and a skills trend will appear here."
              />

              <div>
                <h3 className="text-sm font-extrabold text-navy-700 mb-3 flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-slate-400" /> Every activity
                </h3>
                <div className="space-y-2">
                  {studentData.submissions.length === 0 ? (
                    <p className="text-sm text-slate-400 py-4 text-center">Nothing submitted yet.</p>
                  ) : studentData.submissions.map(sub => {
                    const percent = sub.hitlScore ?? sub.aiScore;
                    // Excused first. A paper marked and then excused keeps its
                    // status and its score, so testing status alone drew it as
                    // an ordinary graded row — a number counting toward nothing,
                    // with no way to tell from the page that it had been let go.
                    const isExcused = !!sub.excusedAt;
                    const isGraded = !isExcused && sub.status === 'GRADED' && percent !== null;
                    const band = isGraded ? bandFor(percent, passingGrade) : null;
                    // Every row here is a real submission, so there is always
                    // something to open — the review screen holds the paper,
                    // the rubric scores and the feedback, which is the whole
                    // reason a teacher clicks a grade in the first place.
                    // Rendered as a link rather than a click handler so it
                    // keeps middle-click, "open in new tab" and the keyboard.
                    return (
                      <Link key={sub.id} to={`/teacher/review/${sub.id}`}
                        className="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-royal-400 transition-colors">
                        <div className="w-10 h-10 bg-white border border-slate-200 rounded-xl grid place-items-center shrink-0">
                          <FileText className="w-5 h-5 text-slate-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-navy-800 truncate">{sub.activityTitle}</p>
                          <p className="text-[11px] text-slate-400">
                            {sub.className} · {sub.activityType}
                            {sub.term ? ` · Term ${sub.term}` : ''}
                            {' · '}{new Date(sub.createdAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          {isExcused ? (
                            <p className="text-[11px] font-semibold text-lilac-800 bg-lilac-100 px-2 py-1 rounded-full"
                              title={sub.excusedReason || 'Excused — does not count toward the average'}>
                              Excused
                            </p>
                          ) : isGraded ? (
                            <>
                              {/* Points first — that's what goes in the record book */}
                              <p className="text-sm font-extrabold text-navy-800">
                                {toPoints(percent, sub.points)}<span className="text-slate-400">/{sub.points}</span>
                              </p>
                              <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full', band.chip)}>{pct(percent)}%</span>
                            </>
                          ) : (
                            <p className="text-[11px] font-semibold text-sun-700 bg-sun-100 px-2 py-1 rounded-full">Not graded yet</p>
                          )}
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" aria-hidden="true" />
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // ── Section chooser ──
  if (showSelector) {
    // Derived from the teacher's own classes, so a section only appears if
    // they actually teach into it. `sections` off the analytics payload says
    // the same thing, but only once a view has been loaded — and this screen
    // is what comes first.
    const list = mySections.length ? mySections : sections;
    return (
      <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24">
        <div className="mb-6">
          <h1 className="text-2xl font-extrabold text-navy-800 flex items-center gap-2">
            <BarChart2 className="w-6 h-6 text-royal-500" /> Class Insights
          </h1>
          <p className="text-slate-500 text-sm mt-1">See how each section is doing and who could use a hand.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button onClick={() => { setSelectedSectionId(null); setSelectedSubject(null); setShowSelector(false); }}
            className="bg-white border-2 border-navy-700/10 rounded-3xl p-5 text-left hover:border-royal-400 shadow-pop transition-colors">
            <Users className="w-6 h-6 text-royal-500 mb-2" />
            <p className="font-extrabold text-navy-800">All my sections</p>
            <p className="text-xs text-slate-500 mt-0.5">Everything at once</p>
          </button>
          {list.map(s => (
            <button key={s.id} onClick={() => { setSelectedSectionId(s.id); setSelectedSubject(null); setShowSelector(false); }}
              className="bg-white border-2 border-navy-700/10 rounded-3xl p-5 text-left hover:border-royal-400 shadow-pop transition-colors">
              <Users className="w-6 h-6 text-aqua-500 mb-2" />
              <p className="font-extrabold text-navy-800">{s.name}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {s._count?.students ?? s.studentCount ?? 0} students
              </p>
              {s.subjects?.length > 0 && (
                <p className="text-[11px] text-slate-400 mt-1">{s.subjects.join(' · ')}</p>
              )}
            </button>
          ))}
          {list.length === 0 && (
            <div className="sm:col-span-2 text-center py-10 border-2 border-dashed border-slate-200 rounded-3xl text-slate-400">
              <p className="font-bold text-slate-500">No classes yet</p>
              <p className="text-sm mt-1">Create a class for one of your sections and its insights will appear here.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  const hasData = summary.gradedCount > 0;
  const classBand = bandFor(summary.classAverage, passingGrade);
  // Which section this page is showing, so the heading says so — with a
  // subject chip row underneath, "Class Insights" alone stops being enough to
  // tell two views apart.
  const sectionLabel = selectedSectionId
    ? (mySections.find(s => s.id === selectedSectionId)?.name
       || sections.find(s => s.id === selectedSectionId)?.name
       || null)
    : null;

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6 pb-24">
      <div className="flex items-start gap-4">
        <button aria-label="Back to section chooser"
          onClick={() => { setShowSelector(true); setSelectedSectionId(null); setSelectedSubject(null); }}
          className="w-10 h-10 rounded-2xl bg-white border-2 border-navy-700/10 text-royal-600 grid place-items-center shadow-pop shrink-0">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-2xl font-extrabold text-navy-800">
            Class Insights
            {sectionLabel && <span className="text-slate-400 font-bold"> · {sectionLabel}</span>}
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            How your students are doing, and where a little help would go furthest.
          </p>
        </div>
      </div>

      {/* ── Subject ──
          Every figure below — the class average, the at-risk list, the
          per-activity table — is computed across whatever classes are in
          scope. For a homeroom teacher taking five subjects with the same
          children that meant one number spanning all five, which describes
          none of them. */}
      {subjectOptions.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mr-1">Subject</span>
          <button type="button" onClick={() => setSelectedSubject(null)}
            className={cn('px-3 py-1 rounded-full text-xs font-bold border-2 transition-all',
              selectedSubject === null
                ? 'border-brand-chrome bg-brand-chrome text-white'
                : 'border-slate-200 text-slate-500 hover:border-navy-300')}>
            All subjects
          </button>
          {subjectOptions.map(subject => (
            <button key={subject} type="button"
              onClick={() => setSelectedSubject(selectedSubject === subject ? null : subject)}
              className={cn('px-3 py-1 rounded-full text-xs font-bold border-2 transition-all',
                selectedSubject === subject
                  ? 'border-royal-500 bg-royal-500 text-white'
                  : 'border-slate-200 text-slate-500 hover:border-royal-300')}>
              {subject}
            </button>
          ))}
        </div>
      )}

      {!hasData ? (
        <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-3xl text-slate-400">
          <Sparkles className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="font-bold text-slate-500">Nothing to show just yet</p>
          <p className="text-sm mt-1">Grade a few activities and this page will fill up with insights.</p>
        </div>
      ) : (
        <>
          {/* ── Headline numbers ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white border-2 border-navy-700/10 rounded-3xl p-5 shadow-pop">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">Class average</p>
              <div className="flex items-baseline gap-2 flex-wrap">
                <p className="text-4xl font-extrabold text-navy-800">{summary.classAverage}%</p>
                {classBand && (
                  <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full', classBand.chip)}>
                    {classBand.emoji} {classBand.label}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-2">
                {summary.pointsEarned} of {summary.pointsPossible} points earned overall
              </p>
            </div>

            <div className="bg-white border-2 border-navy-700/10 rounded-3xl p-5 shadow-pop">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">Work graded</p>
              <p className="text-4xl font-extrabold text-navy-800">{summary.gradedCount}</p>
              <p className="text-xs text-slate-500 mt-2">across {summary.studentCount} student{summary.studentCount === 1 ? '' : 's'}</p>
            </div>

            <div className="bg-white border-2 border-navy-700/10 rounded-3xl p-5 shadow-pop">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">How the class is spread</p>
              <ClassSpread bands={summary.bands || {}} total={summary.studentCount} passingGrade={passingGrade} />
            </div>
          </div>

          {/* ── Who could use a hand ── */}
          {(() => {
            const failing = needsSupport.filter(e => e.severity === 'failing');
            const hasFailing = failing.length > 0;
            // Group by section so the teacher sees which block each learner sits in.
            const bySection = needsSupport.reduce((acc, entry) => {
              const key = entry.sectionName || 'Unassigned';
              (acc[key] = acc[key] || { sectionId: entry.sectionId, entries: [] }).entries.push(entry);
              return acc;
            }, {});
            return (
              <div className={cn(
                'rounded-3xl border-2 p-5 shadow-pop',
                hasFailing ? 'bg-red-50/60 border-red-200' : 'bg-amber-50/60 border-amber-200'
              )}>
                <h2 className="text-sm font-extrabold text-navy-700 flex items-center gap-2 mb-1">
                  <div className={cn('p-1.5 rounded-lg', hasFailing ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600')}>
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  Who could use a hand
                </h2>
                <p className="text-xs text-slate-500 mb-4">
                  Suggestions only — you know your class best. A low average is
                  only raised here once a learner has {minGradedForRisk} graded
                  activities behind it.
                </p>
                {needsSupport.length === 0 ? (
                  <div className="text-center py-8">
                    <Trophy className="w-10 h-10 mx-auto mb-2 text-lime-500" />
                    <p className="font-bold text-navy-700">Everyone&apos;s tracking well 🎉</p>
                    <p className="text-sm text-slate-500 mt-0.5">
                      {summary.gradedCount > 0 && summary.gradedCount < minGradedForRisk * 2
                        ? `Too early to say much — averages are raised here after ${minGradedForRisk} graded activities per learner.`
                        : 'No one is falling behind right now.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {Object.entries(bySection).map(([sectionName, { sectionId, entries }]) => (
                      <div key={sectionName}>
                        <button
                          type="button"
                          onClick={() => {
                            if (sectionId) {
                              setSelectedSectionId(sectionId);
                              setSelectedSubject(null);
                              setShowSelector(false);
                            }
                          }}
                          className="text-xs font-extrabold text-navy-700 mb-2 flex items-center gap-1.5 hover:text-royal-600 transition-colors"
                        >
                          <Users className="w-3.5 h-3.5" /> {sectionName}
                          <ChevronRight className="w-3 h-3 text-slate-400" />
                        </button>
                        <div className="space-y-2">
                          {entries.map(({ student, reasons, severity }) => {
                            const tone = severity === 'failing' ? 'failing' : 'watch';
                            return (
                              <button key={student.id} onClick={() => loadStudentDetail(student)}
                                className={cn(
                                  'w-full text-left flex items-start gap-3 p-3 rounded-2xl border transition-colors',
                                  tone === 'failing'
                                    ? 'bg-white border-red-200 hover:border-red-400'
                                    : 'bg-white border-amber-200 hover:border-amber-400'
                                )}>
                                <div className={cn(
                                  'w-9 h-9 rounded-xl grid place-items-center font-extrabold text-sm shrink-0',
                                  tone === 'failing' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                                )}>
                                  {student.name.charAt(0)}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="font-bold text-navy-800 text-sm">{student.name}</p>
                                  <ul className="mt-1 space-y-0.5">
                                    {reasons.map((r, i) => (
                                      <li key={i} className="text-xs text-slate-600 flex items-start gap-1.5">
                                        <Target className={cn('w-3 h-3 mt-0.5 shrink-0',
                                          tone === 'failing' ? 'text-red-500' : 'text-amber-500')} />
                                        <span>
                                          {r.kind === 'skill'
                                            ? `${SKILL_LABELS[r.skill] || r.skill} has been easing down`
                                            : r.label}
                                          {r.detail && <span className="text-slate-400"> — {r.detail}</span>}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                                <ChevronRight className={cn('w-4 h-4 shrink-0 mt-1',
                                  tone === 'failing' ? 'text-red-400' : 'text-amber-400')} />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Writing skills across the class ──
              The same chart the student screens draw, pooled across every class
              in scope. The bars this replaced only said where the class stands
              today; a line says which way each skill has been moving, which is
              the thing a teacher can still act on. */}
          <SkillProgressChart
            dataUrl={classSkillProgressUrl}
            title="Writing skills across the class"
            subtitle="Cumulative mastery over every graded activity in this view. Hover a point to see which activity it is."
            showActivityList={false}
            cardClass="bg-white border-2 border-navy-700/10 rounded-3xl p-5 shadow-pop"
            emptyMessage="Once a few activities are graded against a rubric that assesses writing or language, the class trend will appear here."
          />

          {/* ── Every student ── */}
          <div className="bg-white border-2 border-navy-700/10 rounded-3xl p-5 shadow-pop">
            <h2 className="text-sm font-extrabold text-navy-700 flex items-center gap-2 mb-4">
              <Users className="w-4 h-4 text-slate-400" /> Every student
            </h2>
            <div className="space-y-2">
              {studentTrends.map(st => {
                const band = bandFor(st.avgPercent, passingGrade);
                return (
                  <button key={st.student.id} onClick={() => loadStudentDetail(st.student)}
                    className="w-full text-left flex items-center gap-3 p-3 rounded-2xl hover:bg-slate-50 transition-colors">
                    <div className="w-9 h-9 rounded-xl bg-royal-100 text-royal-700 grid place-items-center font-extrabold text-sm shrink-0">
                      {st.student.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-navy-800 text-sm truncate">{st.student.name}</p>
                      <p className="text-[11px] text-slate-400 truncate">
                        {st.gradedCount === 0
                          ? 'No graded work yet'
                          : `${st.pointsEarned}/${st.pointsPossible} pts · ${st.gradedCount} activit${st.gradedCount === 1 ? 'y' : 'ies'}`}
                      </p>
                    </div>
                    <Spark values={st.history} />
                    <TrendArrow history={st.history} />
                    {st.avgPercent === null ? (
                      <span className="text-xs font-semibold text-slate-300 w-24 text-center shrink-0">—</span>
                    ) : (
                      <span className={cn('text-[11px] font-bold px-2 py-1 rounded-full shrink-0 w-24 text-center', band.chip)}>
                        {pct(st.avgPercent)}% {band.emoji}
                      </span>
                    )}
                    <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
