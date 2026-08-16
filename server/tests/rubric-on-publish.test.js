import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

/**
 * A rubric is required before an activity can be published.
 *
 * It used to be optional, and the gap only surfaced at marking time: AI
 * checking refuses to run without a rubric (409 NO_RUBRIC) and the review
 * screen has no criteria to score against, so a teacher could set the work,
 * collect a class set of papers, and only then find out that none of it could
 * be checked. The requirement lives on the server because the form is not the
 * only thing that can POST to it.
 *
 * These test the predicate the guard is built on. What counts as "no rubric" is
 * the part worth pinning down: the form omits the field entirely, but the same
 * intent arrives as "null", "{}" and an empty criteria list, and every one of
 * those has to be caught — one that slipped through would publish exactly the
 * un-markable activity the rule exists to prevent.
 *
 * Loaded through createRequire for the same reason route-wiring.test.js does:
 * server.js is CommonJS, and Vitest's module runner would hand back a second copy.
 */

const require = createRequire(import.meta.url);
const { rubricIsPresent, isManualScoreMode } = require('../server.js');

const REAL_RUBRIC = JSON.stringify({
  source: 'manual',
  type: 'standard',
  criteria: [
    { name: 'Content & Ideas', points: 60, description: 'Depth of the argument.' },
    { name: 'Organization', points: 40, description: 'Structure and flow.' },
  ],
});

describe('what counts as having a rubric', () => {
  it('accepts a rubric with criteria in it', () => {
    expect(rubricIsPresent(REAL_RUBRIC)).toBe(true);
  });

  it('accepts a bare criteria array, which is how older rubrics were stored', () => {
    expect(rubricIsPresent(JSON.stringify([{ name: 'Retelling', points: 100 }]))).toBe(true);
  });

  it('accepts an already-parsed object, so the check does not depend on the wire format', () => {
    expect(rubricIsPresent({ criteria: [{ name: 'Retelling', points: 100 }] })).toBe(true);
  });

  it('refuses every shape that means "nothing was attached"', () => {
    for (const empty of [undefined, null, '', 'null', '{}', '[]',
      JSON.stringify({ source: 'manual', type: 'standard', criteria: [] })]) {
      expect(rubricIsPresent(empty), `${JSON.stringify(empty)} should not count as a rubric`).toBe(false);
    }
  });

  it('refuses text that is not a rubric at all rather than throwing', () => {
    // validateRubric() has already refused a malformed payload with its own
    // message by this point; this only has to not explode.
    expect(rubricIsPresent('not json')).toBe(false);
  });
});

describe('the one mode exempt from the requirement', () => {
  it('exempts scores-only work, which is typed in and never read', () => {
    expect(isManualScoreMode('MANUAL_SCORE')).toBe(true);
    expect(isManualScoreMode('manual_score')).toBe(true);
  });

  it('does not exempt the modes that produce a paper to mark', () => {
    expect(isManualScoreMode('TEACHER_UPLOAD')).toBe(false);
    expect(isManualScoreMode('STUDENT_SUBMIT')).toBe(false);
    // An absent mode defaults to TEACHER_UPLOAD on create, so it is not exempt.
    expect(isManualScoreMode(undefined)).toBe(false);
    expect(isManualScoreMode(null)).toBe(false);
  });
});
