import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Two layout defects that a phone finds and a laptop never will.
 *
 * TulongGuro ships a `display: standalone` manifest and was installed on
 * Android to be used from a phone, so both of these were reported from the
 * field rather than from a browser at 1440px. They are guarded here, next to
 * touch-reachability.test.js, for the same reason that one exists: neither is a
 * mistake in one screen, they are patterns that spread by being copied.
 *
 *   1. A page-level action bar anchored to the bottom of the viewport lands in
 *      exactly the same corner as the mobile dock, which is `fixed bottom-0`
 *      with z-40 and is painted after the page. The buttons that finish a
 *      grading run sat underneath it. `.tg-above-dock` in index.css exists to
 *      lift a bar's contents clear, including the iOS home-indicator inset.
 *
 *   2. A flex child defaults to `min-width: auto`, and a text input's intrinsic
 *      width is large, so `flex-1` on its own never lets one shrink. A row of
 *      them has a minimum width past a 390px viewport; the overflow escaped the
 *      card it was in and scrolled the whole page sideways, taking the heading
 *      off the left edge while the fixed dock stayed where it was.
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

describe('a bottom action bar clears the mobile dock', () => {
  it('finds the source tree it is meant to be checking', () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(20);
  });

  it('has no viewport-spanning bottom bar without tg-above-dock', () => {
    // Scoped to the `fixed bottom-0 left-0 right-0` shape on purpose: that is a
    // page-level bar, the only thing that collides with the dock. A sticky
    // footer inside a modal sits on an overlay above it and is fine, and so is
    // a sticky caption strip inside a scrolling panel.
    const BAR = /className="([^"]*\bfixed\b[^"]*\bbottom-0\b[^"]*\bleft-0\b[^"]*\bright-0\b[^"]*)"/g;
    const offenders = [];

    for (const file of sourceFiles(SRC)) {
      // The layouts are where the dock itself is declared.
      if (rel(file).startsWith('layouts/')) continue;
      const src = readFileSync(file, 'utf8');
      let m;
      BAR.lastIndex = 0;
      while ((m = BAR.exec(src))) {
        if (/\btg-above-dock\b/.test(m[1])) continue;
        offenders.push(`${rel(file)}:${src.slice(0, m.index).split('\n').length}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps the grading screen\'s validate/release bar clear of the dock', () => {
    // Named rather than inferred: this bar is `sticky`, not `fixed`, because it
    // lives inside the workspace's own scrolling column — so the shape-based
    // check above cannot see it, and it is the bar that was actually reported.
    const src = readFileSync(join(SRC, 'pages', 'teacher', 'HITLWorkspace.jsx'), 'utf8');
    expect(src).toContain('tg-above-dock');
  });
});

describe('a flex-1 form control can actually shrink', () => {
  /**
   * The element a className belongs to is the nearest tag opening before it.
   * Matching forward from the tag instead would need to skip the attribute
   * list, and any `onChange={e => ...}` defeats a `[^>]*` bound on it.
   */
  function ownerTag(src, atIndex) {
    const TAG_OPEN = /<([A-Za-z][\w.]*)/g;
    let last = null, m;
    while ((m = TAG_OPEN.exec(src)) && m.index < atIndex) last = m[1];
    return last;
  }

  it('has no flex-1 input, select or textarea without a min-width', () => {
    const CONTROLS = new Set(['input', 'select', 'textarea']);
    const offenders = [];

    for (const file of sourceFiles(SRC)) {
      const src = readFileSync(file, 'utf8');
      const CLASSNAME = /className="([^"]*)"/g;
      let m;
      while ((m = CLASSNAME.exec(src))) {
        const cls = m[1];
        if (!/\bflex-1\b/.test(cls)) continue;
        // `min-w-0` is the usual answer, but an explicit floor such as
        // `min-w-[12rem]` is a deliberate decision and equally valid — the
        // defect is leaving the browser's `auto` in place.
        if (/\bmin-w-/.test(cls)) continue;
        if (!CONTROLS.has(ownerTag(src, m.index))) continue;
        offenders.push(`${rel(file)}:${src.slice(0, m.index).split('\n').length}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
