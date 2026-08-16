import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Eye, Users, X } from 'lucide-react';
import { API_URL, apiFetch } from '../config';
import { pct } from '../utils/grading';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

/**
 * The early-warning alert, surfaced where a teacher already is.
 *
 * Shows sections (blocks) with failing / watch-list student counts rather than
 * individual names — the teacher clicks through to Analytics to see the detail.
 */
export default function EarlyWarningPanel() {
  const [data, setData] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [showWatch, setShowWatch] = useState(false);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return;
    let cancelled = false;
    apiFetch(`${API_URL}/api/teacher/${user.id}/analytics`)
      .then(r => r.json())
      .then(d => { if (!cancelled && d.success) setData(d); })
      .catch(() => { /* the dashboard still works without the alert */ });
    return () => { cancelled = true; };
  }, []);

  if (!data || dismissed) return null;

  const needsSupport = data.needsSupport || [];
  if (needsSupport.length === 0) return null;

  const failing = needsSupport.filter(e => e.severity === 'failing');
  const watch = needsSupport.filter(e => e.severity !== 'failing');
  const passingGrade = data.summary?.passingGrade ?? 75;
  // The server only raises a low average once a learner has this much graded
  // work behind it — said out loud so the count reads as a considered call
  // rather than a verdict off one essay.
  const minGradedForRisk = data.summary?.minGradedForRisk ?? 3;

  // ── Group entries by section ──
  const groupBySection = (entries) => {
    const map = new Map();
    for (const entry of entries) {
      const key = entry.sectionId || '__unknown__';
      if (!map.has(key)) {
        map.set(key, {
          sectionId: entry.sectionId,
          sectionName: entry.sectionName || 'Unassigned',
          students: [],
          totalPercent: 0,
        });
      }
      const group = map.get(key);
      group.students.push(entry);
      group.totalPercent += (entry.avgPercent ?? 0);
    }
    // Compute average per section and sort worst-first.
    return [...map.values()]
      .map(g => ({ ...g, avgPercent: g.students.length ? Math.round(g.totalPercent / g.students.length) : null }))
      .sort((a, b) => (a.avgPercent ?? 100) - (b.avgPercent ?? 100));
  };

  const failingSections = groupBySection(failing);
  const watchSections = groupBySection(watch);

  const SectionRow = ({ section, tone }) => (
    <Link
      to={section.sectionId ? `/teacher/analytics?sectionId=${section.sectionId}` : '/teacher/analytics'}
      className={cn(
        'flex items-center gap-3 p-3 rounded-xl border-2 transition-all hover:-translate-y-0.5',
        tone === 'failing'
          ? 'bg-white border-red-200 hover:border-red-400'
          : 'bg-white border-amber-200 hover:border-amber-400'
      )}
    >
      <div className={cn('w-9 h-9 rounded-xl grid place-items-center shrink-0',
        tone === 'failing' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700')}>
        <Users className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-bold text-sm text-navy-800 truncate">{section.sectionName}</p>
        <p className="text-[11px] text-slate-500 truncate">
          {section.students.length} student{section.students.length === 1 ? '' : 's'}
          {tone === 'failing' ? ' below the passing grade' : ' trending down'}
        </p>
      </div>
      {section.avgPercent !== null && (
        <span className={cn('text-sm font-extrabold shrink-0',
          tone === 'failing' ? 'text-red-600' : 'text-amber-600')}>
          ~{pct(section.avgPercent)}%
        </span>
      )}
      <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
    </Link>
  );

  return (
    <section className={cn('mb-6 rounded-3xl border-2 p-5',
      failing.length > 0 ? 'bg-red-50/60 border-red-200' : 'bg-amber-50/60 border-amber-200')}>
      <div className="flex items-start gap-3 mb-4">
        <div className={cn('p-2 rounded-xl shrink-0',
          failing.length > 0 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600')}>
          {failing.length > 0 ? <AlertTriangle className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-extrabold text-navy-800">
            {failing.length > 0
              ? `${failing.length} student${failing.length === 1 ? '' : 's'} below ${passingGrade}%`
              : `${watch.length} student${watch.length === 1 ? '' : 's'} to keep an eye on`}
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            {failing.length > 0
              ? `Averaging below the passing grade over ${minGradedForRisk} or more graded activities. A check-in now is easier than a remedial later.`
              : 'Still passing, but their recent scores have been sliding.'}
          </p>
        </div>
        <button type="button" onClick={() => setDismissed(true)}
          title="Hide until next visit" className="text-slate-300 hover:text-slate-500 shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-2">
        {failingSections.map(section => (
          <SectionRow key={section.sectionId || section.sectionName} section={section} tone="failing" />
        ))}

        {/* Watch-list stays collapsed when there are failing students, so the
            urgent list is not diluted by the merely-worth-watching. */}
        {watchSections.length > 0 && failingSections.length > 0 && !showWatch && (
          <button type="button" onClick={() => setShowWatch(true)}
            className="text-xs font-bold text-amber-700 hover:text-amber-900 pl-1 pt-1">
            Also watching {watch.length} student{watch.length === 1 ? '' : 's'} in {watchSections.length} section{watchSections.length === 1 ? '' : 's'} with a downward trend →
          </button>
        )}
        {(showWatch || failingSections.length === 0) && watchSections.map(section => (
          <SectionRow key={section.sectionId || section.sectionName} section={section} tone="watch" />
        ))}
      </div>

      <Link to="/teacher/analytics"
        className="inline-flex items-center gap-1.5 mt-4 text-xs font-extrabold text-royal-600 hover:text-royal-800">
        <AlertTriangle className="w-3.5 h-3.5" /> See the full breakdown in Analytics
      </Link>
    </section>
  );
}
