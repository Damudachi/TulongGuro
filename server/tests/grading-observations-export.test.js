import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import grading from '../grading.js';

/**
 * The read-only export behind the Alpha-stage technical observation (AM34.1).
 *
 * The script itself is a database read and two CSV writes; what is worth
 * pinning is the judgement inside it — which two events out of a paper's
 * history constitute "the AI said X, the teacher decided Y". Get that wrong and
 * every downstream figure (the confusion matrix, accuracy, per-band precision
 * and recall, macro-F1) is computed over the wrong pairs while looking
 * perfectly well-formed.
 *
 * Imported rather than run: the script only executes when invoked directly, so
 * requiring it here opens no connection and writes no files.
 */

const require = createRequire(import.meta.url);
const { selectPair, csvCell, csvRow, percentile } = require('../scripts/export-grading-observations.js');

const at = (day) => new Date(Date.UTC(2026, 7, day));
const ai = (score, day = 1) => ({ event: 'AI_GRADED', score, createdAt: at(day) });
const teacher = (score, day = 2) => ({ event: 'TEACHER_VALIDATED', score, createdAt: at(day) });
const released = (day = 3) => ({ event: 'RELEASED', score: null, createdAt: at(day) });

describe('which two events a paper is observed on', () => {
  it('pairs the AI draft with the teacher decision', () => {
    const pair = selectPair([ai(72), teacher(80), released()]);
    expect(pair.ai.score).toBe(72);
    expect(pair.teacher.score).toBe(80);
    expect(pair.released).toBe(true);
  });

  it('takes the FIRST draft — the one the teacher was actually shown', () => {
    // A paper re-checked after review writes a second AI_GRADED. The teacher
    // never saw that one before deciding, so scoring the model against it would
    // credit or blame it for a draft that played no part in the decision.
    const pair = selectPair([ai(60, 1), teacher(85, 2), ai(88, 3)]);
    expect(pair.ai.score).toBe(60);
  });

  it('takes the LAST decision — the mark that actually stands', () => {
    // A teacher who validates, reopens and revises leaves two decisions. The
    // grade of record is the later one.
    const pair = selectPair([ai(60), teacher(70, 2), teacher(75, 4)]);
    expect(pair.teacher.score).toBe(75);
  });

  it('ignores a paper with no AI draft', () => {
    // Graded by hand from the start: there is no machine judgement to compare,
    // and entering it would count the teacher's own mark as a model hit.
    expect(selectPair([teacher(90)])).toBeNull();
  });

  it('ignores a draft nobody has validated yet', () => {
    // Still awaiting review. Treating the draft as the outcome would score the
    // model against itself.
    expect(selectPair([ai(64)])).toBeNull();
  });

  it('ignores a pair where either score is missing', () => {
    expect(selectPair([{ event: 'AI_GRADED', score: null }, teacher(80)])).toBeNull();
    expect(selectPair([ai(80), { event: 'TEACHER_VALIDATED', score: null }])).toBeNull();
  });

  it('keeps a zero, which is a real mark and not a missing one', () => {
    const pair = selectPair([ai(0), teacher(0)]);
    expect(pair.ai.score).toBe(0);
    expect(pair.teacher.score).toBe(0);
  });

  it('reports release separately from validation', () => {
    // Validated but never published: a real state, and one the study should be
    // able to see rather than have folded into "done".
    expect(selectPair([ai(70), teacher(70)]).released).toBe(false);
  });
});

describe('the bands the pairs are classified into', () => {
  // The export classifies with the app's own ladder at the school's own passing
  // grade. A hardcoded DO 8 s.2015 ladder would disagree with what the teacher
  // was shown wherever a school sets its own threshold — and the matrix is
  // supposed to describe that screen.
  it('uses the same band function the app renders with', () => {
    expect(grading.bandKeyFor(74, 75)).not.toBe(grading.bandKeyFor(76, 75));
  });

  it('moves the band edges with the school\'s passing grade', () => {
    // 78 passes in a school passing at 75 and fails in one passing at 80. Both
    // must be labelled the way that school labels them.
    expect(grading.bandKeyFor(78, 75)).not.toBe(grading.bandKeyFor(78, 80));
  });
});

describe('CSV output', () => {
  it('quotes cells containing a comma, a quote or a newline', () => {
    expect(csvCell('Grade 6 — Newton, English')).toBe('"Grade 6 — Newton, English"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('a\nb')).toBe('"a\nb"');
  });

  it('writes an empty cell for null and undefined, not the words', () => {
    // "null" in a numeric column is the kind of thing pandas reads as a string
    // and then silently types the whole column as object.
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvRow([1, null, 'x'])).toBe('1,,x');
  });

  it('keeps a zero, which is data', () => {
    expect(csvCell(0)).toBe('0');
  });
});

describe('latency percentiles', () => {
  const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  it('reports the nearest-rank percentile', () => {
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 95)).toBe(100);
  });

  it('survives an empty set rather than reporting a number for nothing', () => {
    expect(percentile([], 50)).toBeNull();
  });

  it('handles a single request', () => {
    expect(percentile([42], 95)).toBe(42);
  });
});
