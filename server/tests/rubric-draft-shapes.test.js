import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { draftReady, draftBlocker, draftCriteria } from '../../src/utils/useRubricDrafts.js';

/**
 * A curriculum rubric may be a band ladder, not only a percentage split.
 *
 * The server was fixed for this — validateRubric and schoolRubricRefusal both
 * branch on the shape, and the extractor deliberately does NOT rebase a banded
 * rubric's points, because re-pointing the criteria while the bands still read
 * the document's scale hands the grader two answers for what a criterion is out
 * of. The Add Curriculum form then undid all of it in the client:
 *
 *   1. readFile mapped each extracted criterion to {name, points, description},
 *      so every ladder the extractor had read was dropped before it was drawn.
 *   2. The card rendered RubricEditor with no `type`, which defaults to
 *      standard — so a 4/3/3 band rubric was labelled "10% / 100%" in amber.
 *   3. draftReady demanded `totalWeight === 100` whatever the shape.
 *   4. Neither save path sent `type`.
 *
 * Together those made a banded rubric unpublishable rather than merely ugly:
 * the card could never be ready, so blockingMessage held the whole Publish at
 * "still needs criteria weights totalling 100%" — a demand satisfiable only by
 * retyping the ladder as percentages, which misstates the rubric the school
 * marks with. The bands were gone by then anyway.
 *
 * These pin the client rule to the server's. The last two are source checks,
 * because a rule agreed in this file and then not sent over the wire is exactly
 * how (4) hid behind (3).
 */

const SRC = new URL('../../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (p) => readFileSync(join(SRC, p), 'utf8');

/** A card of the shape the hook builds, with whatever the test overrides. */
const draft = (over = {}) => ({
  id: 1, mode: 'manual', type: 'standard', name: 'Narrative Writing',
  criteria: [], fileName: '', isReading: false, error: '', scaledFrom: null,
  ...over,
});

const BANDS = [
  { label: 'Excellent', score: 4, description: 'Exceeds expectations.' },
  { label: 'Good', score: 2, description: 'Meets most expectations.' },
  { label: 'Needs Improvement', score: 1, description: 'Does not meet.' },
];

/** 4 + 3 + 3 = 10, as the uploaded rubric in the bug report reads. */
const BANDED_CRITERIA = [
  { name: 'Story Elements & Schema Connection', points: 4, description: '', bands: BANDS },
  { name: 'Appropriate Expression', points: 3, description: '', bands: BANDS },
  { name: 'Length & Organization', points: 3, description: '', bands: BANDS },
];

describe('a banded curriculum rubric is publishable', () => {
  it('is ready even though its weights total 10, not 100', () => {
    expect(draftReady(draft({ type: 'range', criteria: BANDED_CRITERIA }))).toBe(true);
  });

  it('is ready when the shape is carried by the bands alone', () => {
    // The card's `type` can be a placeholder: an upload adds the card before
    // the extraction comes back, so the ladder may arrive on a card still
    // labelled standard. Judging the shape by the criteria is what stops that
    // window from refusing a rubric that is plainly banded.
    expect(draftReady(draft({ type: undefined, criteria: BANDED_CRITERIA }))).toBe(true);
  });

  it('is never told to make its weights total 100', () => {
    // The message is the defect here as much as the boolean was: it named a
    // rule this rubric does not have, and pointed the admin at the one thing
    // they should not change.
    const unpointed = BANDED_CRITERIA.map(c => ({ ...c, points: 0 }));
    expect(draftBlocker(draft({ type: 'range', criteria: unpointed }))).not.toMatch(/100/);
  });

  it('still needs points on something, so nothing scoreable is saved empty', () => {
    const unpointed = BANDED_CRITERIA.map(c => ({ ...c, points: 0 }));
    expect(draftReady(draft({ type: 'range', criteria: unpointed }))).toBe(false);
  });
});

describe('the 100% rule still holds for the standard shape', () => {
  const standard = [
    { name: 'Content', points: 60, description: '' },
    { name: 'Grammar', points: 40, description: '' },
  ];

  it('accepts weights totalling 100', () => {
    expect(draftReady(draft({ criteria: standard }))).toBe(true);
  });

  it('refuses weights that do not, and says the total it found', () => {
    const short = [{ name: 'Content', points: 60, description: '' }];
    expect(draftBlocker(draft({ criteria: short }))).toMatch(/60%/);
  });

  it('refuses a card with no name whichever shape it is', () => {
    expect(draftReady(draft({ name: '  ', type: 'range', criteria: BANDED_CRITERIA }))).toBe(false);
    expect(draftReady(draft({ name: '  ', criteria: standard }))).toBe(false);
  });
});

describe('readiness is judged on the criteria that will actually be sent', () => {
  // Unnamed rows are dropped by the save, not refused. Counting them here made
  // a card ready on 60 + an unnamed 40, then sent the 60 alone — and the server
  // refused it for not totalling 100. Ready on screen, rejected on save, and
  // the reason named a criterion the admin could no longer see.
  const withBlankRow = [
    { name: 'Content', points: 60, description: '' },
    { name: '   ', points: 40, description: '' },
  ];

  it('drops the unnamed row from what is sent', () => {
    expect(draftCriteria(draft({ criteria: withBlankRow }))).toHaveLength(1);
  });

  it('does not count the unnamed row towards the total', () => {
    expect(draftReady(draft({ criteria: withBlankRow }))).toBe(false);
    expect(draftBlocker(draft({ criteria: withBlankRow }))).toMatch(/60%/);
  });
});

describe('the shape survives the trip to the server', () => {
  it('keeps the bands when an uploaded rubric is read into a card', () => {
    // The one line this whole file exists for. A mapping that names its fields
    // drops anything it does not name, and `bands` is the entire content of a
    // range rubric — a rubric without them is a bare points split.
    const hook = read('utils/useRubricDrafts.js');
    expect(hook).toMatch(/bands/);
  });

  it('sends the type from both places a curriculum rubric is saved', () => {
    // Inferred server-side from criteria[0] alone when absent, so a rubric
    // whose first criterion happens to carry no ladder would be held to the
    // 100% rule its other criteria were never written for.
    for (const file of ['pages/admin/Curriculum.jsx', 'components/CurriculumEditor.jsx']) {
      expect(read(file), `${file} saves a rubric without its type`).toMatch(/type:\s*draft\.type/);
    }
  });

  it('tells the editor which shape to draw', () => {
    // Without this the table renders standard columns and the amber
    // "10% / 100%" badge over a rubric that has no total to hit.
    expect(read('components/RubricDrafts.jsx')).toMatch(/<RubricEditor[^\n]*type=\{type\}/);
  });
});
