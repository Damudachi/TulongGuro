import { useState, useEffect } from 'react';
import {
  BarChart2, Users, Loader2, ArrowLeft, FileText, ChevronRight, Sparkles,
  LifeBuoy, Trophy, Target, TrendingUp, TrendingDown, Minus, ClipboardList,
} from 'lucide-react';
import { API_URL } from '../../config';
import { bandsFor, bandFor, toPoints, pct, DEFAULT_PASSING_GRADE } from '../../utils/grading';
import SkillProgressChart from '../../components/SkillProgressChart';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

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
  const [data, setData] = useState(null);
  const [sectionsList, setSectionsList] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedSectionId, setSelectedSectionId] = useState(null);
  const [showSelector, setShowSelector] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [studentData, setStudentData] = useState(null);
  const [loadingStudent, setLoadingStudent] = useState(false);
  // Null means "all skills". Reset whenever the section changes, since the
  // skills available differ between classes.
  const [skillFilter, setSkillFilter] = useState(null);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return setIsLoading(false);
    fetch(`${API_URL}/api/teacher/${user.id}/sections`)
      .then(r => r.json())
      .then(d => { if (d.success) setSectionsList(d.sections || []); })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    if (showSelector) return;
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return;
    setIsLoading(true);
    const url = selectedSectionId
      ? `${API_URL}/api/teacher/${user.id}/analytics?sectionId=${selectedSectionId}`
      : `${API_URL}/api/teacher/${user.id}/analytics`;
    fetch(url).then(r => r.json())
      .then(d => setData(d.success ? d : null))
      .finally(() => setIsLoading(false));
    setSkillFilter(null);
  }, [selectedSectionId, showSelector]);

  const loadStudentDetail = (student) => {
    setSelectedStudent(student);
    setLoadingStudent(true);
    fetch(`${API_URL}/api/teacher/student/${student.id}/analytics`)
      .then(r => r.json())
      .then(d => { if (d.success) setStudentData(d); })
      .finally(() => setLoadingStudent(false));
  };

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-slate-400">
      <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading class insights...
    </div>
  );

  const {
    summary = {}, activityBreakdown = [], studentTrends = [],
    needsSupport = [], classAvgSkills = {}, sections = [],
  } = data || {};

  // The school's threshold drives every band, colour and label below. Falls
  // back to DepEd's 75 only until the analytics payload lands.
  const passingGrade = summary.passingGrade ?? DEFAULT_PASSING_GRADE;

  const curriculumSkills = data?.curriculumSkills || [];
  const skillById = Object.fromEntries(curriculumSkills.map(s => [s.id, s]));

  // Only offer skills this class actually has activities for, with the count,
  // so the filter never leads to an empty table.
  const skillFilterOptions = curriculumSkills
    .map(s => ({ ...s, count: activityBreakdown.filter(a => a.skills?.includes(s.id)).length }))
    .filter(s => s.count > 0);

  const visibleActivities = skillFilter
    ? activityBreakdown.filter(a => a.skills?.includes(skillFilter))
    : activityBreakdown;

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
                const graded = studentData.submissions.filter(s => s.status === 'GRADED');
                const earned = graded.reduce((sum, s) => sum + toPoints(s.hitlScore ?? s.aiScore ?? 0, s.points), 0);
                const possible = graded.reduce((sum, s) => sum + (s.points || 100), 0);
                const band = bandFor(studentData.avgScore, passingGrade);
                return (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="bg-royal-50 rounded-2xl p-4">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-royal-600 mb-1">Average</p>
                      <p className="text-3xl font-extrabold text-royal-700">{pct(studentData.avgScore)}%</p>
                      {band && <span className={cn('inline-block mt-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full', band.chip)}>{band.emoji} {band.short}</span>}
                    </div>
                    <div className="bg-aqua-50 rounded-2xl p-4">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-aqua-700 mb-1">Points earned</p>
                      <p className="text-3xl font-extrabold text-aqua-700">{Math.round(earned)}<span className="text-lg text-aqua-400">/{possible}</span></p>
                      <p className="text-[11px] text-slate-500 mt-1.5">Across all graded work</p>
                    </div>
                    <div className="bg-sun-50 rounded-2xl p-4">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-sun-700 mb-1">Graded</p>
                      <p className="text-3xl font-extrabold text-sun-700">{graded.length}<span className="text-lg text-sun-400">/{studentData.totalSubmissions}</span></p>
                      <p className="text-[11px] text-slate-500 mt-1.5">Activities returned</p>
                    </div>
                  </div>
                );
              })()}

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
                    const isGraded = sub.status === 'GRADED' && percent !== null;
                    const band = isGraded ? bandFor(percent, passingGrade) : null;
                    return (
                      <div key={sub.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl">
                        <div className="w-10 h-10 bg-white border border-slate-200 rounded-xl grid place-items-center shrink-0">
                          <FileText className="w-5 h-5 text-slate-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-navy-800 truncate">{sub.activityTitle}</p>
                          <p className="text-[11px] text-slate-400">
                            {sub.className} · {sub.activityType} · {new Date(sub.createdAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          {isGraded ? (
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
                      </div>
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
    const list = sectionsList.length ? sectionsList : sections;
    return (
      <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24">
        <div className="mb-6">
          <h1 className="text-2xl font-extrabold text-navy-800 flex items-center gap-2">
            <BarChart2 className="w-6 h-6 text-royal-500" /> Class Insights
          </h1>
          <p className="text-slate-500 text-sm mt-1">See how each section is doing and who could use a hand.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button onClick={() => { setSelectedSectionId(null); setShowSelector(false); }}
            className="bg-white border-2 border-navy-700/10 rounded-3xl p-5 text-left hover:border-royal-400 shadow-pop transition-colors">
            <Users className="w-6 h-6 text-royal-500 mb-2" />
            <p className="font-extrabold text-navy-800">All my sections</p>
            <p className="text-xs text-slate-500 mt-0.5">Everything at once</p>
          </button>
          {list.map(s => (
            <button key={s.id} onClick={() => { setSelectedSectionId(s.id); setShowSelector(false); }}
              className="bg-white border-2 border-navy-700/10 rounded-3xl p-5 text-left hover:border-royal-400 shadow-pop transition-colors">
              <Users className="w-6 h-6 text-aqua-500 mb-2" />
              <p className="font-extrabold text-navy-800">{s.name}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {s._count?.students ?? s.studentCount ?? 0} students
              </p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const hasData = summary.gradedCount > 0;
  const classBand = bandFor(summary.classAverage, passingGrade);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6 pb-24">
      <div className="flex items-start gap-4">
        <button aria-label="Back to section chooser"
          onClick={() => { setShowSelector(true); setSelectedSectionId(null); }}
          className="w-10 h-10 rounded-2xl bg-white border-2 border-navy-700/10 text-royal-600 grid place-items-center shadow-pop shrink-0">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-2xl font-extrabold text-navy-800">Class Insights</h1>
          <p className="text-slate-500 text-sm mt-1">
            How your students are doing, and where a little help would go furthest.
          </p>
        </div>
      </div>

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
          <div className="bg-white border-2 border-navy-700/10 rounded-3xl p-5 shadow-pop">
            <h2 className="text-sm font-extrabold text-navy-700 flex items-center gap-2 mb-1">
              <LifeBuoy className="w-4 h-4 text-aqua-600" /> Who could use a hand
            </h2>
            <p className="text-xs text-slate-500 mb-4">Suggestions only — you know your class best.</p>
            {needsSupport.length === 0 ? (
              <div className="text-center py-8">
                <Trophy className="w-10 h-10 mx-auto mb-2 text-lime-500" />
                <p className="font-bold text-navy-700">Everyone&apos;s tracking well 🎉</p>
                <p className="text-sm text-slate-500 mt-0.5">No one is falling behind right now.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {needsSupport.map(({ student, reasons }) => (
                  <button key={student.id} onClick={() => loadStudentDetail(student)}
                    className="w-full text-left flex items-start gap-3 p-3 rounded-2xl bg-aqua-50/60 border border-aqua-200 hover:border-aqua-400 transition-colors">
                    <div className="w-9 h-9 rounded-xl bg-white text-aqua-700 grid place-items-center font-extrabold text-sm shrink-0">
                      {student.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-navy-800 text-sm">{student.name}</p>
                      <ul className="mt-1 space-y-0.5">
                        {reasons.map((r, i) => (
                          <li key={i} className="text-xs text-slate-600 flex items-start gap-1.5">
                            <Target className="w-3 h-3 text-aqua-600 mt-0.5 shrink-0" />
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
                    <ChevronRight className="w-4 h-4 text-aqua-400 shrink-0 mt-1" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Per-activity, in that activity's own points ── */}
          {activityBreakdown.length > 0 && (
            <div className="bg-white border-2 border-navy-700/10 rounded-3xl p-5 shadow-pop">
              <h2 className="text-sm font-extrabold text-navy-700 flex items-center gap-2 mb-1">
                <ClipboardList className="w-4 h-4 text-royal-500" /> How each activity went
              </h2>
              <p className="text-xs text-slate-500 mb-4">Hardest first. Points are out of each activity&apos;s own total.</p>

              {/* ── Skill filter ──
                  Narrows the list to the activities that assess one curriculum
                  skill, so "how is their reading comprehension going" is one
                  click rather than a reading of every row. Only skills actually
                  present in this class are offered — an empty filter chip is
                  just a dead end. */}
              {skillFilterOptions.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mr-1">Skill</span>
                  <button type="button" onClick={() => setSkillFilter(null)}
                    className={cn('px-3 py-1 rounded-full text-xs font-bold border-2 transition-all',
                      skillFilter === null
                        ? 'border-navy-700 bg-navy-700 text-white'
                        : 'border-slate-200 text-slate-500 hover:border-navy-300')}>
                    All ({activityBreakdown.length})
                  </button>
                  {skillFilterOptions.map(s => (
                    <button key={s.id} type="button"
                      onClick={() => setSkillFilter(skillFilter === s.id ? null : s.id)}
                      className="px-3 py-1 rounded-full text-xs font-bold border-2 transition-all flex items-center gap-1.5"
                      style={skillFilter === s.id
                        ? { borderColor: s.color, backgroundColor: s.color, color: 'white' }
                        : { borderColor: '#E2E8F0', color: '#64748B' }}>
                      <span className="w-2 h-2 rounded-full"
                        style={{ background: skillFilter === s.id ? 'white' : s.color }} />
                      {s.label} ({s.count})
                    </button>
                  ))}
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[520px]">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-100">
                      <th className="text-left font-bold py-2">Activity</th>
                      <th className="text-center font-bold py-2 w-28">Class average</th>
                      <th className="text-center font-bold py-2 w-24">Range</th>
                      <th className="text-center font-bold py-2 w-20">Graded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleActivities.map(a => {
                      const band = bandFor(a.avgPercent, passingGrade);
                      return (
                        <tr key={a.id} className="border-b border-slate-50 last:border-0">
                          <td className="py-3">
                            <p className="font-bold text-navy-800">{a.title}</p>
                            <p className="text-[11px] text-slate-400">{a.type} · {a.points} pts</p>
                            {a.skills?.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {a.skills.map(id => {
                                  const s = skillById[id];
                                  if (!s) return null;
                                  return (
                                    <span key={id} className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                                      style={{ backgroundColor: `${s.color}1A`, color: s.color }}>
                                      {s.label}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </td>
                          <td className="py-3 text-center">
                            <p className="font-extrabold text-navy-800">
                              {a.avgPoints}<span className="text-slate-400">/{a.points}</span>
                            </p>
                            <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full', band.chip)}>
                              {pct(a.avgPercent)}%
                            </span>
                          </td>
                          <td className="py-3 text-center text-xs text-slate-500">{pct(a.lowest)}%–{pct(a.highest)}%</td>
                          <td className="py-3 text-center text-xs font-semibold text-slate-500">{a.gradedCount}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Writing skills across the class ── */}
          {Object.values(classAvgSkills).some(v => v > 0) && (
            <div className="bg-white border-2 border-navy-700/10 rounded-3xl p-5 shadow-pop">
              <h2 className="text-sm font-extrabold text-navy-700 flex items-center gap-2 mb-4">
                <Sparkles className="w-4 h-4 text-lilac-500" /> Writing skills across the class
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Object.entries(SKILL_LABELS).map(([key, label]) => {
                  const v = classAvgSkills[key] || 0;
                  return (
                    <div key={key}>
                      <div className="flex justify-between items-baseline mb-1">
                        <span className="text-xs font-bold text-slate-600">{label}</span>
                        <span className="text-xs font-extrabold text-navy-800">{v}<span className="text-slate-400">/25</span></span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-lilac-400 rounded-full transition-all"
                          style={{ width: `${Math.min(100, (v / 25) * 100)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-400 mt-3">Each skill is scored out of 25 by the AI when it reads a submission.</p>
            </div>
          )}

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
