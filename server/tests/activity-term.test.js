import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Terms, and curriculum lessons as topic tags.
 *
 * Two changes that lean on each other. `Activity.term` is what the gradebook
 * and its exports filter on, so the rules about what counts as a term — and
 * what "not said" means — have to hold or work silently drops out of a
 * teacher's record. And a curriculum lesson can now be tagged onto an activity
 * the same way a DepEd competency can, which is what makes the coverage
 * checklist work outside Grade 6 English: the competency map in this repo is
 * that one subject and nothing else, so before this every other subject had a
 * single-select lesson dropdown and no way to say an activity spanned two
 * weeks.
 *
 * Loaded through createRequire for the same reason route-wiring.test.js does:
 * these modules are CommonJS.
 */

const require = createRequire(import.meta.url);
const {
  termForWeek, weeksForWeekRef, getAllTopics,
  lessonTopicId, lessonIdFromTopicId, isLessonTopicId, lessonIdsFromTopics,
  parseTopicIds, formatTopicIds,
} = require('../depedTopics.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const readSource = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');

describe('weeksForWeekRef — which weeks a competency belongs to', () => {
  it('reads a single week', () => {
    expect(weeksForWeekRef('Term 1, Week 5')).toEqual([5]);
  });

  it('does not mistake the term number for a week', () => {
    // The regression this guards: matching every number in the string put
    // "Term 2" into the week list, and filtering small numbers back out to
    // compensate silently lost weeks 1 to 3 — the whole start of the year.
    expect(weeksForWeekRef('Term 1, Week 1')).toEqual([1]);
    expect(weeksForWeekRef('Term 1, Week 3')).toEqual([3]);
    expect(weeksForWeekRef('Term 2, Week 14')).toEqual([14]);
  });

  it('reads a competency taught across two weeks', () => {
    // "Weeks 14 & 18" is one competency revisited later in the term. Taking
    // only the first would leave the week-18 lesson unable to find it.
    expect(weeksForWeekRef('Term 2, Weeks 14 & 18')).toEqual([14, 18]);
  });

  it('has nothing to say about a missing or malformed reference', () => {
    expect(weeksForWeekRef('')).toEqual([]);
    expect(weeksForWeekRef(null)).toEqual([]);
    expect(weeksForWeekRef('Term 3')).toEqual([]);
  });

  it('places every competency in the shipped map', () => {
    // The auto-tick in the Activity Builder matches a lesson's week against
    // these, so a competency with no week is one that can never be suggested.
    for (const topic of getAllTopics()) {
      expect(topic.weeks.length, `${topic.id} (${topic.weekRef})`).toBeGreaterThan(0);
    }
  });

  it('agrees with the term each competency states for itself', () => {
    for (const topic of getAllTopics()) {
      for (const week of topic.weeks) {
        expect(termForWeek(week), `${topic.id} week ${week}`).toBe(topic.term);
      }
    }
  });
});

describe('termForWeek — placing a curriculum lesson in a term', () => {
  it('splits the year the way the competency map does', () => {
    expect(termForWeek(1)).toBe(1);
    expect(termForWeek(12)).toBe(1);
    expect(termForWeek(13)).toBe(1);
    expect(termForWeek(14)).toBe(2);
    expect(termForWeek(26)).toBe(2);
    expect(termForWeek(27)).toBe(3);
    expect(termForWeek(40)).toBe(3);
  });

  it('places nothing when there is no week to go on', () => {
    // A lesson with no week number is shown in every term rather than hidden
    // from all of them, and that rests on this returning null, not 1.
    expect(termForWeek(null)).toBeNull();
    expect(termForWeek(undefined)).toBeNull();
    expect(termForWeek('')).toBeNull();
    expect(termForWeek(0)).toBeNull();
    expect(termForWeek('not a number')).toBeNull();
  });
});

describe('lesson tags — curriculum lessons in the topic column', () => {
  it('round-trips a lesson id', () => {
    const id = lessonTopicId('9f3c-abc');
    expect(isLessonTopicId(id)).toBe(true);
    expect(lessonIdFromTopicId(id)).toBe('9f3c-abc');
  });

  it('never mistakes a DepEd competency for a lesson', () => {
    // The two share one column, so this is the whole basis of telling them
    // apart: competency ids are slugs and contain no colon.
    for (const topic of getAllTopics()) {
      expect(isLessonTopicId(topic.id), topic.id).toBe(false);
      expect(lessonIdFromTopicId(topic.id)).toBeNull();
    }
  });

  it('pulls the lessons out of a mixed tag list, in order', () => {
    const stored = formatTopicIds([
      't1-02-hyperbole-irony',
      lessonTopicId('lesson-a'),
      't1-04-summary-literary-texts',
      lessonTopicId('lesson-b'),
    ]);
    expect(lessonIdsFromTopics(stored)).toEqual(['lesson-a', 'lesson-b']);
    // And the competencies are still there — one column, both kinds.
    expect(parseTopicIds(stored)).toHaveLength(4);
  });

  it('reads an activity that has only lessons tagged', () => {
    // The normal case outside Grade 6 English, where no competency map exists.
    expect(lessonIdsFromTopics(`${lessonTopicId('only-one')}`)).toEqual(['only-one']);
  });

  it('finds no lessons on an activity tagged before lessons were taggable', () => {
    expect(lessonIdsFromTopics('t1-02-hyperbole-irony')).toEqual([]);
    expect(lessonIdsFromTopics('')).toEqual([]);
    expect(lessonIdsFromTopics(null)).toEqual([]);
  });
});

describe('normalizeTerm — what the server will store', () => {
  // Read off the source rather than imported: server.js opens a database
  // connection and starts listening on import, which the rest of this suite
  // deliberately avoids. The rules matter more than the binding.
  const source = readSource('server.js');

  it('accepts only the three real terms', () => {
    const body = source.slice(source.indexOf('function normalizeTerm'));
    expect(body).toContain('n === 1 || n === 2 || n === 3');
  });

  it('treats a blank as unsaid rather than defaulting to Term 1', () => {
    // A wrong term is worse than an absent one: an activity silently filed
    // under Term 1 appears in a report it has no business in and vanishes
    // from the one it belongs to.
    const body = source.slice(source.indexOf('function normalizeTerm'));
    expect(body).toMatch(/value === ''\) return null/);
  });

  it('lets an edit clear the term back to unsaid', () => {
    // `if (term !== undefined)` and not `if (term)` — the second would make
    // clearing impossible, since '' is falsy.
    expect(source).toContain('if (term !== undefined) updateData.term = normalizeTerm(term);');
  });
});

describe('the export follows the term filter', () => {
  const source = readSource('server.js');

  it('reads the term off the request', () => {
    expect(source).toContain('const exportTerm = normalizeTerm(req.query.term);');
  });

  it('leaves untagged activities out of a single-term export', () => {
    // Quietly folding work nobody has placed into a term would put a number
    // on a report card the teacher never agreed to.
    expect(source).toContain("a.term === exportTerm");
  });

  it('filters carried-over work by term too', () => {
    // Otherwise a Term 2 sheet carries a transferred learner's Term 1 marks
    // from their old section into a Term 2 average — and only for the
    // learners who happened to move.
    expect(source).toContain("sub.activity?.term === exportTerm");
    expect(source).toContain('term: true,');
  });

  it('states its scope on the sheet', () => {
    expect(source).toContain('const termNotice =');
    expect(source).toContain("sheet.addRow(['Term:', termNotice(untaggedExcluded)]);");
    expect(source).toContain('# Term: ${termNotice(untaggedExcluded)}');
  });

  it('states its scope in the filename, in both formats', () => {
    // Two exports of the same class for two terms otherwise land in a
    // downloads folder under one name, and are indistinguishable once open.
    // The CSV branch used to omit the term entirely, so the collision was
    // real there and not just theoretical.
    const { exportFileName } = require('../server.js');
    const classData = [{ cls: { name: 'English Grade 6 - Newton', section: { name: 'Newton' } } }];

    for (const format of ['xlsx', 'csv']) {
      const t1 = exportFileName(classData, 1, format);
      const t2 = exportFileName(classData, 2, format);
      const wholeYear = exportFileName(classData, null, format);

      expect(t1).toContain('_Term-1_');
      expect(t2).toContain('_Term-2_');
      expect(wholeYear).not.toContain('Term');
      expect(new Set([t1, t2, wholeYear]).size).toBe(3);
      expect(t1.endsWith(`.${format}`)).toBe(true);
    }
  });

  it('names the file after the class, not its id', () => {
    // It used to be named `grades_<uuid>.xlsx` by the page, which is both
    // unreadable and identical in shape for every class a teacher exports.
    const { exportFileName } = require('../server.js');
    const name = exportFileName(
      [{ cls: { name: 'English Grade 6 - Newton', section: { name: 'Newton' } } }], null, 'xlsx'
    );
    // One hyphen per run of punctuation, not one underscore per character.
    expect(name).toMatch(/^English-Grade-6-Newton_Grades_\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});
