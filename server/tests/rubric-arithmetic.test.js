import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

/**
 * Does the AI checker's own arithmetic agree with itself — and when it does
 * not, which half wins?
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
 * These were both flagged and then left alone, on the reasoning that choosing
 * between the model's two answers would be guessing which. That reasoning holds
 * for (2) and not for (1), and the difference is what this file now pins:
 *
 *   • A criterion score against its band is a JUDGEMENT. Nothing but a person
 *     who has read the paper can settle it, so it is still only flagged.
 *   • A headline against the criteria under it is ARITHMETIC. The criterion
 *     scores are the reasoned part and the total is addition, so the total is
 *     rebuilt from them and the teacher is told what changed.
 *
 * The fixtures below are those real shapes, with the pupils' names removed.
 *
 * Loaded through createRequire for the same reason route-wiring.test.js does:
 * server.js is CommonJS, and Vitest's module runner would hand back a second
 * copy of it.
 */

const require = createRequire(import.meta.url);
const { rubricScoreNoteFor, rubricTotalPercent, normalisePaperResult } = require('../server.js');

/** The 40/30/30 rubric that activity actually carried. */
const row = (criterionName, score, maxPoints, bandDescription) =>
  ({ criterionName, score, maxPoints, bandDescription });

/** One paper through the real normaliser, which is what decides the grade. */
const check = (raw) => normalisePaperResult(raw, 'test-model');

// ───────────────────────────────────────────────────────────────────────────
// 1. The grade is the criteria
// ───────────────────────────────────────────────────────────────────────────
describe('the headline score is rebuilt from the rubric breakdown', () => {
  it('keeps the score when the model added up correctly', () => {
    // The three papers whose arithmetic was sound: 28 + 28 + 27 = 83.
    const result = check({
      score: 83,
      rubricScores: [
        row('Content & Evidence', 28, 40, 'Proficient (28-35 pts): Presents clear claims.'),
        row('Organization', 28, 30, 'Outstanding (27-30 pts): Masterful structure.'),
        row('Audience Awareness', 27, 30, 'Outstanding (27-30 pts): Exemplary awareness.'),
      ],
    });
    expect(result.score).toBe(83);
    expect(result.aiScoreCorrectedFrom).toBeNull();
    expect(result.rubricScoreNote).toBeNull();
  });

  it('takes the criteria over the headline when they disagree', () => {
    // The real case: criteria total 65, aiScore stored as 67. 65 is now what
    // becomes the grade — this is the bug this whole file exists for.
    const result = check({
      score: 67,
      rubricScores: [
        row('Content & Evidence', 22, 40, 'Claims are broad or weakly supported by evidence.'),
        row('Organization', 18, 30, 'Basic essay structure with minor organizational flaws.'),
        row('Audience Awareness', 25, 30, 'Appropriate inclusive tone and language.'),
      ],
    });
    expect(result.score).toBe(65);
    expect(result.aiScoreCorrectedFrom).toBe(67);
  });

  it('records the correction without raising a banner over it', () => {
    // The rebuild is arithmetic, and arithmetic done by code is not something
    // a teacher can usefully be asked to check: the criteria that produced the
    // new number are printed directly under the banner, and the paper is going
    // to be validated by hand either way. Warning about it fired on ordinary
    // correctly-graded papers and taught teachers to skim the amber triangle,
    // which is what the band-mismatch case below actually needs.
    //
    // So the correction is kept as a FACT on the result (and logGradingEvent
    // writes it to the grading log), and kept out of the teacher-facing note.
    const result = check({
      score: 67,
      rubricScores: [row('A', 22, 40, ''), row('B', 18, 30, ''), row('C', 25, 30, '')],
    });
    expect(result.score).toBe(65);
    expect(result.aiScoreCorrectedFrom).toBe(67);
    expect(result.rubricScoreNote).toBeNull();
  });

  it('still flags a band mismatch on a paper whose total was also rebuilt', () => {
    // The two checks are independent: silencing the arithmetic one must not
    // take the judgement one down with it when both are true of one paper.
    const result = check({
      score: 99,
      rubricScores: [
        row('A', 22, 40, 'Developing (20-27 pts): Claims are broad.'),
        row('B', 28, 30, 'Proficient (21-26 pts): Appropriate tone.'),
      ],
    });
    expect(result.aiScoreCorrectedFrom).toBe(99);
    expect(result.rubricScoreNote).toContain('21-26');
  });

  it('scales against the rubric\'s own total, not against 100', () => {
    // A rubric out of 50 is valid (validateRubric only rejects a zero total),
    // so 40/50 is 80% — and a rubric out of the activity's own points, which is
    // what an uploaded one is divided into now, lands the same way.
    const result = check({ score: 80, rubricScores: [row('A', 20, 25, ''), row('B', 20, 25, '')] });
    expect(result.score).toBe(80);
    expect(result.aiScoreCorrectedFrom).toBeNull();
  });

  it('allows a point of rounding slack before it says anything', () => {
    // 22 + 18 + 25 = 65 exactly; the model reporting 65.4 is rounding, not a
    // contradiction. Flagging it would train teachers to ignore the banner —
    // though the score itself still comes from the criteria.
    const result = check({
      score: 65.4,
      rubricScores: [row('A', 22, 40, ''), row('B', 18, 30, ''), row('C', 25, 30, '')],
    });
    expect(result.score).toBe(65);
    expect(result.aiScoreCorrectedFrom).toBeNull();
    expect(result.rubricScoreNote).toBeNull();
  });

  it('clamps a rebuilt total that a criterion pushed over 100', () => {
    // The only way the breakdown itself can exceed 100: a criterion scored
    // above its own maximum. Clamped, and flagged as out of range, because the
    // criterion is what is wrong and the teacher has to see that.
    const result = check({ score: 105, rubricScores: [row('A', 60, 50, ''), row('B', 50, 50, '')] });
    expect(result.score).toBe(100);
    expect(result.scoreOutOfRange).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Falling back to the model's own number
// ───────────────────────────────────────────────────────────────────────────
describe('when the breakdown cannot be used, the model\'s own score stands', () => {
  it('keeps the headline when there is no rubric breakdown at all', () => {
    expect(check({ score: 80 }).score).toBe(80);
    expect(check({ score: 80, rubricScores: [] }).score).toBe(80);
  });

  it('keeps the headline when a criterion is missing its maximum', () => {
    // The sum cannot be computed, so it must not fall through to comparing —
    // or worse, dividing — against zero.
    const result = check({ score: 80, rubricScores: [row('A', 20, null, ''), row('B', 20, 25, '')] });
    expect(result.score).toBe(80);
    expect(result.aiScoreCorrectedFrom).toBeNull();
  });

  it('returns null rather than zero for an unusable breakdown', () => {
    // Null means "cannot be worked out"; a caller reading a 0 here would hand
    // every unparseable paper a zero.
    expect(rubricTotalPercent({ rubricScores: [row('A', 20, 0, '')] })).toBeNull();
    expect(rubricTotalPercent({ rubricScores: [] })).toBeNull();
    expect(rubricTotalPercent({})).toBeNull();
  });

  it('still clamps a headline the model put out of range', () => {
    const result = check({ score: 120 });
    expect(result.score).toBe(100);
    expect(result.scoreOutOfRange).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. A score against the band it claims — flagged, never corrected
// ───────────────────────────────────────────────────────────────────────────
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

  it('does not correct it — only a person who read the paper can settle it', () => {
    // 22 + 30 + 28 = 80/100. The band disagreement is real and reported, and
    // the criterion score is left exactly as the model gave it.
    const result = check({
      score: 80,
      rubricScores: [
        row('Content & Evidence', 22, 40, 'Developing (20-27 pts): Claims are broad.'),
        row('Organization', 30, 30, 'Outstanding (27-30 pts): Masterful structure.'),
        row('Audience Awareness', 28, 30, 'Proficient (21-26 pts): Appropriate inclusive tone.'),
      ],
    });
    expect(result.score).toBe(80);
    expect(result.rubricScores[2].score).toBe(28);
    expect(result.rubricScoreNote).toContain('Audience Awareness');
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
    expect(rubricScoreNoteFor(raw)).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. Nothing to check
// ───────────────────────────────────────────────────────────────────────────
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
});
