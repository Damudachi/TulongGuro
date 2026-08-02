/**
 * Applies a school's brand colour to the whole app.
 *
 * The `royal-*` Tailwind scale is defined as `var(--tg-brand-N, <default>)`
 * (see tailwind.config.js), so setting these variables on :root re-themes every
 * primary-coloured surface at runtime. Schools that skip branding never set the
 * variables and fall through to the default TulongGuro blue.
 */

/** #RRGGBB -> {r,g,b}. Returns null for anything malformed. */
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const toHex = ({ r, g, b }) =>
  '#' + [r, g, b].map(v => clamp(v).toString(16).padStart(2, '0')).join('').toUpperCase();

/** Mix toward white (amount > 0) or black (amount < 0). */
function shade({ r, g, b }, amount) {
  const target = amount > 0 ? 255 : 0;
  const t = Math.abs(amount);
  return { r: r + (target - r) * t, g: g + (target - g) * t, b: b + (target - b) * t };
}

/**
 * Build a 50–900 ramp from one mid-tone brand colour. The chosen colour lands
 * on 500, which is what most primary surfaces use.
 */
export function buildBrandScale(hex) {
  const base = hexToRgb(hex);
  if (!base) return null;
  const steps = {
    50: 0.94, 100: 0.86, 200: 0.7, 300: 0.5, 400: 0.26,
    500: 0, 600: -0.14, 700: -0.28, 800: -0.44, 900: -0.6,
  };
  return Object.fromEntries(
    Object.entries(steps).map(([k, amt]) => [k, toHex(amt === 0 ? base : shade(base, amt))])
  );
}

/**
 * Relative luminance, so we can tell whether text on the brand colour should be
 * white or dark. Uses the WCAG formula.
 */
export function isDarkColor(hex) {
  const c = hexToRgb(hex);
  if (!c) return true;
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b) < 0.5;
}

/** Set (or clear, when brandColor is falsy) the brand variables on :root. */
export function applySchoolTheme(brandColor) {
  const root = document.documentElement;
  const scale = brandColor ? buildBrandScale(brandColor) : null;

  if (!scale) {
    for (const k of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
      root.style.removeProperty(`--tg-brand-${k}`);
    }
    root.style.removeProperty('--tg-brand-on');
    return;
  }

  for (const [k, v] of Object.entries(scale)) {
    root.style.setProperty(`--tg-brand-${k}`, v);
  }
  // Readable text colour for anything sitting on the 500 step.
  root.style.setProperty('--tg-brand-on', isDarkColor(scale[500]) ? '#FFFFFF' : '#0A2463');
}
