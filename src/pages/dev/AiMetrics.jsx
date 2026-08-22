import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import {
  Gauge, Loader2, RefreshCw, AlertTriangle, Wifi, WifiOff,
} from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { bandsFor } from '../../utils/grading';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

/**
 * Developer-only live view of what server/scripts/export-grading-observations.js
 * already computes offline: AI processing time (AiRequestLog) and grading
 * accuracy (GradingAuditLog), both aggregate-only — no student, submission or
 * school ever reaches this page.
 *
 * Not part of the school-facing app: no layout, no nav, no user account
 * behind it. Same shape as PlatformApprovals — a shared server key typed in
 * once and held in sessionStorage so it dies with the tab.
 */
const KEY_STORAGE = 'tg_dev_key';

const RANGES = [
  { key: '1h', label: 'Last hour', hours: 1 },
  { key: '24h', label: 'Last 24h', hours: 24 },
  { key: '7d', label: 'Last 7 days', hours: 168 },
];

// Fixed order, one hue per purpose — never reassigned when a purpose is
// filtered out, and never reused for the ok/fail status pair below so the two
// encodings never collide when they appear on the same screen.
const PURPOSE_COLORS = {
  GRADING: 'var(--tg-navy-500, #1B3379)',
  EXTRACT: 'var(--tg-sky-500, #4A9BC9)',
  PARSE: 'var(--tg-lilac-500, #9D5FBD)',
  ASSIST: 'var(--tg-magenta-500, #EE2F80)',
  SELFCHECK: 'var(--tg-lime-500, #AAC029)',
  OTHER: 'var(--tg-neutral-400, #8B95B5)',
};
const purposeColor = (p) => PURPOSE_COLORS[p] || PURPOSE_COLORS.OTHER;

const OK_COLOR = 'var(--tg-aqua-500, #3BB8B4)';
const FAIL_COLOR = 'var(--tg-red-500, #EF4444)';
const GRID_COLOR = 'var(--tg-neutral-100, #EDEFF6)';
const AXIS_COLOR = 'var(--tg-neutral-200, #DDE1EE)';
const TICK_COLOR = 'var(--tg-neutral-500, #5F6B8F)';

const fmtMs = (ms) => (ms === null || ms === undefined) ? '—' : ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
const fmtPct = (n) => (n === null || n === undefined) ? '—' : `${Math.round(n * 100)}%`;
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtHour = (iso) => new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', hour12: true });

function StatTile({ label, value, hint, tone = 'text-navy-700' }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={cn('text-2xl font-extrabold mt-1 tabular-nums', tone)}>{value}</p>
      {hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}

function Card({ title, subtitle, children, className }) {
  return (
    <section className={cn('bg-white rounded-2xl border border-slate-200 p-5', className)}>
      {title && <h2 className="text-sm font-bold text-slate-900">{title}</h2>}
      {subtitle && <p className="text-xs text-slate-400 mb-3">{subtitle}</p>}
      {children}
    </section>
  );
}

function LatencyTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="font-bold text-slate-900">{fmtHour(label)}</p>
      <p className="text-slate-600">p50 latency: <span className="font-bold">{fmtMs(row.p50)}</span></p>
      <p className="text-slate-600">{row.count} request{row.count === 1 ? '' : 's'}{row.failed > 0 && `, ${row.failed} failed`}</p>
    </div>
  );
}

function VolumeTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="font-bold text-slate-900">{fmtHour(label)}</p>
      <p className="text-slate-600">OK: <span className="font-bold" style={{ color: OK_COLOR }}>{row.count - row.failed}</span></p>
      <p className="text-slate-600">Failed: <span className="font-bold" style={{ color: FAIL_COLOR }}>{row.failed}</span></p>
    </div>
  );
}

const OUTCOME_BADGE = {
  OK: 'bg-aqua-100 text-aqua-800',
  QUOTA: 'bg-amber-100 text-amber-800',
  DAILY_QUOTA: 'bg-amber-100 text-amber-800',
  TRANSIENT: 'bg-slate-200 text-slate-600',
  BAD_IMAGE: 'bg-magenta-100 text-magenta-800',
  ERROR: 'bg-red-100 text-red-700',
};

function RequestRow({ row }) {
  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="py-1.5 pr-3 text-slate-400 whitespace-nowrap">{fmtTime(row.createdAt)}</td>
      <td className="py-1.5 pr-3">
        <span className="inline-flex items-center gap-1.5 font-bold text-slate-700">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: purposeColor(row.purpose) }} />
          {row.purpose}
        </span>
      </td>
      <td className="py-1.5 pr-3 text-slate-500 truncate max-w-[9rem]" title={row.model || ''}>{row.model || '—'}</td>
      <td className="py-1.5 pr-3 text-slate-400">{row.attempt > 0 ? `retry ${row.attempt}` : ''}</td>
      <td className="py-1.5 pr-3 font-bold text-slate-700 whitespace-nowrap">{fmtMs(row.latencyMs)}</td>
      <td className="py-1.5 pr-3">
        <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold', OUTCOME_BADGE[row.outcome] || 'bg-slate-200 text-slate-600')}>
          {row.outcome}
        </span>
      </td>
      <td className="py-1.5 text-slate-400 truncate max-w-[14rem]" title={row.detail || ''}>{row.detail || ''}</td>
    </tr>
  );
}

export default function AiMetrics() {
  const [key, setKey] = useState(() => sessionStorage.getItem(KEY_STORAGE) || '');
  const [keyInput, setKeyInput] = useState('');
  const [range, setRange] = useState('24h');
  const [summary, setSummary] = useState(null);
  const [accuracy, setAccuracy] = useState(null);
  const [liveRows, setLiveRows] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [connState, setConnState] = useState('connecting'); // connecting | live | reconnecting

  const liveKeyRef = useRef(0);
  const audioDebounceRef = useRef(null);
  // The SSE connection is opened once per key (see the effect below, which
  // deliberately does not reconnect on every range change). Its debounced
  // 'audit' handler reads this ref rather than the closed-over `range`, or a
  // range switch after the connection opened would keep refetching the range
  // selected at connect time and silently mislabel it under the new tab.
  const rangeRef = useRef(range);
  useEffect(() => { rangeRef.current = range; }, [range]);

  const fetchDev = useCallback((path) =>
    apiFetch(`${API_URL}/api/dev/ai-metrics${path}`, { headers: { 'x-dev-key': key } }), [key]);

  const forgetKey = useCallback(() => {
    sessionStorage.removeItem(KEY_STORAGE);
    setKey('');
  }, []);

  const load = useCallback(async () => {
    if (!key) return;
    setIsLoading(true);
    setError('');
    try {
      const [summaryRes, accuracyRes, recentRes] = await Promise.all([
        fetchDev(`/summary?since=${range}`).then(r => r.json()),
        fetchDev(`/accuracy?since=${range}`).then(r => r.json()),
        fetchDev('/recent?limit=100').then(r => r.json()),
      ]);
      if (!summaryRes.success || !accuracyRes.success || !recentRes.success) {
        const bad = [summaryRes, accuracyRes, recentRes].find(r => !r.success);
        setError(bad?.error || 'Could not load metrics.');
        if ([summaryRes, accuracyRes, recentRes].some(r => r.error && /not authoris|not configured/i.test(r.error))) {
          forgetKey();
        }
        return;
      }
      setSummary(summaryRes);
      setAccuracy(accuracyRes);
      setLiveRows(recentRes.rows.map(r => ({ ...r, _key: r.id })));
    } catch {
      setError('Network error. Is the API reachable?');
    } finally {
      setIsLoading(false);
    }
  }, [key, range, fetchDev, forgetKey]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- flipping the loading flag ahead of an async read; the rule's alternative is a data-fetching library this app doesn't use
  useEffect(() => { load(); }, [load]);

  // A slow poll under the SSE stream: percentile buckets shift with the hour
  // regardless of whether a new request arrives, and this is the fallback if
  // the stream silently stalls despite its heartbeat.
  useEffect(() => {
    if (!key) return;
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [key, load]);

  // ── Live feed ──
  useEffect(() => {
    if (!key) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting the badge ahead of a new EventSource connecting; there's no external event to hang this on until onopen/onerror fire
    setConnState('connecting');
    const es = new EventSource(`${API_URL}/api/dev/ai-metrics/stream?key=${encodeURIComponent(key)}`);

    es.onopen = () => setConnState('live');
    es.onerror = () => setConnState('reconnecting'); // EventSource retries on its own

    es.onmessage = (evt) => {
      let payload;
      try { payload = JSON.parse(evt.data); } catch { return; }

      if (payload.type === 'ai_request') {
        liveKeyRef.current += 1;
        setLiveRows(prev => [{ ...payload, _key: `live-${liveKeyRef.current}` }, ...prev].slice(0, 200));
      } else if (payload.type === 'audit') {
        // A teacher decision just landed — refresh the accuracy aggregate
        // shortly after, debounced so a burst of validations in one sitting
        // doesn't trigger a refetch per event.
        clearTimeout(audioDebounceRef.current);
        audioDebounceRef.current = setTimeout(() => {
          fetchDev(`/accuracy?since=${rangeRef.current}`).then(r => r.json()).then(d => { if (d.success) setAccuracy(d); }).catch(() => {});
        }, 1500);
      }
    };

    return () => { es.close(); clearTimeout(audioDebounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `range`/`fetchDev` are read inside the debounce closure, not deps of the connection itself; re-subscribing per keystroke-adjacent state would drop in-flight rows
  }, [key]);

  // ── Key gate ──
  if (!key) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <form
          onSubmit={e => {
            e.preventDefault();
            const trimmed = keyInput.trim();
            if (!trimmed) return;
            sessionStorage.setItem(KEY_STORAGE, trimmed);
            setKey(trimmed);
          }}
          className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-sm p-6"
        >
          <div className="w-11 h-11 rounded-xl bg-ink-900 text-white grid place-items-center mb-4">
            <Gauge className="w-5 h-5" />
          </div>
          <h1 className="text-lg font-bold text-slate-900 mb-1">AI metrics</h1>
          <p className="text-sm text-slate-500 mb-5">
            Developer only. Enter the dev key from the server environment.
          </p>
          <input
            type="password"
            autoFocus
            value={keyInput}
            onChange={e => setKeyInput(e.target.value)}
            placeholder="DEV_ACCESS_KEY"
            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-slate-900 mb-3"
          />
          {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
          <button type="submit" disabled={!keyInput.trim()}
            className="w-full py-2.5 rounded-lg bg-ink-900 text-white font-bold text-sm hover:bg-ink-800 disabled:opacity-40">
            Unlock
          </button>
        </form>
      </div>
    );
  }

  const rangeHours = RANGES.find(r => r.key === range)?.hours || 24;
  const reqPerHr = summary ? Math.round((summary.totalRequests / rangeHours) * 10) / 10 : null;
  const failRate = summary && summary.totalRequests ? summary.totalFailed / summary.totalRequests : null;
  const ladder = bandsFor(); // key -> label/chip only; the numeric ladder doesn't apply across schools

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Gauge className="w-6 h-6" /> AI metrics
            </h1>
            <p className="text-slate-500 text-sm mt-0.5">
              Processing time and grading accuracy. Aggregate only — no student or paper ever reaches this page.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold',
              connState === 'live' ? 'bg-aqua-100 text-aqua-800' : 'bg-amber-100 text-amber-800')}>
              {connState === 'live' ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              {connState === 'live' ? 'Live' : connState === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
            </span>
            <button onClick={forgetKey}
              className="text-xs font-bold text-slate-500 hover:text-slate-800 underline shrink-0">
              Lock
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-5 flex-wrap">
          {RANGES.map(r => (
            <button key={r.key} onClick={() => setRange(r.key)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-bold transition-colors',
                range === r.key ? 'bg-ink-900 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50')}>
              {r.label}
            </button>
          ))}
          <button onClick={load} title="Refresh now"
            className="ml-auto p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-50">
            <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
          </button>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
          </div>
        )}

        {isLoading && !summary ? (
          <div className="flex items-center justify-center h-40 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
          </div>
        ) : summary && (
          <>
            {/* ── Processing time ── */}
            <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-400 mb-2">Processing time</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
              <StatTile label="p50 latency" value={fmtMs(summary.overall.p50)} />
              <StatTile label="p95 latency" value={fmtMs(summary.overall.p95)} />
              <StatTile label="Max latency" value={fmtMs(summary.overall.max)} />
              <StatTile label="Requests / hr" value={reqPerHr ?? '—'} />
              <StatTile label="Failure rate" value={fmtPct(failRate)}
                tone={failRate > 0.1 ? 'text-red-600' : 'text-navy-700'} hint={`${summary.totalFailed} of ${summary.totalRequests}`} />
            </div>

            {summary.totalRequests === 0 ? (
              <Card className="mb-6 text-center py-10 text-slate-400">
                No AI requests logged in this window yet.
              </Card>
            ) : (
              <div className="grid md:grid-cols-2 gap-4 mb-4">
                <Card title="Latency trend" subtitle="p50 per hour">
                  <div className="w-full h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={summary.series} margin={{ top: 5, right: 12, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
                        <XAxis dataKey="hour" tickFormatter={fmtHour} tick={{ fontSize: 11, fill: TICK_COLOR }}
                          axisLine={{ stroke: AXIS_COLOR }} tickLine={false} minTickGap={24} />
                        <YAxis tickFormatter={fmtMs} tick={{ fontSize: 11, fill: TICK_COLOR }}
                          axisLine={{ stroke: AXIS_COLOR }} tickLine={false} width={48} />
                        <Tooltip content={<LatencyTooltip />} />
                        <Line type="monotone" dataKey="p50" stroke="var(--tg-navy-500, #1B3379)" strokeWidth={2.5} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                <Card title="Volume & reliability" subtitle="Requests per hour, failed in red">
                  <div className="w-full h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={summary.series} margin={{ top: 5, right: 12, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
                        <XAxis dataKey="hour" tickFormatter={fmtHour} tick={{ fontSize: 11, fill: TICK_COLOR }}
                          axisLine={{ stroke: AXIS_COLOR }} tickLine={false} minTickGap={24} />
                        <YAxis tick={{ fontSize: 11, fill: TICK_COLOR }} axisLine={{ stroke: AXIS_COLOR }} tickLine={false} width={32} allowDecimals={false} />
                        <Tooltip content={<VolumeTooltip />} />
                        <Bar dataKey={(d) => d.count - d.failed} name="OK" stackId="v" fill={OK_COLOR} radius={[0, 0, 0, 0]} />
                        <Bar dataKey="failed" name="Failed" stackId="v" fill={FAIL_COLOR} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              </div>
            )}

            {summary.totalRequests > 0 && (
              <div className="grid md:grid-cols-2 gap-4 mb-6">
                <Card title="By purpose">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-slate-400 font-bold">
                          <th className="pb-1.5 pr-2">Purpose</th>
                          <th className="pb-1.5 pr-2">Count</th>
                          <th className="pb-1.5 pr-2">Failed</th>
                          <th className="pb-1.5 pr-2">p50</th>
                          <th className="pb-1.5">p95</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.byPurpose.sort((a, b) => b.count - a.count).map(p => (
                          <tr key={p.purpose} className="border-t border-slate-100">
                            <td className="py-1.5 pr-2 font-bold text-slate-700">
                              <span className="inline-flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: purposeColor(p.purpose) }} />
                                {p.purpose}
                              </span>
                            </td>
                            <td className="py-1.5 pr-2 text-slate-600">{p.count}</td>
                            <td className="py-1.5 pr-2 text-slate-600">{p.failed}</td>
                            <td className="py-1.5 pr-2 text-slate-600">{fmtMs(p.p50)}</td>
                            <td className="py-1.5 text-slate-600">{fmtMs(p.p95)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>

                <Card title="By model">
                  {summary.byModel.length === 0 ? (
                    <p className="text-sm text-slate-400 py-2">No model label recorded in this window.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-slate-400 font-bold">
                            <th className="pb-1.5 pr-2">Model</th>
                            <th className="pb-1.5 pr-2">Count</th>
                            <th className="pb-1.5 pr-2">Failed</th>
                            <th className="pb-1.5 pr-2">p50</th>
                            <th className="pb-1.5">p95</th>
                          </tr>
                        </thead>
                        <tbody>
                          {summary.byModel.sort((a, b) => b.count - a.count).map(m => (
                            <tr key={m.model} className="border-t border-slate-100">
                              <td className="py-1.5 pr-2 font-bold text-slate-700 truncate max-w-[10rem]" title={m.model}>{m.model}</td>
                              <td className="py-1.5 pr-2 text-slate-600">{m.count}</td>
                              <td className="py-1.5 pr-2 text-slate-600">{m.failed}</td>
                              <td className="py-1.5 pr-2 text-slate-600">{fmtMs(m.p50)}</td>
                              <td className="py-1.5 text-slate-600">{fmtMs(m.p95)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </div>
            )}

            <Card title="Live requests" subtitle="Newest first — streams in as grading, extraction and assist calls happen" className="mb-6">
              {liveRows.length === 0 ? (
                <p className="text-sm text-slate-400 py-2">Nothing yet.</p>
              ) : (
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-white">
                      <tr className="text-left text-slate-400 font-bold">
                        <th className="pb-1.5 pr-3">Time</th>
                        <th className="pb-1.5 pr-3">Purpose</th>
                        <th className="pb-1.5 pr-3">Model</th>
                        <th className="pb-1.5 pr-3"></th>
                        <th className="pb-1.5 pr-3">Latency</th>
                        <th className="pb-1.5 pr-3">Outcome</th>
                        <th className="pb-1.5">Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {liveRows.slice(0, 100).map(row => <RequestRow key={row._key} row={row} />)}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* ── Grading accuracy ── */}
            <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-400 mb-2">Grading accuracy</h2>
            {!accuracy || accuracy.pairedPapers === 0 ? (
              <Card className="text-center py-10 text-slate-400">
                No paper has both an AI draft and a teacher decision in this window yet.
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <StatTile label="Paired papers" value={accuracy.pairedPapers} hint={`${accuracy.released} released`} />
                  <StatTile label="Score edited" value={fmtPct(accuracy.scoreEditedRate)}
                    hint={`${accuracy.scoreEdited} of ${accuracy.pairedPapers}`} />
                  <StatTile label="Mean |Δ|" value={`${accuracy.meanAbsDelta?.toFixed(1) ?? '—'} pts`} />
                  <StatTile label="Median |Δ|" value={`${accuracy.medianAbsDelta?.toFixed(1) ?? '—'} pts`} />
                </div>

                <Card title="By descriptor band" subtitle="Teacher-assigned band, at the moment of validation">
                  {(() => {
                    const total = accuracy.bands.reduce((a, b) => a + b.support, 0) || 1;
                    return (
                      <>
                        <div className="flex h-3 rounded-full overflow-hidden mb-3">
                          {accuracy.bands.map(b => {
                            const meta = ladder.find(l => l.key === b.band);
                            return (
                              <div key={b.band} className={meta?.bar || 'bg-slate-300'}
                                style={{ width: `${(b.support / total) * 100}%` }} />
                            );
                          })}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-4">
                          {accuracy.bands.map(b => {
                            const meta = ladder.find(l => l.key === b.band);
                            return (
                              <span key={b.band} className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
                                <span className={cn('w-2.5 h-2.5 rounded-full', meta?.dot || 'bg-slate-300')} />
                                {meta?.label || b.band} · {b.support} · mean |Δ| {b.meanAbsDelta.toFixed(1)}
                              </span>
                            );
                          })}
                        </div>
                      </>
                    );
                  })()}
                </Card>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
