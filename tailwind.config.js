/** @type {import('tailwindcss').Config} */

// ── TulongGuro palette ──
// Base colours carry structure and text; the "graphics" colours are for
// subject cards, badges, and illustration accents. Every hue is defined as a
// full 50–900 scale so it can stand in for the stock Tailwind scale of the
// same name — that re-themes the raw `bg-blue-50`/`text-slate-400` utilities
// already spread across the pages without touching each file.

const royal = {  // Base — primary brand blue
  50: '#EEF3FC', 100: '#D9E4F7', 200: '#B7CCEF', 300: '#8DADE4', 400: '#5C88D6',
  500: '#2B59C3', 600: '#2449A6', 700: '#1E3F91', 800: '#173272', 900: '#0A2463',
};

const navy = {   // Base — deep navy for headings and admin chrome
  50: '#EDEFF7', 100: '#D5DAEC', 200: '#A9B4D6', 300: '#7285BA', 400: '#3E559A',
  500: '#1B3379', 600: '#12296B', 700: '#0A2463', 800: '#071A4C', 900: '#051235',
};

const sky = {    // Base — light blue
  50: '#F2F9FD', 100: '#E4F1F9', 200: '#C7E3F2', 300: '#94C9E8', 400: '#6BB2DA',
  500: '#4A9BC9', 600: '#357FAB', 700: '#28648A', 800: '#1D4B68', 900: '#143549',
};

const cream = {  // Base — warm neutral canvas
  50: '#FBF9F4', 100: '#F7F3E9', 200: '#F1EBDB', 300: '#EAE2CD', 400: '#DDD1B3',
  500: '#D6C9A8', 600: '#B8A87F', 700: '#8F8260', 800: '#6A6047', 900: '#4A4331',
};

const sun = {    // Graphics — yellow
  50: '#FEF9E7', 100: '#FEF6D4', 200: '#FDEDA8', 300: '#FCE375', 400: '#FAD84A',
  500: '#EFC521', 600: '#C9A417', 700: '#9C7F12', 800: '#75600E', 900: '#544508',
};

const lilac = {  // Graphics — lavender
  50: '#FAF5FD', 100: '#F2E7F8', 200: '#E4CEF1', 300: '#C6A0DB', 400: '#B27FCC',
  500: '#9D5FBD', 600: '#8E5CAF', 700: '#71428D', 800: '#55326A', 900: '#3B2249',
};

const magenta = { // Graphics — pink
  50: '#FEF1F6', 100: '#FDE3EE', 200: '#FBC2D9', 300: '#F78BB6', 400: '#F25795',
  500: '#EE2F80', 600: '#D5176A', 700: '#C01360', 800: '#920E49', 900: '#660A33',
};

const aqua = {   // Graphics — turquoise
  50: '#EFFBFA', 100: '#DDF5F4', 200: '#B5E9E7', 300: '#8ADEDB', 400: '#5FD0CD',
  500: '#3BB8B4', 600: '#2A9D9A', 700: '#217E7C', 800: '#1A6261', 900: '#134746',
};

const lime = {   // Graphics — yellow-green
  50: '#F8FBEB', 100: '#F1F7D5', 200: '#E2EEA9', 300: '#D2E572', 400: '#C5DB3F',
  500: '#AAC029', 600: '#8CA01B', 700: '#7E9410', 800: '#5C6C0C', 900: '#404B08',
};

// Navy-tinted neutral. Replaces stock `slate` (1,223 usages) so borders and
// muted text sit in the same colour family as the brand instead of reading grey.
const neutral = {
  50: '#F7F8FC', 100: '#EDEFF6', 200: '#DDE1EE', 300: '#C2C8DD', 400: '#8B95B5',
  500: '#5F6B8F', 600: '#445072', 700: '#333D5C', 800: '#232B45', 900: '#161C30',
};

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Named palette (use these in new/redesigned code) ──
        royal, navy, sky, cream, sun, lilac, magenta, aqua, lime,

        // ── Legacy brand tokens ──
        // Kept so the existing pages re-theme without edits. Values now point
        // at the new palette; contrast-critical ones use a deep shade because
        // several are used as solid fills behind white text.
        brand: {
          navy: royal[500],
          green: aqua[600],
          amber: sun[600],
          slate: '#1F2D57',
          bg: cream[100],
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
        // `red` is deliberately left as Tailwind's own — errors and destructive
        // actions should stay unmistakably red rather than blend into the brand.
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.5rem',
      },
      boxShadow: {
        // Chunky offset shadows — the flat, stacked look from the reference art.
        'pop': '0 4px 0 0 rgba(10, 36, 99, 0.18)',
        'pop-lg': '0 6px 0 0 rgba(10, 36, 99, 0.20)',
        'card': '0 4px 20px -4px rgba(10, 36, 99, 0.12)',
        'card-lg': '0 12px 32px -8px rgba(10, 36, 99, 0.18)',
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
      },
      animation: {
        'pop-in': 'pop-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both',
        'float': 'float 6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
