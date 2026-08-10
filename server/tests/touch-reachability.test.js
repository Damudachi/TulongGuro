import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Controls that only appear on hover are unreachable on a touch screen.
 *
 * There is no hover state on a phone, so `opacity-0 group-hover:opacity-100`
 * never resolves to anything visible. The element stays in the DOM and stays
 * tappable, which is worse than being disabled — a teacher has no way to find
 * it and no signal that it exists.
 *
 * That matters here specifically because TulongGuro ships a
 * `display: standalone` manifest and was made installable on Android and iOS
 * so that it *would* be used from a phone. Seven controls were hidden this
 * way, three of them the only route to renaming a learner, resetting their
 * password, or removing them from a section.
 *
 * The fix is the `reveal-on-hover` utility in index.css, which does the hiding
 * inside `@media (hover: hover)` so a coarse pointer simply never hides it.
 * This test guards the pattern rather than any one screen, because the defect
 * spread by being copied.
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

describe('no control is revealed by hover alone', () => {
  it('finds the source tree it is meant to be checking', () => {
    // A path that silently resolved to nothing would make every assertion
    // below pass while checking no files at all.
    expect(sourceFiles(SRC).length).toBeGreaterThan(20);
  });

  it('has no element hidden behind group-hover in any screen', () => {
    const offenders = [];

    for (const file of sourceFiles(SRC)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!line.includes('group-hover:opacity-100')) return;
        // Only the pairing is a defect. `group-hover:opacity-100` on something
        // that starts at a partial opacity is an emphasis change, not a
        // reveal, and stays perfectly usable when the hover never comes.
        if (!/\bopacity-0\b/.test(line)) return;
        offenders.push(`${relative(SRC, file).replace(/\\/g, '/')}:${i + 1}`);
      });
    }

    expect(offenders).toEqual([]);
  });

  it('defines the reveal-on-hover utility the screens rely on', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8');
    expect(css).toContain('reveal-on-hover');
    // The hiding must sit inside a hover query. Without it the utility is just
    // a renamed version of the bug.
    expect(css).toMatch(/@media\s*\(hover:\s*hover\)/);
  });
});
