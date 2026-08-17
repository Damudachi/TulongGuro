import { useState, useEffect, useMemo } from 'react';
import { TrendingUp, Loader2 } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Legend, Tooltip } from 'recharts';
import { API_URL, apiFetch } from '../config';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

/**
 * Ticks carry the number only — "Activity 3" becomes "3", "Week 2" becomes "2"
 * — with the axis captioned underneath. Spelling out every tick crowds a phone
 * screen and forces the thinning that hides half the labels; a bare count stays
 * readable at any width and lines up with the numbered list under the chart.
 */
const tickNumber = (s) => String(s ?? '').replace(/^(Activity|Week)\s+/i, '');

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  // Every series carries the same point payload, so the first one has the row.
  const row = payload[0]?.payload || {};
  const acts = row.activities || [];
  return (
    // Text stays in ink tokens; the swatch beside it carries series identity.
    <div className="bg-white border-2 border-cream-200 rounded-2xl shadow-card px-3.5 py-2.5 text-xs max-w-[16rem]">
      <p className="font-extrabold text-navy-700">{label}</p>
      {/* The axis is deliberately just a number, so the tooltip is where the
          activity gets its name back — hovering a dip should answer "which
          one?" without scrolling to the list. */}
      {acts.length === 1 && (
        <>
          <p className="font-bold text-navy-600 leading-snug">{acts[0].title}</p>
          {acts[0].date && <p className="text-navy-400 font-semibold mb-1.5">{fmtDate(acts[0].date)}</p>}
        </>
      )}
      {acts.length > 1 && (
        <p className="text-navy-400 font-semibold mb-1.5">{acts.length} activities</p>
      )}
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
  const [activeTab, setActiveTab] = useState('summary');
  const url = dataUrl || (studentId ? `${API_URL}/api/student/${studentId}/skill-progress` : null);
  // With no url there is nothing to wait for, so this opens straight on the
  // empty message rather than a spinner the first commit would clear.
  const [isLoading, setIsLoading] = useState(() => !!url);

  useEffect(() => {
    if (!url) return;
    apiFetch(url)
      .then(r => r.json())
      .then(d => { if (d.success) setData(d); })
      .catch(() => {}) /* a failed read leaves the empty state, which is what renders */
      .finally(() => setIsLoading(false));
  }, [url]);

  const chartData = useMemo(() => {
    if (!data?.hasData) return [];
    return data.weeks.map((w, i) => {
      const row = { week: w.week, label: w.label, activities: w.activities || [] };
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
        <p className="text-xs text-navy-400 mb-3 font-semibold">
          Each point is one graded activity, in order. The numbers match the list below.
        </p>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button type="button" onClick={() => setActiveTab('summary')}
          className={cn('px-3.5 py-1.5 rounded-full text-xs font-bold border-2 transition-all',
            activeTab === 'summary' ? 'border-brand-chrome bg-brand-chrome text-white' : 'border-cream-300 text-navy-500 hover:border-navy-300')}>
          Summary
        </button>
        {skills.map(s => (
          <button key={s.id} type="button" onClick={() => setActiveTab(s.id)}
            className="px-3.5 py-1.5 rounded-full text-xs font-bold border-2 transition-all flex items-center gap-1.5"
            style={activeTab === s.id
              ? { borderColor: s.color, backgroundColor: s.color, color: 'white' }
              : { borderColor: 'var(--tg-neutral-200, #DDE1EE)', color: 'var(--tg-neutral-500, #5F6B8F)' }}>
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
          <LineChart data={visibleChartData} margin={{ top: 5, right: 12, left: -12, bottom: 14 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--tg-neutral-100, #EDEFF6)" />
            <XAxis dataKey="label" interval={tickInterval} tickFormatter={tickNumber}
              tick={{ fontSize: 11, fill: 'var(--tg-neutral-500, #5F6B8F)' }} axisLine={{ stroke: 'var(--tg-neutral-200, #DDE1EE)' }} tickLine={false}
              label={{
                value: data.mode === 'week' ? 'Week' : 'Activity',
                position: 'insideBottom', offset: -10,
                style: { fontSize: 11, fontWeight: 800, fill: 'var(--tg-neutral-400, #8B95B5)' }
              }} />
            <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11, fill: 'var(--tg-neutral-500, #5F6B8F)' }} axisLine={{ stroke: 'var(--tg-neutral-200, #DDE1EE)' }} tickLine={false} width={40} />
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

      {/* ── What's actually in this line ──
          A skill chart is hard to act on without knowing which outputs produced
          it. On a skill tab this lists only the activities that were scored for
          that skill — an activity whose rubric never touched Punctuation does
          not belong under the Punctuation chart, even though it is in the
          student's history. */}
      {(() => {
        // Number every activity across the whole chart first, then filter. If
        // the filtered rows were numbered 1..n instead, selecting a skill would
        // renumber them and the list would stop agreeing with the axis — the
        // one thing these numbers exist to guarantee.
        let n = 0;
        const rows = chartData
          .flatMap(p => (p.activities || []).map(a => ({ ...a, n: ++n })))
          .filter(a => !activeSkill || (a.skills || []).includes(activeSkill.id));
        if (rows.length === 0) {
          return activeSkill ? (
            <p className="mt-4 pt-4 border-t-2 border-cream-200 text-xs text-navy-400">
              No graded activity has scored {activeSkill.label} yet.
            </p>
          ) : null;
        }
        return (
          <div className="mt-4 pt-4 border-t-2 border-cream-200">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-navy-400 mb-2.5">
              {activeSkill
                ? `${rows.length} activit${rows.length === 1 ? 'y' : 'ies'} scored for ${activeSkill.label}`
                : `${rows.length} graded activit${rows.length === 1 ? 'y' : 'ies'} in this chart`}
            </p>
            <ul className="space-y-1.5">
              {rows.map((a) => (
                <li key={`${a.submissionId || a.activityId}-${a.n}`}
                  className="flex items-center gap-2.5 text-xs">
                  {/* Same number as the point on the axis, so a dip at 3 leads
                      straight to the row marked 3. */}
                  <span className="w-5 h-5 rounded-lg bg-royal-100 text-royal-700 grid place-items-center font-extrabold text-[10px] shrink-0">
                    {a.n}
                  </span>
                  <span className="font-bold text-navy-700 truncate flex-1 min-w-0">{a.title}</span>
                  {a.date && <span className="text-navy-400 font-semibold shrink-0">{fmtDate(a.date)}</span>}
                  {typeof a.percent === 'number' && (
                    <span className="font-extrabold text-navy-600 shrink-0 w-10 text-right">{Math.round(a.percent)}%</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })()}
    </div>
  );
}
