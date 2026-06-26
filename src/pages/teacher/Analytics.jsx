import { useState, useEffect } from 'react';
import { AlertTriangle, TrendingDown, BarChart2, Users, ChevronDown, ChevronUp, Loader2, ShieldAlert, ArrowLeft, FileText, ChevronRight } from 'lucide-react';
import { API_URL } from '../../config';

const SKILL_LABELS = { vocabulary: 'Vocabulary', punctuation: 'Punctuation', thematicFlow: 'Thematic Flow', sentenceStructure: 'Sentence Structure' };
const SEVERITY_CONFIG = {
  HIGH: { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-700', badge: 'bg-red-100 text-red-700', icon: '🔴' },
  MEDIUM: { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700', icon: '🟡' }
};

function SkillBar({ label, value, max = 25 }) {
  const pct = Math.min(100, (value / max) * 100);
  const color = pct >= 70 ? 'bg-green-400' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-600 font-medium">{label}</span>
        <span className="font-bold text-slate-700">{value}/{max}</span>
      </div>
      <div className="w-full bg-slate-100 rounded-full h-2">
        <div className={`h-2 rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function SparkTrend({ values }) {
  if (!values || values.length < 2) return null;
  const max = Math.max(...values, 1);
  const w = 60; const h = 28;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * h}`).join(' ');
  const dropping = values[values.length - 1] < values[0];
  return (
    <svg width={w} height={h} className="inline-block">
      <polyline points={pts} fill="none" stroke={dropping ? '#ef4444' : '#22c55e'} strokeWidth="2" strokeLinejoin="round" />
      {values.map((v, i) => (
        <circle key={i} cx={(i / (values.length - 1)) * w} cy={h - (v / max) * h} r="2.5"
          fill={dropping ? '#ef4444' : '#22c55e'} />
      ))}
    </svg>
  );
}

export default function Analytics() {
  const [data, setData] = useState(null);
  const [sectionsList, setSectionsList] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expanded, setExpanded] = useState({});
  const [selectedSectionId, setSelectedSectionId] = useState(null);
  const [showSelector, setShowSelector] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [studentData, setStudentData] = useState(null);
  const [loadingStudent, setLoadingStudent] = useState(false);

  // Load sections list on mount and initial analytics only after a selection
  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return setIsLoading(false);

    // fetch available sections for the teacher
    fetch(`${API_URL}/api/teacher/${user.id}/sections`)
      .then(r => r.json())
      .then(d => {
        if (d.success) setSectionsList(d.sections || []);
      })
      .catch(() => {})
      .finally(() => {
        // keep loading false here; analytics fetch will show its own loader
        setIsLoading(false);
      });
  }, []);

  // Fetch analytics whenever a section is selected (or All). Always load overall metrics
  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return;
    setIsLoading(true);
    const url = selectedSectionId
      ? `${API_URL}/api/teacher/${user.id}/analytics?sectionId=${selectedSectionId}`
      : `${API_URL}/api/teacher/${user.id}/analytics`;
    fetch(url).then(r => r.json())
      .then(d => { if (d.success) setData(d); else setData(null); })
      .finally(() => setIsLoading(false));
  }, [selectedSectionId]);

  const loadStudentDetail = (student) => {
    setSelectedStudent(student);
    setLoadingStudent(true);
    fetch(`${API_URL}/api/teacher/student/${student.id}/analytics`)
      .then(r => r.json())
      .then(d => { if (d.success) setStudentData(d); })
      .finally(() => setLoadingStudent(false));
  };

  const toggleExpand = (id) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-slate-400">
      <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading analytics...
    </div>
  );

  // If there's no analytics data yet, show the section selector first (if enabled).
  if (!data && !showSelector) return (
    <div className="p-8 text-center text-slate-500">
      <BarChart2 className="w-10 h-10 mx-auto mb-3 text-slate-300" />
      <p>No analytics data available yet. Grade more submissions to see trends.</p>
    </div>
  );

  const { warnings = [], studentTrends = [], classAvgSkills = {}, warningCount = 0, sections = [] } = data || {};

  // Student Detail View
  if (selectedStudent) {
    return (
      <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
        <button onClick={() => { setSelectedStudent(null); setStudentData(null); }}
          className="flex items-center gap-2 text-sm font-medium text-brand-navy hover:text-blue-900">
          <ArrowLeft className="w-4 h-4" /> Back to Analytics
        </button>

        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-14 h-14 rounded-full bg-brand-navy/10 text-brand-navy flex items-center justify-center font-bold text-xl">
              {selectedStudent.name.charAt(0)}
            </div>
            <div>
              <h1 className="text-xl font-bold text-brand-slate">{selectedStudent.name}</h1>
              <p className="text-sm text-slate-500">{selectedStudent.username}</p>
            </div>
          </div>

          {loadingStudent ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading student data...
            </div>
          ) : studentData ? (
            <div className="space-y-6">
              {/* Summary */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-blue-50 rounded-xl p-4 text-center">
                  <p className="text-2xl font-extrabold text-brand-navy">{studentData.avgScore}</p>
                  <p className="text-xs text-slate-500">Avg Score</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-4 text-center">
                  <p className="text-2xl font-extrabold text-brand-slate">{studentData.totalSubmissions}</p>
                  <p className="text-xs text-slate-500">Submissions</p>
                </div>
                <div className="bg-green-50 rounded-xl p-4 text-center">
                  <p className="text-2xl font-extrabold text-green-600">
                    {studentData.submissions.filter(s => s.status === 'GRADED').length}
                  </p>
                  <p className="text-xs text-slate-500">Graded</p>
                </div>
              </div>

              {/* Skill Averages */}
              <div>
                <h3 className="text-sm font-bold text-brand-slate mb-3">Skill Averages</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {Object.entries(studentData.avgSkills).map(([skill, avg]) => (
                    <SkillBar key={skill} label={SKILL_LABELS[skill]} value={avg} max={25} />
                  ))}
                </div>
              </div>

              {/* Paper Works */}
              <div>
                <h3 className="text-sm font-bold text-brand-slate mb-3">Paper Works</h3>
                <div className="space-y-2">
                  {studentData.submissions.length === 0 ? (
                    <p className="text-sm text-slate-400 py-4 text-center">No submissions yet.</p>
                  ) : studentData.submissions.map(sub => {
                    const score = sub.hitlScore ?? sub.aiScore;
                    const pct = score !== null && sub.points ? (score / sub.points) * 100 : null;
                    const scoreColor = pct === null ? 'text-slate-400' : pct >= 80 ? 'text-green-600' : pct >= 65 ? 'text-amber-600' : 'text-red-600';
                    return (
                      <div key={sub.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                        <div className="w-10 h-10 bg-white border border-slate-200 rounded-lg flex items-center justify-center shrink-0">
                          <FileText className="w-5 h-5 text-slate-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-brand-slate truncate">{sub.activityTitle}</p>
                          <p className="text-[11px] text-slate-400">{sub.className} • {sub.activityType} • {new Date(sub.createdAt).toLocaleDateString()}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`text-sm font-bold ${scoreColor}`}>
                            {score !== null ? `${score}/${sub.points}` : '—'}
                          </p>
                          <p className="text-[10px] text-slate-400">{sub.status}</p>
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

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-8">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          {!showSelector && (
            <button aria-label="Back to section chooser" onClick={() => { setShowSelector(true); setSelectedSectionId(null); }}
              className="w-10 h-10 rounded-full bg-white border border-slate-200 text-brand-navy flex items-center justify-center shadow-sm hover:bg-brand-navy/5">
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div>
            <h1 className="text-2xl font-bold text-brand-slate">Predictive Analytics</h1>
            <p className="text-slate-500 text-sm mt-1">Early warning system — tracks skill trends across submissions</p>
          </div>
        </div>
      </div>

      {/* Initial Section Choices Panel */}
      {showSelector && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="text-lg font-bold text-brand-slate mb-2">Choose a Section</h2>
          <p className="text-sm text-slate-500 mb-4">Select which section's analytics you want to view.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button onClick={() => { setSelectedSectionId(null); setShowSelector(false); }}
              className="text-left p-4 rounded-lg border border-slate-200 hover:border-brand-navy transition-colors bg-white">
              <div className="font-bold">All Sections</div>
              <div className="text-xs text-slate-400">View analytics across all sections</div>
            </button>
            {sectionsList.map(sec => (
              <button key={sec.id} onClick={() => { setSelectedSectionId(sec.id); setShowSelector(false); }}
                className="text-left p-4 rounded-lg border border-slate-200 hover:border-brand-navy transition-colors bg-white">
                <div className="font-bold">{sec.name}</div>
                <div className="text-xs text-slate-400">{sec._count?.students ?? sec.studentCount ?? 0} students</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Section filtering removed — section choices handled by the chooser above */}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Students Tracked', value: studentTrends.length, icon: Users, color: 'text-brand-navy bg-blue-50' },
          { label: 'Active Warnings', value: warningCount, icon: AlertTriangle, color: warningCount > 0 ? 'text-red-600 bg-red-50' : 'text-green-600 bg-green-50' },
          { label: 'High Severity', value: warnings.filter(w => w.warnings.some(x => x.severity === 'HIGH')).length, icon: ShieldAlert, color: 'text-red-700 bg-red-50' },
          { label: 'Skills Monitored', value: 4, icon: BarChart2, color: 'text-purple-600 bg-purple-50' },
        ].map(card => (
          <div key={card.label} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-2">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${card.color}`}>
              <card.icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-extrabold text-brand-slate">{card.value}</p>
              <p className="text-xs text-slate-500">{card.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Warning Cards (only for a specific section) */}
      {selectedSectionId && warnings.length > 0 && (
        <div>
          <h2 className="text-base font-bold text-brand-slate mb-3 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500" /> Students Needing Intervention
          </h2>
          <div className="space-y-3">
            {warnings.map(({ student, warnings: studentWarns }) => {
              const topSeverity = studentWarns.some(w => w.severity === 'HIGH') ? 'HIGH' : 'MEDIUM';
              const cfg = SEVERITY_CONFIG[topSeverity];
              const isOpen = expanded[student.id];
              return (
                <div key={student.id} className={`rounded-xl border-2 ${cfg.border} ${cfg.bg} overflow-hidden`}>
                  <button className="w-full p-4 flex items-center justify-between text-left" onClick={() => toggleExpand(student.id)}>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-white border-2 border-slate-200 flex items-center justify-center font-bold text-brand-slate text-sm">
                        {student.name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-bold text-brand-slate">{student.name}</p>
                        <p className="text-xs text-slate-500">{student.username} • {studentWarns.length} skill{studentWarns.length > 1 ? 's' : ''} dropping</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold px-2 py-1 rounded-full ${cfg.badge}`}>{cfg.icon} {topSeverity}</span>
                      {isOpen ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                    </div>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 space-y-3 border-t border-slate-200 pt-3">
                      {studentWarns.map(warn => (
                        <div key={warn.skill} className={`p-3 rounded-lg border ${SEVERITY_CONFIG[warn.severity].border} bg-white`}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <TrendingDown className="w-4 h-4 text-red-500" />
                              <span className="font-bold text-sm text-brand-slate">{SKILL_LABELS[warn.skill]}</span>
                            </div>
                            <SparkTrend values={warn.trend} />
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-600">
                            Scores: {warn.trend.join(' → ')} out of 25
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Section Average Skill Bars */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-base font-bold text-brand-slate mb-4">
          {selectedSectionId ? 'Section' : 'Overall'} Skill Averages
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {Object.entries(classAvgSkills).map(([skill, avg]) => (
            <SkillBar key={skill} label={SKILL_LABELS[skill]} value={avg} max={25} />
          ))}
        </div>
      </div>

      {/* Student List — Clickable (only for a specific section) */}
      {selectedSectionId && studentTrends.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <h2 className="text-base font-bold text-brand-slate">Students</h2>
            <p className="text-xs text-slate-500">Click a student to view their detailed analytics and paper works</p>
          </div>
          <div className="divide-y divide-slate-100">
            {studentTrends.map(({ student, skillScores, latestScore }) => {
              const hasWarning = warnings.some(w => w.student.id === student.id);
              return (
                <button key={student.id} onClick={() => loadStudentDetail(student)}
                  className={`w-full p-4 flex items-center justify-between text-left hover:bg-blue-50/50 transition-colors ${hasWarning ? 'bg-red-50/30' : ''}`}>
                  <div className="flex items-center gap-3">
                    {hasWarning && <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />}
                    <div className="w-9 h-9 rounded-full bg-blue-100 text-brand-navy flex items-center justify-center font-bold text-sm shrink-0">
                      {student.name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-semibold text-brand-slate text-sm">{student.name}</p>
                      <p className="text-[11px] text-slate-400">{student.username}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="hidden sm:flex gap-2">
                      {Object.keys(SKILL_LABELS).map(skill => {
                        const val = skillScores?.[skill] || 0;
                        const pct = (val / 25) * 100;
                        const cell = pct >= 70 ? 'bg-green-100 text-green-800' : pct >= 50 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800';
                        return (
                          <span key={skill} className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${cell}`}>{val}</span>
                        );
                      })}
                    </div>
                    <span className={`text-sm font-bold ${latestScore >= 80 ? 'text-green-600' : latestScore >= 65 ? 'text-amber-600' : 'text-red-600'}`}>
                      {latestScore}
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-300" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {studentTrends.length === 0 && warnings.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <BarChart2 className="w-12 h-12 mx-auto mb-3 text-slate-200" />
          <p className="font-medium">Not enough data yet</p>
          <p className="text-sm">Students need at least 2 graded submissions with skill scores to appear here.</p>
        </div>
      )}
    </div>
  );
}
