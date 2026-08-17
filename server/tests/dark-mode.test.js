import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Dark mode is not written into the screens — it is a block of CSS variable
 * overrides, and every colour utility in the app resolves through one of those
 * variables. That is what let it ship without `dark:` being written onto ~2,400
 * class names, and it is also what makes it quietly breakable: a new screen
 * that hardcodes a hex, or reaches for one of the three colours that must NOT
 * follow the theme, looks perfect in light mode and wrong only at night.
 *
 * These are guards on the pattern rather than on any one screen, for the same
 * reason mobile-layout.test.js and touch-reachability.test.js are: the defects
 * spread by being copied.
 */

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC = join(ROOT, 'src');

function sourceFiles(dir, ext = /\.jsx?$/) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full, ext));
    else if (ext.test(entry)) out.push(full);
  }
  return out;
}

const rel = (file) => relative(SRC, file).replace(/\\/g, '/');
const config = () => readFileSync(join(ROOT, 'tailwind.config.js'), 'utf8');
const indexCss = () => readFileSync(join(SRC, 'index.css'), 'utf8');

describe('the palette resolves through theme variables', () => {
  it('finds the source tree it is meant to be checking', () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(20);
  });

  it('emits every themable scale as a var() with its light value as the fallback', () => {
    const src = config();
    // The fallback is what keeps light mode identical to before the theme
    // existed, and what makes a missing dark override degrade to light rather
    // than to nothing.
    for (const scale of ['navy', 'cream', 'neutral', 'sun', 'lilac', 'magenta', 'aqua', 'lime', 'sky', 'red']) {
      expect(src, `${scale} is not routed through a variable`).toMatch(
        new RegExp(`const ${scale} = themed\\('${scale}'`)
      );
    }
  });

  it('gives every light value a dark counterpart', () => {
    // A scale that is themed but never overridden falls back to its light value
    // and stays bright on a dark page — the failure mode that looks like the
    // feature works until you reach the one screen that uses it.
    //
    // One exemption, and it is the point rather than an oversight:
    // `--tg-brand-chrome` is the sidebar, which is dark in BOTH themes. It is
    // written inline by applySchoolTheme from the dark end of the school's own
    // ramp, so a dark-block override would be both redundant and unable to win.
    const FIXED_BY_DESIGN = new Set(['tg-brand-chrome']);
    // Matched on the *value*, not the name: a fallback starting with a hex or
    // an rgba() is a colour or a shadow and belongs to the theme, while the
    // confetti's --tg-drift and --tg-spin are geometry and do not.
    const declared = new Set(
      [...config().matchAll(/var\(--(tg-[a-z0-9-]+),\s*(?:#|rgba?\()/g)]
        .map(m => m[1])
        .filter(v => !FIXED_BY_DESIGN.has(v))
    );
    const dark = indexCss().match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);
    expect(dark, 'no dark block in index.css').toBeTruthy();
    const overridden = new Set(
      [...dark[1].matchAll(/--(tg-[a-z0-9-]+)\s*:/g)].map(m => m[1])
    );
    const missing = [...declared].filter(v => !overridden.has(v));
    expect(missing).toEqual([]);
  });
});

describe('the three colours that must not follow the theme', () => {
  it('keeps `sheen` and `ink` as literal values', () => {
    const src = config();
    // `sheen` is a white wash on dark chrome and `ink` is a near-black backdrop.
    // Both exist to contrast with whatever they sit on, so a themed version
    // would invert them into the very surface they are meant to stand out from.
    expect(src).toMatch(/const sheen = '#FFFFFF';/);
    expect(src).toMatch(/const ink = \{[^}]*'#[0-9A-Fa-f]{6}'/);
    expect(src).not.toMatch(/const sheen = themed/);
    expect(src).not.toMatch(/const ink = themed/);
  });

  it('splits bg-white from text-white', () => {
    // `bg-white` is a card surface and has to darken; `text-white` is the label
    // on a saturated button and has to stay white. They were one colour meaning
    // two opposite things, and merging them back would blank every primary
    // button's text or leave every card white.
    const src = config();
    expect(src).toMatch(/backgroundColor:\s*\{[\s\S]*?white:\s*'var\(--tg-surface/);
    expect(src).toMatch(/textColor:\s*\{[\s\S]*?white:\s*'#FFFFFF'/);
  });

  it('has no translucent white left standing in for a sheen', () => {
    // `bg-white/10` on a sidebar is a light wash, not a 10%-opaque card. Once
    // bg-white became the themed surface, those turned into a barely-visible
    // dark wash on dark chrome and every hover and active state disappeared.
    const offenders = [];
    for (const file of sourceFiles(SRC)) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        // 50% and above are genuinely translucent surfaces (a sticky action bar
        // over scrolling content), which is what bg-white should now mean.
        if (/\bbg-white\/(?:[0-9]|[1-4][0-9])\b/.test(line)) offenders.push(`${rel(file)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('deliberately dark chrome stays dark', () => {
  it('has no white-text panel painted with a scale that inverts', () => {
    // The sidebars, the mobile dock and the selected pills carry white text in
    // both themes. Painted with navy-800 or royal-900 — scales whose dark end
    // becomes light — they would turn into white panels with white text on
    // them. `brand-chrome` and `ink` exist for exactly these.
    const offenders = [];
    for (const file of sourceFiles(SRC)) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const painted = /\bbg-(?:navy|slate|gray|neutral)-(?:800|900)\b/.test(line)
          || /\bbg-royal-900\b/.test(line);
        if (painted) offenders.push(`${rel(file)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('the theme is applied before the first paint', () => {
  it('sets data-theme from an inline script in index.html', () => {
    // React mounts a moment after the document does. Without this the app
    // paints light for one frame on every load, which on a phone at night is
    // the single worst thing a dark mode can do.
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    expect(html).toMatch(/documentElement\.dataset\.theme/);
    // Same per-account key the runtime builds, or the pre-paint guess and the
    // app disagree and the flash comes back for exactly the people who set a
    // preference.
    expect(html).toMatch(/'tg-theme:' \+ \(id \|\| 'guest'\)/);
    const theme = readFileSync(join(SRC, 'utils/theme.js'), 'utf8');
    expect(theme).toMatch(/KEY_PREFIX = 'tg-theme'/);
    expect(theme).toMatch(/\$\{KEY_PREFIX\}:\$\{userId \|\| 'guest'\}/);
  });

  it('reads the account id only when there is a real session', () => {
    // A one-off sign-in that ended with the tab leaves the user blob behind by
    // design (see session.js). Keying off the blob alone would keep applying a
    // departed user's theme to the login screen the next person sees — the same
    // cross-account leak, moved to the front door.
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    expect(html).toMatch(/sessionStorage\.getItem\('tg_token'\) \|\| localStorage\.getItem\('tg_token'\)/);
    expect(html).toMatch(/if \(token\)/);
    // The runtime asks sessionFor(), which applies the same token-and-user rule.
    const theme = readFileSync(join(SRC, 'utils/theme.js'), 'utf8');
    expect(theme).toMatch(/currentUserId = \(\) => sessionFor\(\)\.id/);
  });

  it('switches theme when the session does', () => {
    // Signing in has to adopt that account's theme, and signing out has to drop
    // back to the guest slot. Without both, one account's choice keeps showing
    // on the next person's screen until a reload — the whole defect the
    // per-account key exists to close.
    const config = readFileSync(join(SRC, 'config.js'), 'utf8');
    expect(config).toMatch(/refreshThemeForSession\(user\?\.themePreference/);
    expect(config).toMatch(/clearStoredSession\(\);[\s\S]*?refreshThemeForSession\(\)/);
  });

  it('never adopts the old browser-wide key into an account', () => {
    // There is no way to know whose choice it was. Adopting it would hand one
    // person's setting to whoever signed in first — precisely the bug.
    const theme = readFileSync(join(SRC, 'utils/theme.js'), 'utf8');
    expect(theme).toMatch(/dropRaw\(LEGACY_KEY\)/);
  });

  it('offers follow-the-system as a real third choice', () => {
    // A two-state switch cannot express "follow my phone", so choosing light at
    // noon would silently opt the user out of their phone going dark at night.
    const theme = readFileSync(join(SRC, 'utils/theme.js'), 'utf8');
    expect(theme).toMatch(/THEMES = \['light', 'dark', 'system'\]/);
    expect(theme).toMatch(/prefers-color-scheme: dark/);
  });

  it('rebuilds a branded school\'s ramp when the theme changes', () => {
    // applySchoolTheme writes the brand ramp as inline styles on <html>, and an
    // inline style beats the dark block in index.css. Without this the app
    // would be dark everywhere except the school's own colours.
    const school = readFileSync(join(SRC, 'utils/schoolTheme.js'), 'utf8');
    expect(school).toMatch(/export function reapplySchoolTheme/);
    expect(school).toMatch(/dataset\.theme === 'dark'/);
    expect(readFileSync(join(SRC, 'utils/theme.js'), 'utf8')).toMatch(/reapplySchoolTheme\(\)/);
  });
});
