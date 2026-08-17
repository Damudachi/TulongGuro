import { School } from 'lucide-react';
import useSchool from '../utils/useSchool';
import { API_URL } from '../config';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

const SIZES = {
  sm: { box: 'w-9 h-9 text-[11px] rounded-xl', icon: 'w-4 h-4' },
  md: { box: 'w-11 h-11 text-sm rounded-2xl', icon: 'w-5 h-5' },
  lg: { box: 'w-14 h-14 text-base rounded-3xl', icon: 'w-6 h-6' },
};

/** Uploads are stored as a relative /uploads path in dev, absolute in the cloud. */
function resolveLogoUrl(logoUrl) {
  if (!logoUrl) return null;
  return logoUrl.startsWith('http') ? logoUrl : `${API_URL}${logoUrl}`;
}

/** Initials fallback, skipping filler words: "Young Builders Schools Inc." -> YB */
function initialsFor(name) {
  return (name || '')
    .replace(/[^A-Za-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(w => !/^(inc|school|schools|of|the|and|national|high)$/i.test(w))
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('');
}

/**
 * The school's mark: its uploaded logo when there is one, otherwise an initials
 * tile tinted with the school's brand colour (or the default palette).
 */
export function SchoolLogo({ name, logoUrl, brandColor, size = 'md', tone = 'light', className }) {
  const { box, icon } = SIZES[size] || SIZES.md;
  const src = resolveLogoUrl(logoUrl);

  if (src) {
    return (
      <div className={cn('flex items-center justify-center shrink-0 overflow-hidden bg-white border', box,
        tone === 'onColor' ? 'border-white/30' : 'border-slate-200', className)}>
        <img src={src} alt={`${name || 'School'} logo`} className="w-full h-full object-contain p-0.5" />
      </div>
    );
  }

  // On a coloured hero the brand colour would clash with the background, so the
  // translucent white treatment wins there.
  const useBrand = brandColor && tone !== 'onColor';
  const style = useBrand
    ? { backgroundColor: `${brandColor}1A`, borderColor: `${brandColor}33`, color: brandColor }
    : undefined;

  return (
    <div
      className={cn('flex items-center justify-center font-extrabold shrink-0 tracking-tight border', box,
        !useBrand && (tone === 'onColor'
          ? 'bg-sheen/20 text-white border-white/30 backdrop-blur-sm'
          : 'bg-royal-50 text-royal-600 border-royal-100'),
        className)}
      style={style}
      title={name || 'School'}
      aria-hidden="true"
    >
      {initialsFor(name) || <School className={icon} />}
    </div>
  );
}

/**
 * School logo + name, for dashboard headers.
 * Renders nothing when the account has no school yet, so unaffiliated
 * legacy accounts don't get an empty placeholder.
 */
export default function SchoolBadge({ size = 'md', tone = 'light', subtitle, className }) {
  const school = useSchool();
  if (!school?.name) return null;

  const nameTone = tone === 'onColor' ? 'text-white' : 'text-brand-slate';
  const subTone = tone === 'onColor' ? 'text-white/70' : 'text-slate-400';

  return (
    <div className={cn('flex items-center gap-3 min-w-0', className)}>
      <SchoolLogo name={school.name} logoUrl={school.logoUrl} brandColor={school.brandColor}
        size={size} tone={tone} />
      <div className="min-w-0">
        <p className={cn('font-bold leading-tight truncate', size === 'sm' ? 'text-sm' : 'text-base', nameTone)}
          style={tone !== 'onColor' && school.brandColor ? { color: school.brandColor } : undefined}>
          {school.name}
        </p>
        {subtitle && (
          <p className={cn('text-[11px] font-medium uppercase tracking-wider truncate', subTone)}>{subtitle}</p>
        )}
      </div>
    </div>
  );
}
