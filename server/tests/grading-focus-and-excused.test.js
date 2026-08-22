import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Two things a QA pass over the AI checker and Analytics turned up, both of
 * them silent.
 *
 * 1. TOPIC FOCUS RULE — the prompt's strongest "mark these and nothing else"
 *    instruction — was gated on the guidance string produced by the retired
 *    DepEd competency map. Once tagging moved to curriculum lessons that
 *    string is empty for every newly created activity, so the rule stopped
 *    being sent at all and grading widened back out to whatever the model
 *    thought was worth saying.
 *
 * 2. Excusing a submission sets excusedAt and deliberately leaves `status`
 *    alone, so a paper marked and then excused is still 'GRADED' and still
 *    carries its score. The average drops it (toGradeEntries filters excused);
 *    the points total printed beside the average did not.
 *
 * Both are checked against the source: the prompt is assembled inside a
 * function that needs a database and a live model to run, and the property
 * that matters is which branch the text is behind.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'server.js'), 'utf8');
const analytics = fs.readFileSync(
  path.join(here, '..', '..', 'src', 'pages', 'teacher', 'Analytics.jsx'), 'utf8');

describe('TOPIC FOCUS RULE reaches lesson-tagged activities', () => {
  it('is no longer gated on the retired map alone', () => {
    // The regression: `${topicGuidance ? ... : ''}` meant no DepEd tag, no rule.
    expect(source).not.toMatch(/\$\{topicGuidance \? `\\nTOPIC FOCUS RULE/);
    expect(source).toContain('${topicFocusRule}');
  });

  it('fires when curriculum lessons supplied competencies', () => {
    expect(source).toContain('lessonCompetencyCount > 0');
    expect(source).toContain("'This activity is mapped to the curriculum lesson(s) and Learning Competencies set out above.'");
  });

  it('still fires for an activity tagged from the retired map', () => {
    // Legacy tags must not lose the rule on the way past.
    expect(source).toContain('This activity is mapped to the following topic(s)/lesson(s): ${topicGuidance}');
  });

  it('sends nothing when there is nothing to focus on', () => {
    // A class with no curriculum and no legacy tag has no competencies, and an
    // empty focus rule is better than one naming nothing.
    expect(source).toMatch(/const topicFocusRule = focusSource\s*\?/);
    expect(source).toMatch(/:\s*'';/);
  });

  it('counts competencies as each lesson block is built', () => {
    // Counted inside lessonBlock so the primary lesson and every ALSO COVERS
    // lesson contribute — a count taken from the primary alone would leave a
    // multi-week activity without the rule whenever week one happened to list
    // no competencies.
    expect(source).toContain('lessonCompetencyCount += competencies.length;');
  });
});

describe('the lesson context is never emitted headless', () => {
  it('heads the extra lessons as their own section only when a primary exists', () => {
    // An activity can carry lesson tags with no classLessonId, and a prompt
    // opening on a bare "ALSO COVERS:" reads as a truncated section rather
    // than as the whole of what the work was set against.
    expect(source).toContain('classLessonContext += classLessonContext');
    expect(source).toContain('`\\nALSO COVERS:\\n`');
    expect(source).toContain('`\\nCURRICULUM LESSON CONTEXT:\\n`');
  });
});

describe('excused work is out of the analytics totals', () => {
  it('is reported by the endpoint at all', () => {
    // Without the field the screen cannot tell an excused paper from a graded
    // one — they share a status and a score.
    expect(source).toContain('excusedAt: s.excusedAt, excusedReason: s.excusedReason,');
  });

  it('is excluded from points earned and from the graded count', () => {
    expect(analytics).toContain("s.status === 'GRADED' && !s.excusedAt");
  });

  it('shrinks the denominator too, so the count cannot exceed it', () => {
    // Dropping excused work from the numerator alone would show "8/10" for a
    // learner who handed in everything they were asked to.
    //
    // Counted off the rows the page is actually showing, not off the payload's
    // totalSubmissions: that total spans every subject, so once the screen
    // could be narrowed to one it became a denominator for a list that was no
    // longer on screen — "3/17 graded" above four activities. The two are the
    // same number whenever no subject is selected.
    expect(analytics).toContain('visibleSubmissions.length - excusedCount');
    // Both sides of the fraction read from the same scoped set. A numerator
    // built from the whole payload would climb past the denominator the moment
    // a subject was picked.
    expect(analytics).toContain('const graded = visibleSubmissions.filter');
    expect(analytics).toContain('const excusedCount = visibleSubmissions.filter(s => s.excusedAt).length;');
  });

  it('is drawn as excused in the activity list, not as a score', () => {
    expect(analytics).toContain('const isExcused = !!sub.excusedAt;');
    expect(analytics).toContain("const isGraded = !isExcused && sub.status === 'GRADED'");
  });

  it('says how many were left out, rather than leaving a silent gap', () => {
    expect(analytics).toMatch(/excusedCount > 0/);
  });
});

describe('a class with no curriculum says so', () => {
  const builder = fs.readFileSync(
    path.join(here, '..', '..', 'src', 'pages', 'teacher', 'ActivityBuilder.jsx'), 'utf8');

  it('explains the missing control instead of hiding it', () => {
    // Retiring the DepEd list removed the fallback a Grade 6 English class had
    // when its curriculum was never uploaded. The capability loss is real; it
    // must not also be invisible.
    expect(builder).toContain('!lessonTopicApplies && lessonsLoaded');
    expect(builder).toContain('No curriculum lessons for this class.');
  });

  it('waits for the fetch before claiming there are none', () => {
    // Rendered on `lessonsLoaded`, so the warning cannot flash up for a class
    // whose lessons are simply still on their way.
    expect(builder).toContain('.finally(() => setLessonsLoaded(true));');
  });
});
