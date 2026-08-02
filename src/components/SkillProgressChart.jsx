import { useState, useEffect, useMemo } from 'react';
import { TrendingUp, Loader2 } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Legend, Tooltip } from 'recharts';
import { API_URL } from '../config';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    // Text stays in ink tokens; the swatch beside it carries series identity.
    <div className="bg-white border-2 border-cream-200 rounded-2xl shadow-card px-3.5 py-2.5 text-xs">
      <p className="font-extrabold text-navy-700 mb-1.5">{label}</p>
      {payload.filter(p => p.value !== null && p.value !== undefined).map(p => (
        <p key={p.dataKey} className="flex items-center gap-1.5 text-navy-600">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="font-bold">{p.name}: {p.value}%</span>
        </p>
      ))}
    </div>
  );
}

export default function SkillProgressChart({
  studentId,
  dataUrl,
  title = 'Your Skill Progress',
  emptyMessage = 'Complete your activities and get them graded to see your skill progress.'
}) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('summary');
  const url = dataUrl || (studentId ? `${API_URL}/api/student/${studentId}/skill-progress` : null);

  useEffect(() => {
    if (!url) { setIsLoading(false); return; }
    setIsLoading(true);
    fetch(url)
      .then(r => r.json())
      .then(d => { if (d.success) setData(d); })
      .finally(() => setIsLoading(false));
  }, [url]);

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
      <div className="tg-card p-5 mb-6 text-center py-10 text-navy-400">
        <Loader2 className="w-6 h-6 mx-auto animate-spin" />
      </div>
    );
  }

  if (!data?.hasData) {
    return (
      <div className="tg-card p-5 mb-6 text-center py-8">
        <TrendingUp className="w-8 h-8 mx-auto mb-2 text-navy-300" />
        <p className="text-sm font-bold text-navy-600">No Skill Progress Data Available</p>
        <p className="text-xs mt-1 text-navy-400">{emptyMessage}</p>
      </div>
    );
  }

  const { skills } = data;
  const activeSkill = activeTab === 'summary' ? null : skills.find(s => s.id === activeTab);

  // On an individual skill's tab, trim any leading points before that skill's
  // first real value — otherwise a skill assessed later than the others would
  // start with blank space instead of flush against the left edge of its own chart.
  let visibleChartData = chartData;
  if (activeSkill) {
    const firstIdx = chartData.findIndex(row => row[activeSkill.id] !== null && row[activeSkill.id] !== undefined);
    if (firstIdx > 0) visibleChartData = chartData.slice(firstIdx);
  }

  // Thin x-axis tick labels once there are many points, so the axis stays
  // readable — every point is still plotted, just not every point gets a label.
  const tickInterval = Math.max(0, Math.floor(visibleChartData.length / 8));

  return (
    <div className="tg-card p-5 mb-6">
      <h2 className="font-display font-extrabold text-navy-700 mb-1 flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-aqua-600" /> {title}
      </h2>
      {data.mode === 'activity' && (
        <p className="text-xs text-navy-400 mb-3 font-semibold">Showing progress per graded activity — switches to a weekly view once there's a few more weeks of history.</p>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button type="button" onClick={() => setActiveTab('summary')}
          className={cn('px-3.5 py-1.5 rounded-full text-xs font-bold border-2 transition-all',
            activeTab === 'summary' ? 'border-navy-700 bg-navy-700 text-white' : 'border-cream-300 text-navy-500 hover:border-navy-300')}>
          Summary
        </button>
        {skills.map(s => (
          <button key={s.id} type="button" onClick={() => setActiveTab(s.id)}
            className="px-3.5 py-1.5 rounded-full text-xs font-bold border-2 transition-all flex items-center gap-1.5"
            style={activeTab === s.id
              ? { borderColor: s.color, backgroundColor: s.color, color: 'white' }
              : { borderColor: '#DDE1EE', color: '#5F6B8F' }}>
            <span className="w-2 h-2 rounded-full" style={{ background: activeTab === s.id ? 'white' : s.color }} />
            {s.label}
          </button>
        ))}
      </div>

      {activeSkill && (
        <div className="mb-3 flex items-baseline gap-2">
          <span className="font-display text-3xl font-extrabold" style={{ color: activeSkill.color }}>
            {currentMastery(activeSkill.id) ?? '—'}{currentMastery(activeSkill.id) !== null ? '%' : ''}
          </span>
          <span className="text-xs text-navy-400 font-bold">current mastery</span>
        </div>
      )}

      <div className="w-full h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={visibleChartData} margin={{ top: 5, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EDEFF6" />
            <XAxis dataKey="label" interval={tickInterval} tick={{ fontSize: 11, fill: '#5F6B8F' }} axisLine={{ stroke: '#DDE1EE' }} tickLine={false} />
            <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11, fill: '#5F6B8F' }} axisLine={{ stroke: '#DDE1EE' }} tickLine={false} width={40} />
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
