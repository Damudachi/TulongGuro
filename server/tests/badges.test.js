import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { computeBadges, isTop3 } = require('../badges.js');

/**
 * Badges are the one place the app tells a child what they have achieved, so
 * the failure that matters is a badge awarded for something that did not
 * happen. Every condition is checked both ways — earned and not — and the
 * boundaries are pinned, because "at exactly the passing grade" is the case a
 * comeback badge turns on.
 */

const PASSING = 75;

/** A graded submission. `day` orders it; the conditions read gradedAt. */
const sub = (percent, { day = 1, subject = 'English', gradeLevel = 'Grade 6',
                        type = 'Essay', isLate = false, strategy = null, skills = null } = {}) => ({
  hitlScore: percent,
  aiScore: null,
  isLate,
  readingStrategy: strategy,
  skillScores: skills ? JSON.stringify(skills) : null,
  gradedAt: `2026-03-${String(day).padStart(2, '0')}T00:00:00Z`,
  activity: { type, class: { subject, gradeLevel } },
});

const badge = (submissions, id, opts) =>
  computeBadges(submissions, PASSING, opts).find(b => b.id === id);

const earned = (submissions, id, opts) => badge(submissions, id, opts).earned;

describe('the badge set itself', () => {
  it('offers fifteen badges', () => {
    expect(computeBadges([], PASSING)).toHaveLength(15);
  });

  it('awards nothing to a learner with no graded work, rather than throwing', () => {
    const all = computeBadges([], PASSING);
    expect(all.every(b => !b.earned)).toBe(true);
  });

  it('survives submissions with no activity, class or subject attached', () => {
    // A carried-over or partially-loaded row must not take the page down.
    expect(() => computeBadges([{ hitlScore: 80 }], PASSING)).not.toThrow();
  });

  it('ignores work that has no mark at all', () => {
    expect(earned([{ hitlScore: null, aiScore: null, activity: {} }], 'first-steps')).toBe(false);
  });

  it('prefers the teacher\'s mark over the AI\'s, including a validated zero', () => {
    // The `??` rule from starsFor: a teacher-assigned 0 is falsy but real, and
    // must not fall through to the AI's original score.
    const s = { hitlScore: 0, aiScore: 95, activity: { type: 'Essay', class: { subject: 'English' } } };
    expect(earned([s], 'first-star')).toBe(false);
  });
});

describe('First Steps', () => {
  it('is earned on the very first graded activity', () => {
    expect(earned([sub(40)], 'first-steps')).toBe(true);
  });
});

describe('Comeback Kid', () => {
  it('is earned when a failing mark is followed by a pass in the same subject', () => {
    expect(earned([sub(68, { day: 1 }), sub(79, { day: 2 })], 'comeback-kid')).toBe(true);
  });

  it('is earned at exactly the passing grade, which is a pass', () => {
    expect(earned([sub(68, { day: 1 }), sub(PASSING, { day: 2 })], 'comeback-kid')).toBe(true);
  });

  it('is not earned one mark below passing', () => {
    expect(earned([sub(68, { day: 1 }), sub(PASSING - 1, { day: 2 })], 'comeback-kid')).toBe(false);
  });

  it('does not fire when the recovery is in a different subject', () => {
    // Failing Maths and passing English is not a comeback; it is two subjects.
    const s = [sub(60, { day: 1, subject: 'Mathematics' }), sub(90, { day: 2, subject: 'English' })];
    expect(earned(s, 'comeback-kid')).toBe(false);
  });

  it('does not fire on a pass that came before the failure', () => {
    // The order is the whole condition — a strong start then a dip is a slide,
    // not a recovery, and calling it one would be a lie to the child.
    expect(earned([sub(90, { day: 1 }), sub(60, { day: 2 })], 'comeback-kid')).toBe(false);
  });

  it('orders by when the mark was given, not the order it arrives in', () => {
    // The dashboard hands submissions over newest-first.
    const newestFirst = [sub(79, { day: 9 }), sub(68, { day: 2 })];
    expect(earned(newestFirst, 'comeback-kid')).toBe(true);
  });

  it('separates the same subject taught at two grade levels', () => {
    const s = [sub(60, { day: 1, gradeLevel: 'Grade 5' }), sub(90, { day: 2, gradeLevel: 'Grade 6' })];
    expect(earned(s, 'comeback-kid')).toBe(false);
  });

  it('follows the school\'s own passing grade, not a hardcoded 75', () => {
    const s = [sub(78, { day: 1 }), sub(84, { day: 2 })];
    expect(computeBadges(s, 80).find(b => b.id === 'comeback-kid').earned).toBe(true);
    expect(computeBadges(s, 75).find(b => b.id === 'comeback-kid').earned).toBe(false);
  });
});

describe('Turnaround', () => {
  it('needs a climb from below passing all the way to 90', () => {
    expect(earned([sub(55, { day: 1 }), sub(92, { day: 2 })], 'turnaround')).toBe(true);
  });

  it('is earned at exactly 90', () => {
    expect(earned([sub(55, { day: 1 }), sub(90, { day: 2 })], 'turnaround')).toBe(true);
  });

  it('is not earned at 89, where Comeback Kid still is', () => {
    const s = [sub(55, { day: 1 }), sub(89, { day: 2 })];
    expect(earned(s, 'turnaround')).toBe(false);
    expect(earned(s, 'comeback-kid')).toBe(true);
  });
});

describe('Steady Climber', () => {
  it('needs three rising marks in a row', () => {
    expect(earned([sub(50, { day: 1 }), sub(60, { day: 2 }), sub(70, { day: 3 })], 'steady-climber')).toBe(true);
  });

  it('is not earned on two rises broken by a dip', () => {
    const s = [sub(50, { day: 1 }), sub(60, { day: 2 }), sub(55, { day: 3 }), sub(65, { day: 4 })];
    expect(earned(s, 'steady-climber')).toBe(false);
  });

  it('does not count an equal mark as a rise', () => {
    expect(earned([sub(50, { day: 1 }), sub(60, { day: 2 }), sub(60, { day: 3 })], 'steady-climber')).toBe(false);
  });

  it('reports how far along the run is while still locked', () => {
    expect(badge([sub(50, { day: 1 }), sub(60, { day: 2 })], 'steady-climber').progress).toBe(2);
  });
});

describe('Personal Best', () => {
  it('is earned by beating an earlier mark in the same subject', () => {
    expect(earned([sub(70, { day: 1 }), sub(75, { day: 2 })], 'personal-best')).toBe(true);
  });

  it('is not earned by a first mark alone', () => {
    expect(earned([sub(95)], 'personal-best')).toBe(false);
  });

  it('is not earned by beating a different subject\'s score', () => {
    const s = [sub(90, { day: 1, subject: 'English' }), sub(50, { day: 2, subject: 'Mathematics' })];
    expect(earned(s, 'personal-best')).toBe(false);
  });
});

describe('Always On Time', () => {
  const onTime = (n, from = 1) =>
    Array.from({ length: n }, (_, i) => sub(80, { day: from + i, isLate: false }));

  it('needs five consecutive on-time submissions', () => {
    expect(earned(onTime(5), 'always-on-time')).toBe(true);
  });

  it('is not earned at four', () => {
    expect(earned(onTime(4), 'always-on-time')).toBe(false);
  });

  it('resets the run on a late submission', () => {
    const s = [...onTime(4), sub(80, { day: 5, isLate: true }), ...onTime(3, 6)];
    expect(earned(s, 'always-on-time')).toBe(false);
  });
});

describe('All-Rounder', () => {
  it('needs graded work in four subjects', () => {
    const s = ['English', 'Mathematics', 'Science', 'MAPEH'].map((subject, i) => sub(80, { day: i + 1, subject }));
    expect(earned(s, 'all-rounder')).toBe(true);
  });

  it('does not count the same subject four times', () => {
    expect(earned([1, 2, 3, 4].map(day => sub(80, { day })), 'all-rounder')).toBe(false);
  });
});

describe('Dedicated and Strategy Scholar', () => {
  it('Dedicated lands on the 25th graded activity', () => {
    const s = Array.from({ length: 25 }, (_, i) => sub(70, { day: (i % 28) + 1 }));
    expect(earned(s, 'dedicated')).toBe(true);
    expect(earned(s.slice(0, 24), 'dedicated')).toBe(false);
  });

  it('Strategy Scholar counts real strategies, not "N/A" filler', () => {
    const real = Array.from({ length: 10 }, (_, i) => sub(70, { day: i + 1, strategy: 'Try signpost words' }));
    expect(earned(real, 'strategy-scholar')).toBe(true);

    const filler = Array.from({ length: 10 }, (_, i) => sub(70, { day: i + 1, strategy: 'N/A' }));
    expect(earned(filler, 'strategy-scholar')).toBe(false);
  });
});

describe('Class Champion', () => {
  const work = [sub(90, { day: 1 })];

  it('is earned when the section standing says top 3', () => {
    expect(earned(work, 'class-champion', { rankTop3: true })).toBe(true);
  });

  it('is not earned when the standing says otherwise', () => {
    expect(earned(work, 'class-champion', { rankTop3: false })).toBe(false);
  });

  it('is locked, not earned, when standing was never computed', () => {
    // null is "not determined" and must not read as a pass. Skipping the
    // section query is an optimisation, never a way to award a badge.
    expect(earned(work, 'class-champion')).toBe(false);
    expect(earned(work, 'class-champion', { rankTop3: null })).toBe(false);
  });
});

describe('isTop3', () => {
  const averages = [
    { studentId: 'a', average: 95 },
    { studentId: 'b', average: 88 },
    { studentId: 'c', average: 80 },
    { studentId: 'd', average: 72 },
  ];

  it('places the first three', () => {
    expect(isTop3(averages, 'a')).toBe(true);
    expect(isTop3(averages, 'b')).toBe(true);
    expect(isTop3(averages, 'c')).toBe(true);
  });

  it('does not place the fourth', () => {
    expect(isTop3(averages, 'd')).toBe(false);
  });

  it('lets a tie share the place, the way a race does', () => {
    const tied = [
      { studentId: 'a', average: 95 },
      { studentId: 'b', average: 95 },
      { studentId: 'c', average: 95 },
      { studentId: 'd', average: 95 },
    ];
    // All four are first — nobody is beaten by three distinct better scores.
    expect(['a', 'b', 'c', 'd'].every(id => isTop3(tied, id))).toBe(true);
  });

  it('does not rank a learner who has no average yet', () => {
    // An ungraded learner is not "last"; they are simply not in the running.
    const withUngraded = [...averages, { studentId: 'e', average: null }];
    expect(isTop3(withUngraded, 'e')).toBe(false);
  });

  it('returns false for a student who is not in the section at all', () => {
    expect(isTop3(averages, 'stranger')).toBe(false);
  });

  it('handles a section of one', () => {
    expect(isTop3([{ studentId: 'a', average: 60 }], 'a')).toBe(true);
  });
});
