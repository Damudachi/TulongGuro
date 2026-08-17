import { useSyncExternalStore } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import {
  subscribeToTheme, getThemePreference, setThemePreference,
} from '../utils/theme';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

const OPTIONS = [
  { value: 'light',  label: 'Light',  icon: Sun },
  { value: 'dark',   label: 'Dark',   icon: Moon },
  // Third because it is the default, and a default reads as the fallback at the
  // end of a list rather than the first thing being proposed.
  { value: 'system', label: 'Auto',   icon: Monitor },
];

/**
 * Light / Dark / Auto, as a segmented control.
 *
 * `useSyncExternalStore` rather than useState-plus-useEffect: the preference
 * lives in a module store outside React (index.html sets the theme before React
 * exists, and three layouts read it without a shared provider), and this is the
 * hook built for exactly that. It also means no setState-in-an-effect, which
 * this codebase's lint rules refuse.
 *
 * Three options and not a switch, because "follow my phone" is a real answer
 * and a two-state toggle cannot express it — flipping a switch to light at noon
 * would silently opt the user out of their phone going dark at night.
 *
 * @param compact  the sidebar variant: icons only, no heading.
 */
export default function ThemeToggle({ compact = false }) {
  const preference = useSyncExternalStore(subscribeToTheme, getThemePreference, () => 'system');

  if (compact) {
    return (
      <div role="radiogroup" aria-label="Colour theme" className="flex items-stretch gap-1 p-1 rounded-2xl bg-sheen/10">
        {OPTIONS.map(({ value, label, icon: Icon }) => {
          const active = preference === value;
          return (
            <button key={value} type="button" role="radio" aria-checked={active} aria-label={label}
              title={label}
              onClick={() => setThemePreference(value)}
              className={cn(
                'flex-1 grid place-items-center rounded-xl py-2 transition-colors min-h-9',
                active ? 'bg-sheen/25 text-white' : 'text-white/55 hover:text-white hover:bg-sheen/10'
              )}>
              <Icon className="w-4 h-4" />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm font-bold text-navy-700 mb-1">Appearance</p>
      <p className="text-xs text-navy-400 mb-3">
        Auto follows your phone or computer, switching over on its own at night.
      </p>
      <div role="radiogroup" aria-label="Colour theme"
        className="grid grid-cols-3 gap-2 p-1 rounded-2xl bg-cream-100 border border-cream-200">
        {OPTIONS.map(({ value, label, icon: Icon }) => {
          const active = preference === value;
          return (
            <button key={value} type="button" role="radio" aria-checked={active}
              onClick={() => setThemePreference(value)}
              className={cn(
                'flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold transition-all',
                active
                  ? 'bg-white text-navy-700 shadow-card'
                  : 'text-navy-400 hover:text-navy-600'
              )}>
              <Icon className="w-4 h-4" /> {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
