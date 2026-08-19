import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The app says everything important in its own voice.
 *
 * `alert()`, `confirm()` and `prompt()` are painted by the browser, outside the
 * page: on the deployed build every one of them was headed
 * "tulong-guro.vercel.app says" — a URL a teacher has no reason to recognise —
 * in OS chrome that cannot be styled, themed or translated, and on a phone as a
 * grey system sheet. Around 130 of the app's most consequential sentences went
 * out that way ("Delete this section?", "This paper has already been
 * validated"), which made the product's least trustworthy-looking moments its
 * most important ones.
 *
 * They now all go through src/utils/dialog.js and render in <DialogHost />.
 * These are guards on the pattern rather than on any one screen — the same
 * reason dark-mode.test.js and touch-reachability.test.js exist: this defect
 * spreads by being copied from the file next door.
 *
 * ESLint enforces rule 1 as well (no-restricted-globals in eslint.config.js).
 * It is asserted here too because the test suite is what runs on every change,
 * and because rules 2-4 are not things a linter can see.
 */

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC = join(ROOT, 'src');

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
const read = (file) => readFileSync(file, 'utf8');

/**
 * Comments out, code left. Several files legitimately *discuss* the native
 * dialogs in prose ("split out rather than done with a prompt()"), and a scan
 * that cannot tell an explanation from a call would force those comments to be
 * reworded to satisfy a test — which is the tail wagging the dog.
 */
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const NATIVE = /(?<![.\w$])(?:window\.)?(alert|confirm|prompt)\s*\(/g;
const HELPERS = ['showAlert', 'showConfirm', 'showPrompt'];

// The module that replaces them names them all over its own documentation.
const isDialogModule = (file) => rel(file) === 'utils/dialog.js';

describe('no screen opens a browser dialog', () => {
  it('finds the source tree it is meant to be checking', () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(20);
  });

  it('calls no native alert(), confirm() or prompt() anywhere under src/', () => {
    const offenders = [];
    for (const file of sourceFiles(SRC)) {
      if (isDialogModule(file)) continue;
      for (const m of codeOnly(read(file)).matchAll(NATIVE)) {
        offenders.push(`${rel(file)}: ${m[1]}()`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('does not reach them by reference either, only by call', () => {
    // `rosterPayload(rows, alert)` passed the native dialog as a callback and
    // read as clean to a scan for `alert(`. Three sites did exactly this, and
    // they were the last three found.
    const offenders = [];
    for (const file of sourceFiles(SRC)) {
      if (isDialogModule(file)) continue;
      for (const m of codeOnly(read(file)).matchAll(/(?<![.\w$])(alert|confirm|prompt)\s*[,)]/g)) {
        offenders.push(`${rel(file)}: passed ${m[1]} as a value`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the replacement is wired up', () => {
  it('mounts DialogHost once, at the top of the app', () => {
    const app = read(join(SRC, 'App.jsx'));
    expect(app).toContain("from './components/DialogHost'");
    expect(app).toContain('<DialogHost />');
    expect(app.match(/<DialogHost\s*\/>/g)).toHaveLength(1);
  });

  it('imports the helpers from utils/dialog wherever they are used', () => {
    const offenders = [];
    for (const file of sourceFiles(SRC)) {
      if (isDialogModule(file)) continue;
      const src = read(file);
      const used = HELPERS.filter(h => new RegExp(`(?<![\\w$])${h}\\s*\\(`).test(codeOnly(src)));
      if (used.length && !/from '[^']*utils\/dialog'/.test(src)) {
        offenders.push(`${rel(file)} uses ${used.join(', ')} without importing them`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('awaits every showConfirm and showPrompt', () => {
    // The one way this migration can silently change behaviour: `confirm()`
    // returned a boolean, `showConfirm()` returns a Promise, and a Promise is
    // always truthy. A dropped `await` turns "are you sure?" into "yes" — and
    // on a delete button, that is the whole guard gone with nothing on screen
    // to show for it.
    const offenders = [];
    for (const file of sourceFiles(SRC)) {
      if (isDialogModule(file)) continue;
      const src = codeOnly(read(file));
      for (const name of ['showConfirm', 'showPrompt']) {
        for (const m of src.matchAll(new RegExp(`(?<![\\w$])${name}\\s*\\(`, 'g'))) {
          const before = src.slice(0, m.index).trimEnd();
          if (!/(?<![\w$])await$/.test(before)) {
            const line = src.slice(0, m.index).split('\n').length;
            offenders.push(`${rel(file)}:${line} — ${name} is not awaited`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the lint rule that stops the next one being written', () => {
    const config = readFileSync(join(ROOT, 'eslint.config.js'), 'utf8');
    for (const name of ['alert', 'confirm', 'prompt']) {
      expect(config).toContain(`name: '${name}'`);
    }
    expect(config).toContain('no-restricted-globals');
  });
});

describe('the dialog itself', () => {
  const host = () => read(join(SRC, 'components', 'DialogHost.jsx'));

  it('gives Escape and the scrim the same answers the native calls gave', () => {
    // confirm() → false, prompt() → null. A dismissal that resolved undefined
    // would read as falsy for confirm and as an empty-string answer for prompt,
    // which is a real answer rather than a cancellation.
    expect(host()).toContain("settleDialog(request.id, request.kind === 'prompt' ? null : false)");
  });

  it('renders the message with its line breaks intact', () => {
    // Several of the migrated messages were written for a dialog that honoured
    // "\n" and list their details a line each.
    expect(host()).toContain('whitespace-pre-line');
  });

  it('paints itself from the theme rather than from fixed colours', () => {
    // bg-white is a themed surface here (see tailwind.config.js) — a hardcoded
    // hex would make the dialog the one thing in the app that ignores dark mode.
    expect(host()).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(host()).toContain('bg-white');
  });

  it('queues requests instead of letting a later one replace an earlier one', () => {
    // alert() blocked, so two in a row showed twice. A store holding only the
    // newest would drop the first message and look like a restyle while being
    // a behaviour change.
    const store = read(join(SRC, 'utils', 'dialog.js'));
    expect(store).toContain('queue.push(');
    expect(store).toContain('queue[0]');
  });
});
