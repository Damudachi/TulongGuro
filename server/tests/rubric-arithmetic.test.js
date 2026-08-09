import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

/**
 * Does the AI checker's own arithmetic agree with itself?
 *
 * Two gaps found by reading live data off one activity ("Narrative Essay",
 * 20 points, four papers). Neither is caught by `scoreFeedbackMismatch`, which
 * asks whether a shortfall was *explained* — not whether the numbers add up:
 *
 *   1. One paper's criteria totalled 65 while the stored `aiScore` was 67.
 *      67 is the number that became the grade.
 *   2. Another was given 28 on a criterion under a band the model itself
 *      labelled "Proficient (21-26 pts)".
 *
 * The fixtures below are those real shapes, with the pupils' names removed.
 *
 * Loaded through createRequire for the same reason route-wiring.test.js does:
 * server.js is CommonJS, and Vitest's module runner would hand back a second
 * copy of it.
 */

const require = createRequire(import.meta.url);
const { rubricScoreNoteFor } = require('../server.js');

/** The 40/30/30 rubric that activity actually carried. */
const row = (criterionName, score, maxPoints, bandDescription) =>
  ({ criterionName, score, maxPoints, bandDescription });

describe('rubricScoreNoteFor — the headline score against its own criteria', () => {
  it('says nothing when the criteria add up to the reported score', () => {
    // The three papers whose arithmetic was sound: 28 + 28 + 27 = 83.
    const raw = {
      score: 83,
      rubricScores: [
        row('Content & Evidence', 28, 40, 'Proficient (28-35 pts): Presents clear claims.'),
        row('Organization', 28, 30, 'Outstanding (27-30 pts): Masterful structure.'),
        row('Audience Awareness', 27, 30, 'Outstanding (27-30 pts): Exemplary awareness.'),
      ],
    };
    expect(rubricScoreNoteFor(raw)).toBeNull();
  });

  it('catches a headline score that is not the sum of its parts', () => {
    // The real case: criteria total 65, aiScore stored as 67.
    const raw = {
      score: 67,
      rubricScores: [
        row('Content & Evidence', 22, 40, 'Claims are broad or weakly supported by evidence.'),
        row('Organization', 18, 30, 'Basic essay structure with minor organizational flaws.'),
        row('Audience Awareness', 25, 30, 'Appropriate inclusive tone and language.'),
      ],
    };
    const note = rubricScoreNoteFor(raw);
    expect(note).toContain('65');
    expect(note).toContain('67');
    expect(note).toContain('Check this paper before validating it.');
  });

  it('allows a point of rounding slack rather than crying wolf', () => {
    // 22 + 18 + 25 = 65 exactly; the model reporting 65.4 is rounding, not a
    // contradiction. Flagging it would train teachers to ignore the banner.
    const raw = {
      score: 65.4,
      rubricScores: [
        row('A', 22, 40, ''), row('B', 18, 30, ''), row('C', 25, 30, ''),
      ],
    };
    expect(rubricScoreNoteFor(raw)).toBeNull();
  });

  it('scales the sum against the rubric\'s own total, not against 100', () => {
    // A rubric out of 50 is valid (saveCurriculumRubrics only rejects a zero
    // total), so 40/50 is 80% and agrees with a reported 80.
    const raw = { score: 80, rubricScores: [row('A', 20, 25, ''), row('B', 20, 25, '')] };
    expect(rubricScoreNoteFor(raw)).toBeNull();
  });
});

describe('rubricScoreNoteFor — a score against the band it claims', () => {
  it('catches a score outside the band the model itself named', () => {
    // The real case: 28 awarded under "Proficient (21-26 pts)".
    const raw = {
      score: 80,
      rubricScores: [
        row('Content & Evidence', 22, 40, 'Developing (20-27 pts): Claims are broad.'),
        row('Organization', 30, 30, 'Outstanding (27-30 pts): Masterful structure.'),
        row('Audience Awareness', 28, 30, 'Proficient (21-26 pts): Appropriate inclusive tone.'),
      ],
    };
    const note = rubricScoreNoteFor(raw);
    expect(note).toContain('Audience Awareness');
    expect(note).toContain('21-26');
  });

  it('ignores a band description that carries no range', () => {
    // Some responses come back without the "(20-27 pts)" prefix at all. That
    // is not a contradiction, just less information — inventing one would
    // flag good papers.
    const raw = { score: 65, rubricScores: [row('A', 22, 40, 'Claims are broad.'), row('B', 43, 60, '')] };
    expect(rubricScoreNoteFor(raw)).toBeNull();
  });

  it('accepts a score sitting exactly on a band boundary', () => {
    const raw = {
      score: 100,
      rubricScores: [row('A', 27, 40, 'Developing (20-27 pts): x'), row('B', 20, 30, 'Developing (20-27 pts): y')],
    };
    // 47/70 = 67.1%, which disagrees with the reported 100 — so the note must
    // mention the total, and must NOT mention either boundary score.
    const note = rubricScoreNoteFor(raw);
    expect(note).toContain('67.1%');
    expect(note).not.toContain('under a band described as');
  });
});

describe('rubricScoreNoteFor — when there is nothing to check', () => {
  it('stays quiet on a blank paper', () => {
    expect(rubricScoreNoteFor({ noTextDetected: true, score: 0, rubricScores: [] })).toBeNull();
  });

  it('stays quiet on a privacy-violation result, which carries no marks', () => {
    expect(rubricScoreNoteFor({ privacyViolationDetected: true, rubricScores: [] })).toBeNull();
  });

  it('stays quiet when the model returned no rubric breakdown at all', () => {
    expect(rubricScoreNoteFor({ score: 80 })).toBeNull();
    expect(rubricScoreNoteFor({ score: 80, rubricScores: [] })).toBeNull();
  });

  it('does not flag on unusable criteria rather than guessing at them', () => {
    // maxPoints missing: the sum cannot be computed, so the headline check has
    // nothing to say. It must not fall through to comparing against zero.
    const raw = { score: 80, rubricScores: [row('A', 20, null, ''), row('B', 20, 25, '')] };
    expect(rubricScoreNoteFor(raw)).toBeNull();
  });
});
