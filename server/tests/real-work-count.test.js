import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

/**
 * What "has submitted work" is allowed to mean.
 *
 * Enrolling a learner back-fills one PENDING submission row per activity that
 * already exists in their section's classes, so the activity roster can list
 * everybody as awaiting work. Those rows carry no image and no score — they
 * are placeholders for work that has not happened.
 *
 * Every count of `submissions` counted them anyway. Three things went wrong
 * with that, all from the same cause:
 *
 *   1. The admin roster badged a learner enrolled sixty seconds ago with
 *      "2 submitted" and a warning triangle. Found by hand, exactly that way.
 *   2. Deleting a class was refused — "this class has 2 student submission(s)"
 *      — when nobody had submitted anything to it.
 *   3. Removing a learner kept their account instead of deleting it, on the
 *      grounds that work had to survive. There was no work.
 *
 * The predicate below is the codebase's own, already used by the AI-check
 * route to find work worth grading: a row counts when something is actually
 * on it. An image means they turned something in; a score means a mark was
 * recorded even where no image was uploaded, which is how manual score entry
 * writes. A bare placeholder has none of the three.
 */

const require = createRequire(import.meta.url);
const { REAL_WORK } = require('../access.js');

/** The shapes the database actually holds, as the fixtures above describe them. */
const placeholder = { imageUrl: null, aiScore: null, hitlScore: null, status: 'PENDING' };
const uploadedAwaitingGrade = { imageUrl: 'https://…/page.jpg', aiScore: null, hitlScore: null, status: 'PENDING' };
const manuallyScored = { imageUrl: null, aiScore: null, hitlScore: 88, status: 'GRADED' };
const aiScoredNoImage = { imageUrl: null, aiScore: 74, hitlScore: null, status: 'GRADED' };
const fullyGraded = { imageUrl: 'https://…/page.jpg', aiScore: 74, hitlScore: 80, status: 'GRADED' };

/**
 * Applies the Prisma `OR` filter to a plain object, the way the database would.
 * The filter is data, so it can be checked without a database — and it has to
 * be, because getting it wrong is silent: the count simply comes back wrong.
 */
function matches(filter, row) {
  return filter.OR.some(clause => {
    const [field, condition] = Object.entries(clause)[0];
    if ('not' in condition) return row[field] !== condition.not;
    throw new Error(`unhandled condition on ${field}: ${JSON.stringify(condition)}`);
  });
}

describe('REAL_WORK separates submitted work from an enrolment placeholder', () => {
  it('does not count a placeholder created by enrolling a learner', () => {
    expect(matches(REAL_WORK, placeholder)).toBe(false);
  });

  it('counts work that was uploaded but not yet graded', () => {
    expect(matches(REAL_WORK, uploadedAwaitingGrade)).toBe(true);
  });

  it('counts a mark entered by hand with no image', () => {
    // Score entry writes a grade without an upload. Reading "no image" as
    // "no work" would lose these, which is the mistake in the other
    // direction — and the one that silently deletes an account.
    expect(matches(REAL_WORK, manuallyScored)).toBe(true);
  });

  it('counts an AI score with no image', () => {
    expect(matches(REAL_WORK, aiScoredNoImage)).toBe(true);
  });

  it('counts an ordinary graded submission', () => {
    expect(matches(REAL_WORK, fullyGraded)).toBe(true);
  });

  it('is a filter Prisma can apply to a relation count', () => {
    // Shape matters as much as logic here: `_count: { select: { submissions:
    // { where: REAL_WORK } } }` only filters if this is a valid where clause.
    expect(Array.isArray(REAL_WORK.OR)).toBe(true);
    expect(REAL_WORK.OR.length).toBeGreaterThan(0);
    for (const clause of REAL_WORK.OR) {
      expect(Object.keys(clause)).toHaveLength(1);
      expect(Object.values(clause)[0]).toHaveProperty('not');
    }
  });
});
