import {
  Award, Trophy, Medal, Star, Crown, Rocket, Flame, Heart,
  Sparkles, Target, Zap, BookOpen, GraduationCap, ThumbsUp, Smile,
} from 'lucide-react';

/**
 * How a teacher-authored badge is drawn — the one place that turns the icon and
 * colour *keys* stored on TeacherBadge into an actual icon and actual classes.
 *
 * Shared by the teacher's badge library, the Activity Builder's preview and the
 * learner's trophy room, so the badge a teacher designs is pixel-for-pixel the
 * one the child is shown. When two screens owned separate tables they drifted,
 * and the drift is invisible to whoever wrote the badge.
 *
 * The keys mirror BADGE_ICONS / BADGE_COLORS in server/badges.js, which is what
 * stores them. Neither side treats an unknown key as an error: the server
 * normalises on write and `badgeLook` falls back on read, so a key added on one
 * side before the other renders a plain award badge instead of a blank tile.
 *
 * Deliberately a plain module and not a component. Callers pull `.icon` off the
 * returned object rather than calling a function that hands one back, which is
 * both what React's lint rules ask for and what the trophy room already did
 * with its own built-in badge table.
 */

const ICONS = {
  award: Award,
  trophy: Trophy,
  medal: Medal,
  star: Star,
  crown: Crown,
  rocket: Rocket,
  flame: Flame,
  heart: Heart,
  sparkles: Sparkles,
  target: Target,
  zap: Zap,
  book: BookOpen,
  'graduation-cap': GraduationCap,
  'thumbs-up': ThumbsUp,
  smile: Smile,
};

/**
 * Full class strings, never composed at runtime.
 *
 * Tailwind scans the source for literal class names, so `bg-${color}-500` would
 * be purged out of the build and every badge would render unstyled in
 * production while looking perfect in dev. Spelling each one out is what makes
 * the palette survive the build.
 */
const COLORS = {
  royal:   { tile: 'bg-royal-500',   shell: 'bg-royal-100 border-royal-200',     ink: 'text-royal-700',   dot: 'bg-royal-500' },
  sun:     { tile: 'bg-sun-500',     shell: 'bg-sun-100 border-sun-200',         ink: 'text-sun-800',     dot: 'bg-sun-500' },
  magenta: { tile: 'bg-magenta-500', shell: 'bg-magenta-100 border-magenta-200', ink: 'text-magenta-700', dot: 'bg-magenta-500' },
  aqua:    { tile: 'bg-aqua-500',    shell: 'bg-aqua-100 border-aqua-200',       ink: 'text-aqua-800',    dot: 'bg-aqua-500' },
  lilac:   { tile: 'bg-lilac-500',   shell: 'bg-lilac-100 border-lilac-200',     ink: 'text-lilac-700',   dot: 'bg-lilac-500' },
};

/** The icon keys, in the order the pickers offer them. */
export const BADGE_ICON_KEYS = Object.keys(ICONS);
/** The colour keys, likewise. */
export const BADGE_COLOR_KEYS = Object.keys(COLORS);

export const DEFAULT_BADGE_ICON = 'award';
export const DEFAULT_BADGE_COLOR = 'royal';

/**
 * Everything needed to draw one badge, from anything carrying `icon` and
 * `color` — a TeacherBadge row, a form's draft state, or a bare `{ icon: key }`
 * inside a picker.
 *
 * One object rather than two lookups because the icon and the palette are
 * always wanted together, and because a caller writing
 * `const Icon = look.icon` reads a stable module-level component off a table
 * instead of appearing to mint a new one on every render.
 *
 * @returns {{icon: Function, tile: string, shell: string, ink: string, dot: string}}
 */
export function badgeLook({ icon, color } = {}) {
  return {
    icon: ICONS[icon] || ICONS[DEFAULT_BADGE_ICON],
    ...(COLORS[color] || COLORS[DEFAULT_BADGE_COLOR]),
  };
}
