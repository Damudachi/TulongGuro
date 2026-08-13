import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The AI must never supply the rubric it grades against.
 *
 * Our adviser's position is that writing a rubric is the teacher's job. Acting
 * on that means more than deleting the "generate a rubric" line from the
 * curriculum parser — the grader had its own invented rubric, a generic DepEd
 * essay rubric hardcoded into the prompt string, used whenever an activity had
 * none. A teacher who left the rubric blank was not refused; their pupils were
 * graded against a standard nobody in the school had written, with nothing on
 * screen to say so.
 *
 * So the rule these tests hold is: two tiers, both human-written, and a refusal
 * when neither is there.
 *
 * Loaded through createRequire for the same reason route-wiring.test.js does:
 * server.js is CommonJS, and Vitest's module runner would hand back a second
 * copy of it.
 */

const require = createRequire(import.meta.url);
const { resolveGradingRubric } = require('../server.js');

const CRITERIA = [
  { name: 'Content & Ideas', points: 60, description: 'Depth of the argument.' },
  { name: 'Organization', points: 40, description: 'Structure and flow.' },
];
const LESSON_CRITERIA = [{ name: 'Retelling', points: 100, description: 'Accuracy of the retelling.' }];

/** An activity as the grader receives it — rubric fields are JSON strings. */
const activityWith = ({ rubric, lessonRubric, topic } = {}) => ({
  id: 'act-1',
  title: 'Narrative Essay',
  type: 'Essay',
  rubric: rubric === undefined ? null : rubric,
  topic: topic || null,
  classLesson: lessonRubric === undefined ? null : { title: 'Week 3', defaultRubric: lessonRubric },
});

describe('resolveGradingRubric — what the AI is allowed to grade against', () => {
  it("uses the activity's own rubric when the teacher set one", () => {
    const resolved = resolveGradingRubric(activityWith({ rubric: JSON.stringify({ criteria: CRITERIA }) }));

    expect(resolved.criteria).toEqual(CRITERIA);
    expect(resolved.parseFailed).toBe(false);
  });

  it('falls back to the curriculum lesson rubric for activities created before this change', () => {
    const resolved = resolveGradingRubric(activityWith({
      lessonRubric: JSON.stringify({ criteria: LESSON_CRITERIA }),
    }));

    expect(resolved.criteria).toEqual(LESSON_CRITERIA);
    expect(resolved.sourceLabel).toBe('from curriculum lesson plan');
  });

  it('prefers the activity rubric over the lesson it was mapped to', () => {
    const resolved = resolveGradingRubric(activityWith({
      rubric: JSON.stringify({ criteria: CRITERIA }),
      lessonRubric: JSON.stringify({ criteria: LESSON_CRITERIA }),
    }));

    expect(resolved.criteria).toEqual(CRITERIA);
  });

  it('refuses rather than inventing one when the teacher left the rubric blank', () => {
    const resolved = resolveGradingRubric(activityWith({}));

    // Null is the whole point. Anything else here means something in the
    // grader is still willing to write a rubric on a teacher's behalf.
    expect(resolved.criteria).toBeNull();
  });

  it('still refuses when the activity carries a DepEd topic that recommends a template', () => {
    // This was tier 3. A topic tag is a curriculum mapping, not a decision by
    // the teacher about how this particular work should be marked, so it must
    // not silently become the rubric of record.
    const resolved = resolveGradingRubric(activityWith({ topic: 'narrative-writing' }));

    expect(resolved.criteria).toBeNull();
  });

  it('refuses when the only rubric present cannot be read, and says so', () => {
    // Distinct from having no rubric at all: a rubric genuinely existed here.
    // The teacher needs to know it was unreadable rather than assume they never
    // set one.
    const resolved = resolveGradingRubric(activityWith({ rubric: '{ not json' }));

    expect(resolved.criteria).toBeNull();
    expect(resolved.parseFailed).toBe(true);
  });

  it('treats a rubric with an empty criteria list as no rubric', () => {
    const resolved = resolveGradingRubric(activityWith({ rubric: JSON.stringify({ criteria: [] }) }));

    expect(resolved.criteria).toBeNull();
  });

  it('refuses when there is no activity to read a rubric from', () => {
    expect(resolveGradingRubric(null).criteria).toBeNull();
  });
});

/**
 * Source-level guards.
 *
 * The two deletions below are one line each and would be trivially easy to
 * reintroduce — the generic rubric in particular reads like a helpful default
 * rather than the policy violation it is. verify-route-authorization.js already
 * establishes that static checks over server.js are a thing we do.
 */
describe('the invented rubrics are gone from the source', () => {
  const serverSource = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js'),
    'utf8'
  );

  it('carries no hardcoded fallback rubric for the grader to use', () => {
    expect(serverSource).not.toContain('Use standard DepEd essay rubric');
  });

  it('does not ask the curriculum parser to generate rubrics', () => {
    expect(serverSource).not.toContain('generate a default grading rubric');
    expect(serverSource).not.toMatch(/Generate 3-4 criteria per rubric/);
  });
});
