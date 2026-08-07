import { describe, it, expect } from 'vitest';
import { buildSteps } from '../../src/utils/setupSteps.js';

/**
 * The first-run checklist a teacher sees, which replaced the tour of the
 * seeded "[DEMO] Sandbox Demo Class".
 *
 * Worth testing rather than eyeballing because the whole point of the rewrite
 * is that progress is *derived* — if these predicates are wrong, the checklist
 * tells a teacher they have finished something they have not, which is
 * strictly worse than the tour that at least never claimed to know.
 */

const NOTHING = { sections: 0, students: 0, classes: 0, activities: 0, graded: 0, released: 0 };
const byId = (setup) => Object.fromEntries(buildSteps(setup).map((s) => [s.id, s]));

describe('a teacher who has just been given an account', () => {
  it('has nothing ticked', () => {
    expect(buildSteps(NOTHING).every((s) => !s.done)).toBe(true);
  });

  it('is asked for a block section first', () => {
    // Roster before everything else: student records are what the later steps
    // hang off, so any other order strands the teacher.
    expect(buildSteps(NOTHING)[0].id).toBe('roster');
    expect(byId(NOTHING).roster.cta).toBe('Create a block section');
  });

  it('is told what is missing before being sent to a dead end', () => {
    const steps = byId(NOTHING);
    expect(steps.activity.blockedBy).toBe('Create a class first');
    expect(steps.grade.blockedBy).toBe('Create an activity first');
  });

  it('survives being called with no data at all', () => {
    // The dashboard renders before the fetch resolves.
    expect(() => buildSteps(undefined)).not.toThrow();
    expect(() => buildSteps(null)).not.toThrow();
    expect(() => buildSteps({})).not.toThrow();
    expect(buildSteps(null).every((s) => !s.done)).toBe(true);
  });
});

describe('a section that exists but has no learners on it', () => {
  const setup = { ...NOTHING, sections: 1 };

  it('does not count as done — the roster is the point, not the section', () => {
    expect(byId(setup).roster.done).toBe(false);
  });

  it('says so, and changes what it asks for', () => {
    expect(byId(setup).roster.progress).toBe('1 section created — no learners on the list yet');
    expect(byId(setup).roster.cta).toBe('Add learners');
  });
});

describe('work that is marked but not released', () => {
  const setup = { sections: 1, students: 3, classes: 1, activities: 1, graded: 3, released: 0 };

  it('is not finished — a learner still cannot see any of it', () => {
    // The state a teacher is most likely to stop in without realising: the
    // marking felt like the work, and the release is one more click.
    expect(byId(setup).grade.done).toBe(false);
  });

  it('names the gap rather than showing a bare unticked box', () => {
    expect(byId(setup).grade.progress).toBe('3 papers checked — not released to learners yet');
    expect(byId(setup).grade.cta).toBe('Release checked work');
  });

  it('unblocks once released', () => {
    const released = byId({ ...setup, released: 3 });
    expect(released.grade.done).toBe(true);
    expect(released.grade.progress).toBe('3 papers released to learners');
  });
});

describe('a teacher part-way through', () => {
  it('ticks only what is actually there', () => {
    const steps = byId({ sections: 2, students: 41, classes: 1, activities: 0, graded: 0, released: 0 });
    expect(steps.roster.done).toBe(true);
    expect(steps.class.done).toBe(true);
    expect(steps.activity.done).toBe(false);
    expect(steps.grade.done).toBe(false);
    expect(steps.activity.blockedBy).toBeNull();     // a class exists now
  });

  it('counts real rosters in the plural correctly', () => {
    expect(byId({ ...NOTHING, sections: 2, students: 41 }).roster.progress)
      .toBe('41 students enrolled in 2 sections');
    expect(byId({ ...NOTHING, sections: 1, students: 1 }).roster.progress)
      .toBe('1 student enrolled in 1 section');
  });
});

describe('a fully set-up teacher', () => {
  const setup = { sections: 3, students: 120, classes: 4, activities: 12, graded: 40, released: 40 };

  it('has every step done, which is what takes the checklist off the dashboard', () => {
    expect(buildSteps(setup).every((s) => s.done)).toBe(true);
  });
});

describe('every step is renderable', () => {
  // The component maps over these directly, so a missing id or title is a
  // blank row rather than a crash — cheaper to catch here.
  for (const setup of [NOTHING, { sections: 1, students: 5, classes: 1, activities: 1, graded: 1, released: 1 }]) {
    it(`has an id, title, body and cta for every step (${JSON.stringify(setup)})`, () => {
      for (const step of buildSteps(setup)) {
        expect(step.id).toBeTruthy();
        expect(step.title).toBeTruthy();
        expect(step.body).toBeTruthy();
        expect(step.cta).toBeTruthy();
      }
    });
  }

  it('gives exactly one step no route, because its form is a modal', () => {
    const withoutRoute = buildSteps(NOTHING).filter((s) => !s.to);
    expect(withoutRoute.map((s) => s.id)).toEqual(['class']);
  });
});
