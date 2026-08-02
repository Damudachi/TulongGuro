import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) { return twMerge(clsx(inputs)); }

/**
 * The standard header for an in-app screen.
 *
 * Mobile gets a sticky app bar — compact, with a back affordance and room for
 * one action — because a phone screen has no sidebar to say where you are.
 * Desktop gets a roomier inline title block instead, since the sidebar already
 * carries the wayfinding.
 *
 * `actions` renders on both; keep it to one or two controls so the mobile bar
 * doesn't wrap.
 */
export default function PageHeader({
  title,
  subtitle,
  actions,
  back = false,        // true → go back one entry; a string → navigate there
  sticky = true,
  className,
}) {
  const navigate = useNavigate();
  const goBack = () => (typeof back === 'string' ? navigate(back) : navigate(-1));

  return (
    <div className={cn('bg-cream-100', sticky && 'sticky top-0 z-30', className)}>
      {/* ── Mobile app bar ── */}
      <div className="md:hidden flex items-center gap-2 px-3 h-14 bg-white border-b-2 border-cream-200">
        {back && (
          <button
            onClick={goBack}
            aria-label="Go back"
            className="w-10 h-10 -ml-1 grid place-items-center rounded-xl text-navy-600 active:bg-cream-100 shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <h1 className="font-display text-lg font-extrabold text-navy-700 truncate flex-1 min-w-0">
          {title}
        </h1>
        {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
      </div>

      {/* ── Desktop title block ── */}
      <div className="hidden md:flex items-start justify-between gap-4 px-8 pt-8 pb-5">
        <div className="min-w-0">
          {back && (
            <button
              onClick={goBack}
              className="inline-flex items-center gap-1.5 text-sm font-bold text-navy-500 hover:text-navy-700 mb-2"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          )}
          <h1 className="font-display text-3xl font-extrabold text-navy-700 truncate">{title}</h1>
          {subtitle && <p className="text-navy-500 text-sm font-semibold mt-1">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </div>
  );
}

/**
 * Compact metric tile for the strip that usually sits under a PageHeader.
 * Deliberately plain — dashboards stack many of these, so decoration here
 * reads as noise.
 */
export function StatTile({ label, value, icon: Icon, tone = 'text-navy-700', className }) {
  return (
    <div className={cn('bg-white rounded-2xl border-2 border-cream-200 px-4 py-3.5 min-w-0', className)}>
      <div className="flex items-center gap-1.5 mb-1">
        {Icon && <Icon className="w-3.5 h-3.5 text-navy-400 shrink-0" />}
        <p className="text-[10px] uppercase tracking-wider font-extrabold text-navy-400 truncate">{label}</p>
      </div>
      <p className={cn('font-display text-2xl font-extrabold leading-none truncate', tone)}>{value}</p>
    </div>
  );
}
