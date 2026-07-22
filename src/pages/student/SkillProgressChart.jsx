import { useState, useEffect, useMemo } from 'react';
import { TrendingUp, Loader2 } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Legend, Tooltip } from 'recharts';
import { API_URL } from '../../config';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-bold text-brand-slate mb-1">{label}</p>
      {payload.filter(p => p.value !== null && p.value !== undefined).map(p => (
        <p key={p.dataKey} className="flex items-center gap-1.5" style={{ color: p.color }}>
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="font-medium">{p.name}: {p.value}%</span>
        </p>
      ))}
    </div>
  );
}

export default function SkillProgressChart({ studentId }) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('summary');

  useEffect(() => {
    if (!studentId) { setIsLoading(false); return; }
    fetch(`${API_URL}/api/student/${studentId}/skill-progress`)
      .then(r => r.json())
      .then(d => { if (d.success) setData(d); })
      .finally(() => setIsLoading(false));
  }, [studentId]);

  const chartData = useMemo(() => {
    if (!data?.hasData) return [];
    return data.weeks.map((w, i) => {
      const row = { week: w.week, label: w.label };
      data.skills.forEach(s => { row[s.id] = data.series[s.id]?.[i]?.pct ?? null; });
      return row;
    });
  }, [data]);

  const currentMastery = (skillId) => {
    for (let i = chartData.length - 1; i >= 0; i--) {
      if (chartData[i][skillId] !== null && chartData[i][skillId] !== undefined) return chartData[i][skillId];
    }
    return null;
  };

  if (isLoading) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-6 shadow-sm text-center py-10 text-slate-400">
        <Loader2 className="w-6 h-6 mx-auto animate-spin" />
      </div>
    );
  }

  if (!data?.hasData) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-6 shadow-sm text-center py-6 text-slate-400">
        <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-30 text-slate-400" />
        <p className="text-sm font-medium">No Skill Progress Data Available</p>
        <p className="text-xs mt-1">Complete your activities and get them graded to see your skill progress.</p>
      </div>
    );
  }

  const { skills } = data;
  const activeSkill = activeTab === 'summary' ? null : skills.find(s => s.id === activeTab);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-6 shadow-sm">
      <h2 className="text-sm font-bold text-brand-slate mb-4 flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-brand-green" /> Your Skill Progress
      </h2>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button type="button" onClick={() => setActiveTab('summary')}
          className={cn('px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all',
            activeTab === 'summary' ? 'border-brand-navy bg-brand-navy text-white' : 'border-slate-200 text-slate-600 hover:border-brand-navy/50')}>
          Summary
        </button>
        {skills.map(s => (
          <button key={s.id} type="button" onClick={() => setActiveTab(s.id)}
            className={cn('px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all flex items-center gap-1.5')}
            style={activeTab === s.id
              ? { borderColor: s.color, backgroundColor: s.color, color: 'white' }
              : { borderColor: '#e2e8f0', color: '#475569' }}>
            <span className="w-2 h-2 rounded-full" style={{ background: activeTab === s.id ? 'white' : s.color }} />
            {s.label}
          </button>
        ))}
      </div>

      {activeSkill && (
        <div className="mb-3 flex items-baseline gap-2">
          <span className="text-2xl font-extrabold" style={{ color: activeSkill.color }}>
            {currentMastery(activeSkill.id) ?? '—'}{currentMastery(activeSkill.id) !== null ? '%' : ''}
          </span>
          <span className="text-xs text-slate-400 font-medium">current mastery</span>
        </div>
      )}

      <div className="w-full h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
            <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} width={40} />
            <Tooltip content={<CustomTooltip />} />
            {activeTab === 'summary' ? (
              <>
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                {skills.map(s => (
                  <Line key={s.id} type="monotone" dataKey={s.id} name={s.label} stroke={s.color}
                    strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
                ))}
              </>
            ) : (
              <Line type="monotone" dataKey={activeSkill.id} name={activeSkill.label} stroke={activeSkill.color}
                strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} connectNulls />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
