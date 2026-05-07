import { useState, useEffect } from 'react';
import { AlertTriangle, TrendingDown, BarChart2, Users, ChevronDown, ChevronUp, Loader2, ShieldAlert } from 'lucide-react';

const SKILL_LABELS = {
  vocabulary: 'Vocabulary',
  punctuation: 'Punctuation',
  thematicFlow: 'Thematic Flow',
  sentenceStructure: 'Sentence Structure'
};

const SKILL_COLORS = {
  vocabulary: 'bg-purple-500',
  punctuation: 'bg-blue-500',
  thematicFlow: 'bg-amber-500',
  sentenceStructure: 'bg-green-500'
};

const SEVERITY_CONFIG = {
  HIGH: { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-700', badge: 'bg-red-100 text-red-700', icon: '🔴' },
  MEDIUM: { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700', icon: '🟡' }
};

function SkillBar({ label, value, max = 25, colorClass }) {
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
  const [isLoading, setIsLoading] = useState(true);
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return setIsLoading(false);
    fetch(`http://localhost:3000/api/teacher/${user.id}/analytics`)
      .then(r => r.json())
      .then(d => { if (d.success) setData(d); })
      .finally(() => setIsLoading(false));
  }, []);

  const toggleExpand = (id) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-slate-400">
      <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading analytics...
    </div>
  );

  if (!data) return (
    <div className="p-8 text-center text-slate-500">
      <BarChart2 className="w-10 h-10 mx-auto mb-3 text-slate-300" />
      <p>No analytics data available yet. Grade more submissions to see trends.</p>
    </div>
  );

  const { warnings, studentTrends, classAvgSkills, warningCount } = data;

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-8">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-brand-slate">Predictive Analytics</h1>
        <p className="text-slate-500 text-sm mt-1">Early warning system — tracks skill trends across submissions</p>
      </div>

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

      {/* Warning Cards */}
      {warnings.length > 0 && (
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
                      <span className={`text-xs font-bold px-2 py-1 rounded-full ${cfg.badge}`}>
                        {cfg.icon} {topSeverity}
                      </span>
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
                            <span className={`ml-auto font-bold px-2 py-0.5 rounded-full ${SEVERITY_CONFIG[warn.severity].badge}`}>
                              {warn.severity === 'HIGH' ? 'Intervene now' : 'Monitor closely'}
                            </span>
                          </div>
                        </div>
                      ))}
                      <p className="text-xs text-slate-500 italic">
                        💡 Recommended: Schedule a one-on-one reading session focusing on {studentWarns.map(w => SKILL_LABELS[w.skill]).join(', ')}.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Class Average Skill Bars */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-base font-bold text-brand-slate mb-4">Class Skill Averages</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {Object.entries(classAvgSkills).map(([skill, avg]) => (
            <SkillBar key={skill} label={SKILL_LABELS[skill]} value={avg} max={25}
              colorClass={SKILL_COLORS[skill]} />
          ))}
        </div>
      </div>

      {/* Student Skill Heatmap */}
      {studentTrends.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <h2 className="text-base font-bold text-brand-slate">Student Skill Heatmap</h2>
            <p className="text-xs text-slate-500">Latest skill scores per student (0-25). 🔴 Low 🟡 Fair 🟢 Good</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs font-bold text-slate-500 uppercase tracking-wider">
                  <th className="text-left p-3 sticky left-0 bg-slate-50">Student</th>
                  {Object.values(SKILL_LABELS).map(l => <th key={l} className="p-3 text-center whitespace-nowrap">{l}</th>)}
                  <th className="p-3 text-center">Latest Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {studentTrends.map(({ student, skillScores, latestScore, history }) => {
                  const hasWarning = warnings.some(w => w.student.id === student.id);
                  return (
                    <tr key={student.id} className={hasWarning ? 'bg-red-50/40' : 'hover:bg-slate-50'}>
                      <td className="p-3 sticky left-0 bg-inherit">
                        <div className="flex items-center gap-2">
                          {hasWarning && <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                          <div>
                            <p className="font-semibold text-brand-slate text-xs">{student.name}</p>
                            <p className="text-slate-400 text-[10px]">{student.username}</p>
                          </div>
                        </div>
                      </td>
                      {Object.keys(SKILL_LABELS).map(skill => {
                        const val = skillScores?.[skill] || 0;
                        const hist = history.map(h => h?.[skill] || 0);
                        const dropping = hist.length >= 2 && hist[hist.length-1] < hist[0];
                        const pct = (val / 25) * 100;
                        const cell = pct >= 70 ? 'bg-green-100 text-green-800' : pct >= 50 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800';
                        return (
                          <td key={skill} className="p-3 text-center">
                            <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg font-bold text-xs ${cell}`}>
                              {val}/25
                              {dropping && <TrendingDown className="w-3 h-3" />}
                            </div>
                          </td>
                        );
                      })}
                      <td className="p-3 text-center">
                        <span className={`font-extrabold text-sm ${latestScore >= 80 ? 'text-green-600' : latestScore >= 65 ? 'text-amber-600' : 'text-red-600'}`}>
                          {latestScore}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
