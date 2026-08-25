import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, Loader2, ArrowRight } from 'lucide-react';
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
          {(acts[0].date || acts[0].papers > 1) && (
            <p className="text-navy-400 font-semibold mb-1.5">
              {/* On a class chart the point holds every paper for that
                  activity, so say how many it is averaging — a bare
                  percentage looks like one child's mark. */}
              {acts[0].papers > 1 && `${acts[0].papers} papers`}
              {acts[0].papers > 1 && acts[0].date && ' · '}
              {fmtDate(acts[0].date)}
            </p>
          )}
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
  subtitle,
  emptyMessage = 'Complete your activities and get them graded to see your skill progress.',
  // The numbered list under the chart names the outputs behind each point.
  // That is the whole point on one learner's chart; on a pooled class timeline
  // it is one row per submission per student, so a caller can turn it off and
  // leave the tooltip as the way back from a point to its activity.
  showActivityList = true,
  // How many rows of that list to actually draw.
  //
  // The list is a key from a point on the axis back to the activity it came
  // from, and it was drawing every graded activity the learner had — a term's
  // worth is thirty rows of small print under a chart, which buries the recent
  // work the chart is actually about. The most recent few answer "what have I
  // just done?"; the rest belong in the gradebook, which is built for reading a
  // whole term and is where `moreTo` sends them.
  activityListLimit = 5,
  // Where "See all" goes. Different per caller — a learner's own gradebook, or
  // this learner's page in the teacher's — so the component cannot guess it.
  // Without it the list simply truncates and says so, rather than offering a
  // link to nowhere.
  moreTo = null,
  moreLabel = 'See all in the gradebook',
  // Lets a screen with its own card language keep the chart in the same set —
  // Class Insights uses the popped border, the student screens the soft one.
  cardClass = 'tg-card p-5 mb-6',
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
      <div className={cn(cardClass, 'text-center py-10 text-navy-400')}>
        <Loader2 className="w-6 h-6 mx-auto animate-spin" />
      </div>
    );
  }

  if (!data?.hasData) {
    return (
      <div className={cn(cardClass, 'text-center py-8')}>
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
    <div className={cardClass}>
      <h2 className="font-display font-extrabold text-navy-700 mb-1 flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-aqua-600" /> {title}
      </h2>
      {(subtitle || data.mode === 'activity') && (
        <p className="text-xs text-navy-400 mb-3 font-semibold">
          {subtitle || (showActivityList
            ? 'Each point is one graded activity, in order. The numbers match the list below.'
            : 'Each point is one graded activity, in order. Hover a point to see which one.')}
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

      {/* h-72 rather than h-64: the bottom margin below grew to make room for
          the axis caption, and paying for that out of the plot would have
          flattened the very trend the chart is drawn to show. */}
      <div className="w-full h-72">
        <ResponsiveContainer width="100%" height="100%">
          {/* bottom: 28 is the fix for the axis caption sitting on top of the
              legend, and it is worth writing down why, because the number
              looks arbitrary and is not.

              Recharts stacks the space under the plot as
              margin.bottom + XAxis height + legend height, and then draws the
              legend from the container's bottom edge upward. The caption is
              drawn relative to the AXIS (position insideBottom, offset -10), so
              it reaches about 21px past the axis — 10px of offset plus its own
              11px of type. With margin.bottom at 14 there were only 14px before
              the legend began, so the last ~7px of "Activity" landed on the
              legend row.

              28 clears it with room to spare. The legend is deliberately left
              to size itself: on a narrow screen it wraps to two or three lines,
              and Recharts measures that and grows the offset, so the caption
              stays above it. Pinning an explicit legend height would clip.

              Uniform across tabs, not just the summary one that has a legend.
              A per-tab margin would resize the plot area as the teacher clicked
              between skills, which reads as the data moving. */}
          <LineChart data={visibleChartData} margin={{ top: 5, right: 12, left: 0, bottom: 28 }}>
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
      {showActivityList && (() => {
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
        // The most recent few, not the first few. The tail is the work the
        // learner just did and the part of the chart anyone is looking at;
        // opening on activity 1 of 30 shows the oldest marks in the term.
        // Numbering is untouched by the slice — row 26 stays "26" and still
        // points at tick 26 — which is the whole reason the numbers exist.
        const shown = activityListLimit > 0 ? rows.slice(-activityListLimit) : rows;
        const hidden = rows.length - shown.length;
        return (
          <div className="mt-4 pt-4 border-t-2 border-cream-200">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-navy-400 mb-2.5">
              {/* Says it is showing a slice whenever it is. A list headed
                  "30 graded activities" with five rows under it reads as a
                  loading bug. */}
              {activeSkill
                ? hidden > 0
                  ? `Latest ${shown.length} of ${rows.length} scored for ${activeSkill.label}`
                  : `${rows.length} activit${rows.length === 1 ? 'y' : 'ies'} scored for ${activeSkill.label}`
                : hidden > 0
                  ? `Latest ${shown.length} of ${rows.length} graded activities`
                  : `${rows.length} graded activit${rows.length === 1 ? 'y' : 'ies'} in this chart`}
            </p>
            <ul className="space-y-1.5">
              {shown.map((a) => (
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
            {hidden > 0 && (
              moreTo ? (
                <Link to={moreTo}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-extrabold text-royal-600 hover:text-royal-700 hover:underline">
                  {moreLabel}
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              ) : (
                // No destination configured, so say what is missing rather
                // than silently dropping rows off the end of the list.
                <p className="mt-3 text-xs font-semibold text-navy-400">
                  {hidden} earlier activit{hidden === 1 ? 'y is' : 'ies are'} not shown.
                </p>
              )
            )}
          </div>
        );
      })()}
    </div>
  );
}
