/** @type {import('tailwindcss').Config} */

// ── TulongGuro palette ──
// Base colours carry structure and text; the "graphics" colours are for
// subject cards, badges, and illustration accents. Every hue is defined as a
// full 50–900 scale so it can stand in for the stock Tailwind scale of the
// same name — that re-themes the raw `bg-blue-50`/`text-slate-400` utilities
// already spread across the pages without touching each file.

// ── Theme variables ──
//
// Every scale below is emitted as `var(--tg-<scale>-<stop>, <light value>)`
// rather than as a bare hex. The fallback is the exact colour the app has
// always used, so light mode is byte-identical to before; dark mode is then a
// block of variable overrides in index.css and nothing else.
//
// This is the whole reason dark mode did not need `dark:` written onto ~2,400
// class names across forty-odd files. `royal` already worked this way for
// school branding — see applySchoolTheme — and this extends the same trick to
// the rest of the palette.
const themed = (name, values) => Object.fromEntries(
  Object.entries(values).map(([stop, hex]) => [stop, `var(--tg-${name}-${stop}, ${hex})`])
);

// Base — primary brand blue.
//
// Each step reads a CSS variable with the default TulongGuro blue as fallback,
// so a school that picks a brand colour at registration re-themes every
// `royal-*` utility at runtime (see applySchoolTheme in utils/schoolTheme.js)
// without a rebuild. Schools that skip branding get these defaults.
const royal = {
  50:  'var(--tg-brand-50, #EEF3FC)',
  100: 'var(--tg-brand-100, #D9E4F7)',
  200: 'var(--tg-brand-200, #B7CCEF)',
  300: 'var(--tg-brand-300, #8DADE4)',
  400: 'var(--tg-brand-400, #5C88D6)',
  500: 'var(--tg-brand-500, #2B59C3)',
  600: 'var(--tg-brand-600, #2449A6)',
  700: 'var(--tg-brand-700, #1E3F91)',
  800: 'var(--tg-brand-800, #173272)',
  900: 'var(--tg-brand-900, #0A2463)',
};

const navy = themed('navy', {   // Base — deep navy for headings and admin chrome
  50: '#EDEFF7', 100: '#D5DAEC', 200: '#A9B4D6', 300: '#7285BA', 400: '#3E559A',
  500: '#1B3379', 600: '#12296B', 700: '#0A2463', 800: '#071A4C', 900: '#051235',
});

const sky = themed('sky', {    // Base — light blue
  50: '#F2F9FD', 100: '#E4F1F9', 200: '#C7E3F2', 300: '#94C9E8', 400: '#6BB2DA',
  500: '#4A9BC9', 600: '#357FAB', 700: '#28648A', 800: '#1D4B68', 900: '#143549',
});

const cream = themed('cream', {  // Base — warm neutral canvas
  50: '#FBF9F4', 100: '#F7F3E9', 200: '#F1EBDB', 300: '#EAE2CD', 400: '#DDD1B3',
  500: '#D6C9A8', 600: '#B8A87F', 700: '#8F8260', 800: '#6A6047', 900: '#4A4331',
});

const sun = themed('sun', {    // Graphics — yellow
  50: '#FEF9E7', 100: '#FEF6D4', 200: '#FDEDA8', 300: '#FCE375', 400: '#FAD84A',
  500: '#EFC521', 600: '#C9A417', 700: '#9C7F12', 800: '#75600E', 900: '#544508',
});

const lilac = themed('lilac', {  // Graphics — lavender
  50: '#FAF5FD', 100: '#F2E7F8', 200: '#E4CEF1', 300: '#C6A0DB', 400: '#B27FCC',
  500: '#9D5FBD', 600: '#8E5CAF', 700: '#71428D', 800: '#55326A', 900: '#3B2249',
});

const magenta = themed('magenta', { // Graphics — pink
  50: '#FEF1F6', 100: '#FDE3EE', 200: '#FBC2D9', 300: '#F78BB6', 400: '#F25795',
  500: '#EE2F80', 600: '#D5176A', 700: '#C01360', 800: '#920E49', 900: '#660A33',
});

const aqua = themed('aqua', {   // Graphics — turquoise
  50: '#EFFBFA', 100: '#DDF5F4', 200: '#B5E9E7', 300: '#8ADEDB', 400: '#5FD0CD',
  500: '#3BB8B4', 600: '#2A9D9A', 700: '#217E7C', 800: '#1A6261', 900: '#134746',
});

const lime = themed('lime', {   // Graphics — yellow-green
  50: '#F8FBEB', 100: '#F1F7D5', 200: '#E2EEA9', 300: '#D2E572', 400: '#C5DB3F',
  500: '#AAC029', 600: '#8CA01B', 700: '#7E9410', 800: '#5C6C0C', 900: '#404B08',
});

// Navy-tinted neutral. Replaces stock `slate` (1,223 usages) so borders and
// muted text sit in the same colour family as the brand instead of reading grey.
const neutral = themed('neutral', {
  50: '#F7F8FC', 100: '#EDEFF6', 200: '#DDE1EE', 300: '#C2C8DD', 400: '#8B95B5',
  500: '#5F6B8F', 600: '#445072', 700: '#333D5C', 800: '#232B45', 900: '#161C30',
});

// Errors and destructive actions. These are Tailwind's own red values, kept
// exactly, so light mode is unchanged — but routed through variables like every
// other scale so a red-tinted alert box is not a glaring white island on a dark
// canvas. Red stays red in both themes; only its light/dark ends swap.
const red = themed('red', {
  50: '#FEF2F2', 100: '#FEE2E2', 200: '#FECACA', 300: '#FCA5A5', 400: '#F87171',
  500: '#EF4444', 600: '#DC2626', 700: '#B91C1C', 800: '#991B1B', 900: '#7F1D1D',
});

// A white overlay on dark chrome — the sidebar's active pill, the hover wash on
// a brand-coloured tile. Deliberately NOT `white`: `bg-white` is a card surface
// and turns dark with the theme, while these have to stay light or the chrome
// they sit on loses every hover and active state. The two were the same colour
// and meant opposite things.
const sheen = '#FFFFFF';

// Near-black, fixed in both themes. For the surfaces whose darkness is the
// point rather than a theme choice: the backdrop a scanned paper is viewed
// against, and the scrim behind a modal. Neither should brighten when the app
// does — a photo of a pupil's handwriting is judged against a dark ground, and
// a scrim that lightens stops being a scrim.
const ink = { 700: '#1A2234', 800: '#111827', 900: '#0A0F1C' };

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Named palette (use these in new/redesigned code) ──
        royal, navy, sky, cream, sun, lilac, magenta, aqua, lime, sheen, ink,

        // ── Legacy brand tokens ──
        // Kept so the existing pages re-theme without edits. Values now point
        // at the new palette; contrast-critical ones use a deep shade because
        // several are used as solid fills behind white text.
        brand: {
          navy: royal[500],
          green: aqua[600],
          amber: sun[600],
          // The heading ink on light surfaces (115 `text-brand-slate` sites).
          // Themed, because a near-black heading on a dark card is a hole.
          slate: 'var(--tg-ink-strong, #1F2D57)',
          bg: cream[100],
          // Chrome that is deliberately dark in BOTH themes: the role sidebars,
          // the mobile dock, the image-viewer backdrop. All carry white text, so
          // a scale that inverts with the theme would turn them into white
          // panels with white text on them. Follows the school's brand colour
          // (applySchoolTheme sets it) but always from the dark end of the ramp.
          chrome: 'var(--tg-brand-chrome, #0A2463)',
        },

        // ── Stock-scale overrides ──
        // Re-point the families the pages already reference at the palette.
        slate: neutral,
        gray: neutral,
        blue: royal,
        indigo: royal,
        green: aqua,
        emerald: aqua,
        teal: aqua,
        amber: sun,
        yellow: sun,
        orange: sun,
        purple: lilac,
        violet: lilac,
        pink: magenta,
        // `red` keeps Tailwind's own values — errors and destructive actions
        // stay unmistakably red rather than blending into the brand — but is
        // themed, so an alert box inverts with the canvas instead of glaring
        // white on a dark page.
        red,
      },
      // ── The one colour that means two different things ──
      // `bg-white` is a card surface: it has to turn dark with the theme.
      // `text-white` is the ink on a saturated brand fill: it has to stay
      // white, or every primary button loses its label. Splitting them here is
      // what let 235 `bg-white` and 218 `text-white` sites both stay correct
      // without either being edited. `border-white` falls through to the plain
      // colour, which is right — it only ever outlines a brand fill.
      backgroundColor: {
        white: 'var(--tg-surface, #FFFFFF)',
        // Spelled out in full so nothing in `brand` is lost by the merge, and
        // so the two that differ from their text counterparts can differ. Both
        // are fills carrying white labels, so both hold a dark value in dark
        // mode rather than following their scale up into the light end.
        brand: {
          navy: 'var(--tg-brand-500, #2B59C3)',
          green: '#2A9D9A',
          amber: 'var(--tg-sun-600, #C9A417)',
          slate: 'var(--tg-ink-strong, #1F2D57)',
          bg: 'var(--tg-cream-100, #F7F3E9)',
          chrome: 'var(--tg-brand-chrome, #0A2463)',
        },
      },
      textColor: {
        white: '#FFFFFF',
        // The mirror image: as ink on a dark surface these two have to lighten,
        // which is exactly what they must not do as fills above. Identical in
        // light mode — the variables below default to the same values — so this
        // split costs nothing until the theme flips.
        brand: {
          navy: 'var(--tg-brand-ink, #2B59C3)',
          green: 'var(--tg-brand-ink-green, #2A9D9A)',
          amber: 'var(--tg-sun-600, #C9A417)',
          slate: 'var(--tg-ink-strong, #1F2D57)',
          bg: 'var(--tg-cream-100, #F7F3E9)',
          chrome: 'var(--tg-brand-chrome, #0A2463)',
        },
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.5rem',
      },
      boxShadow: {
        // Chunky offset shadows — the flat, stacked look from the reference art.
        // Themed for the same reason the palette is: a navy shadow is what gives
        // a card its lift on cream, and is invisible on a dark canvas. Dark mode
        // swaps in a near-black at higher opacity, which is what actually reads
        // as depth there.
        'pop': '0 4px 0 0 var(--tg-shadow-pop, rgba(10, 36, 99, 0.18))',
        'pop-lg': '0 6px 0 0 var(--tg-shadow-pop-lg, rgba(10, 36, 99, 0.20))',
        'card': '0 4px 20px -4px var(--tg-shadow-card, rgba(10, 36, 99, 0.12))',
        'card-lg': '0 12px 32px -8px var(--tg-shadow-card-lg, rgba(10, 36, 99, 0.18))',
      },
      fontFamily: {
        sans: ['Nunito', 'Quicksand', 'ui-rounded', 'system-ui', 'sans-serif'],
        display: ['Baloo 2', 'Nunito', 'ui-rounded', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'pop-in': {
          '0%': { opacity: '0', transform: 'translateY(8px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        // One piece of confetti falling the height of the viewport. Every value
        // that should differ between pieces — where it starts, how far it
        // drifts sideways, how long it takes, its colour — is set inline on the
        // element, so the shared keyframe stays one rule rather than fifty.
        // `--tg-drift` defaults to 0 so a piece with no drift set still falls
        // straight down instead of resolving to an invalid transform.
        'confetti-fall': {
          '0%':   { opacity: '0', transform: 'translate3d(0, -12vh, 0) rotate(0deg)' },
          '8%':   { opacity: '1' },
          '85%':  { opacity: '1' },
          '100%': { opacity: '0', transform: 'translate3d(var(--tg-drift, 0px), 104vh, 0) rotate(var(--tg-spin, 720deg))' },
        },
        // The badge's own arrival: overshoots, then settles.
        'badge-land': {
          '0%':   { opacity: '0', transform: 'scale(0.3) rotate(-18deg)' },
          '60%':  { opacity: '1', transform: 'scale(1.12) rotate(6deg)' },
          '100%': { opacity: '1', transform: 'scale(1) rotate(0deg)' },
        },
      },
      animation: {
        'pop-in': 'pop-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both',
        'float': 'float 6s ease-in-out infinite',
        'confetti-fall': 'confetti-fall 3s linear forwards',
        'badge-land': 'badge-land 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both',
      },
    },
  },
  plugins: [],
}
