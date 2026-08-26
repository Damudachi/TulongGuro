import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * A modal taller than the window must be scrollable to its top.
 *
 * `flex items-center` centres a flex child in its container. When the child is
 * TALLER than the container, centring puts its top edge at a negative offset —
 * and a scroll container cannot scroll above its own origin, so the overflow at
 * the top is unreachable by any means: no scrollbar, no wheel, no keyboard.
 * The bottom half scrolls perfectly, which is what makes it look like a
 * rendering glitch rather than a layout bug.
 *
 * It was reported on the admin's Add Curriculum form, which is the tallest
 * modal in the app — grade, subject, title, description, a file upload and a
 * rubric block. At 100% zoom on a laptop its heading and its first two fields
 * were simply gone, and the only workaround was to zoom the browser out.
 *
 * `items-start` is the fix: the child begins at the container's top edge, its
 * own `my-8` keeps it off the chrome, and everything below scrolls into view
 * normally. Modals short enough to fit are unaffected — they sit at the top
 * with a margin instead of dead-centre, which is where a scrolling dialog
 * should start anyway.
 *
 * Guarded as a pattern rather than on the one screen that was reported, for the
 * same reason mobile-layout.test.js and touch-reachability.test.js are: three
 * files had this exact class list, and all three got it by being copied from
 * each other.
 */

const SRC = new URL('../../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.jsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const rel = (file) => relative(SRC, file).replace(/\\/g, '/');

describe('a scrolling modal can be scrolled to its top', () => {
  it('finds the source tree it is meant to be checking', () => {
    // A path that silently resolved to nothing would make the assertion below
    // pass while checking no files at all.
    expect(sourceFiles(SRC).length).toBeGreaterThan(20);
  });

  it('never pairs items-center with overflow-y-auto on an overlay', () => {
    // Scoped to `fixed inset-0` — a page-level overlay is the only place this
    // combination strands content. `items-center` on a row of buttons, or on a
    // panel that does not scroll, is ordinary centring and fine.
    const offenders = [];

    for (const file of sourceFiles(SRC)) {
      const src = readFileSync(file, 'utf8');
      const CLASSNAME = /className="([^"]*)"/g;
      let m;
      while ((m = CLASSNAME.exec(src))) {
        const cls = m[1];
        if (!/\bfixed\b/.test(cls) || !/\binset-0\b/.test(cls)) continue;
        if (!/\boverflow-y-auto\b/.test(cls)) continue;
        if (!/\bitems-center\b/.test(cls)) continue;
        offenders.push(`${rel(file)}:${src.slice(0, m.index).split('\n').length}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps the admin curriculum form — the one that was reported — scrollable', () => {
    // Named as well as pattern-checked: this is the tallest form in the app, so
    // it is the first place a regression would be visible and the last place it
    // would be noticed on a big monitor.
    const src = readFileSync(join(SRC, 'pages', 'admin', 'Curriculum.jsx'), 'utf8');
    expect(src).toMatch(/fixed inset-0[^"]*items-start[^"]*overflow-y-auto/);
  });
});
