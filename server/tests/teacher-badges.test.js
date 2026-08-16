import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  computeCustomBadges, parsePassingScore, normaliseIcon, normaliseColor,
  customBadgeKey, isCustomBadgeId, teacherBadgeIdFrom, BADGE_IDS,
  BADGE_ICONS, BADGE_COLORS,
} = require('../badges.js');

/**
 * A teacher's own badge is the one award in this app that a person, rather than
 * a rule, decided to give. So the failure that matters is the same one
 * badges.test.js guards for the built-in fifteen, only sharper: a badge handed
 * out for work that did not clear the bar the teacher actually set, or withheld
 * from work that did.
 *
 * Every boundary is pinned. "At exactly the passing score" is the case the
 * whole feature turns on, and `>=` vs `>` is a one-character difference that
 * silently changes who is celebrated.
 */

/** A graded submission on `activityId`. */
const sub = (activityId, percent, extra = {}) => ({
  activityId,
  hitlScore: percent,
  aiScore: null,
  ...extra,
});

/** A teacher badge attached to one activity at `bar` percent. */
const badge = (bar, { id = 'b1', name = 'Times Table Champion', activityId = 'a1', ...rest } = {}) => ({
  id, name, description: null, icon: 'trophy', color: 'sun',
  activities: [{ id: activityId, title: 'Times Table Drill', passingScore: bar }],
  ...rest,
});

const only = (submissions, catalogue) => computeCustomBadges(submissions, catalogue)[0];

describe('the badge id namespace', () => {
  it('keeps custom ids out of the built-in set', () => {
    // The two share one column on StudentBadge. A collision would mean a
    // teacher's badge silently standing in for "Honor Student", or vice versa.
    for (const id of BADGE_IDS) expect(isCustomBadgeId(id)).toBe(false);
  });

  it('round-trips a teacher badge id through its stored key', () => {
    const key = customBadgeKey('abc-123');
    expect(isCustomBadgeId(key)).toBe(true);
    expect(teacherBadgeIdFrom(key)).toBe('abc-123');
  });

  it('reads a built-in id as not custom rather than as a malformed one', () => {
    expect(teacherBadgeIdFrom('comeback-kid')).toBe(null);
    expect(teacherBadgeIdFrom(null)).toBe(null);
    expect(teacherBadgeIdFrom(undefined)).toBe(null);
  });

  it('refuses an empty custom key rather than returning an empty id', () => {
    // 'custom:' with nothing after it would otherwise look up TeacherBadge ''.
    expect(teacherBadgeIdFrom('custom:')).toBe(null);
  });
});

describe('the passing score a teacher sets', () => {
  it('accepts whole percentages across the whole range', () => {
    expect(parsePassingScore(1)).toBe(1);
    expect(parsePassingScore(75)).toBe(75);
    expect(parsePassingScore(100)).toBe(100);
  });

  it('accepts the string a form sends', () => {
    // FormData and JSON bodies both arrive as text from the Activity Builder.
    expect(parsePassingScore('80')).toBe(80);
  });

  it('refuses anything outside 1-100', () => {
    expect(parsePassingScore(0)).toBe(null);
    expect(parsePassingScore(101)).toBe(null);
    expect(parsePassingScore(-5)).toBe(null);
  });

  it('refuses a fraction, so the bar is a number a learner can be told', () => {
    expect(parsePassingScore(75.5)).toBe(null);
  });

  it('refuses nothing at all, rather than defaulting', () => {
    // The route refuses the save on this null. A bar the teacher did not set is
    // exactly the number that must never be invented.
    expect(parsePassingScore(null)).toBe(null);
    expect(parsePassingScore(undefined)).toBe(null);
    expect(parsePassingScore('')).toBe(null);
    expect(parsePassingScore('abc')).toBe(null);
    expect(parsePassingScore(NaN)).toBe(null);
    expect(parsePassingScore(Infinity)).toBe(null);
    expect(parsePassingScore(true)).toBe(null);
  });
});

describe('icon and colour keys', () => {
  it('keeps a key the teacher chose', () => {
    expect(normaliseIcon('trophy')).toBe('trophy');
    expect(normaliseColor('magenta')).toBe('magenta');
  });

  it('falls back rather than refusing an unknown key', () => {
    // Decoration must never be what fails a teacher's save.
    expect(normaliseIcon('unicorn')).toBe('award');
    expect(normaliseColor('chartreuse')).toBe('royal');
    expect(normaliseIcon(null)).toBe('award');
    expect(normaliseColor(undefined)).toBe('royal');
  });

  it('accepts the key however it was cased or padded', () => {
    expect(normaliseIcon(' Trophy ')).toBe('trophy');
    expect(normaliseColor('SUN')).toBe('sun');
  });

  it('offers every key it claims to', () => {
    expect(BADGE_ICONS).toContain('award');
    expect(BADGE_COLORS).toContain('royal');
  });
});

describe('earning a teacher badge', () => {
  it('awards nothing when the catalogue is empty', () => {
    expect(computeCustomBadges([sub('a1', 100)], [])).toEqual([]);
    expect(computeCustomBadges([], [])).toEqual([]);
  });

  it('survives no submissions, and a null catalogue, rather than throwing', () => {
    expect(() => computeCustomBadges(null, null)).not.toThrow();
    expect(only([], [badge(75)]).earned).toBe(false);
  });

  it('awards it for a mark above the bar', () => {
    expect(only([sub('a1', 88)], [badge(75)]).earned).toBe(true);
  });

  it('awards it at exactly the bar', () => {
    // The boundary the whole feature turns on: 75% must earn a 75% badge.
    expect(only([sub('a1', 75)], [badge(75)]).earned).toBe(true);
  });

  it('withholds it one mark below the bar', () => {
    expect(only([sub('a1', 74)], [badge(75)]).earned).toBe(false);
  });

  it('ignores a mark on a different activity', () => {
    // A badge is a reward for one specific piece of work. A perfect score
    // elsewhere is not that work.
    expect(only([sub('other', 100)], [badge(75)]).earned).toBe(false);
  });

  it('prefers the teacher\'s mark over the AI\'s, including a validated zero', () => {
    // The `??` rule from starsFor: a teacher-assigned 0 is falsy but real, and
    // must not fall through to the AI's original score.
    const s = { activityId: 'a1', hitlScore: 0, aiScore: 95 };
    expect(only([s], [badge(75)]).earned).toBe(false);
  });

  it('uses the AI mark when no teacher mark has been recorded', () => {
    const s = { activityId: 'a1', hitlScore: null, aiScore: 90 };
    expect(only([s], [badge(75)]).earned).toBe(true);
  });

  it('ignores work that has no mark at all', () => {
    const s = { activityId: 'a1', hitlScore: null, aiScore: null };
    const result = only([s], [badge(75)]);
    expect(result.earned).toBe(false);
    expect(result.bestPercent).toBe(null);
  });

  it('does not award on an excused activity, however it was scored', () => {
    // An excused activity is one the learner was told not to do. It drops out
    // of their average, so it cannot be what earns them a reward either.
    const s = sub('a1', 100, { excusedAt: '2026-03-01T00:00:00Z' });
    expect(only([s], [badge(75)]).earned).toBe(false);
  });

  it('keeps the learner\'s best attempt, so re-submitting can never lose a badge', () => {
    const attempts = [sub('a1', 90), sub('a1', 60)];
    const result = only(attempts, [badge(75)]);
    expect(result.earned).toBe(true);
    expect(result.bestPercent).toBe(90);
  });

  it('is not awarded when the teacher never set a bar', () => {
    // An activity carrying a badge with no passingScore cannot award anything —
    // skipped rather than defaulted, for the same reason parsePassingScore
    // refuses to guess.
    expect(only([sub('a1', 100)], [badge(null)]).earned).toBe(false);
    expect(only([sub('a1', 100)], [badge(0)]).earned).toBe(false);
  });

  it('is not awarded by an activity row with no id on it', () => {
    // A half-loaded row must not match every submission by matching none of the
    // map's keys and then comparing `undefined === undefined`.
    const orphan = { id: 'b1', name: 'Ghost', activities: [{ passingScore: 75 }, null] };
    expect(only([sub('a1', 100)], [orphan]).earned).toBe(false);
  });

  it('survives a submission with no activity id', () => {
    expect(() => computeCustomBadges([{ hitlScore: 90 }], [badge(75)])).not.toThrow();
    expect(only([{ hitlScore: 90 }], [badge(75)]).earned).toBe(false);
  });
});

describe('a badge on more than one activity', () => {
  const twoParts = {
    id: 'b1', name: 'Project Star', description: null, icon: 'star', color: 'aqua',
    activities: [
      { id: 'a1', title: 'Part One', passingScore: 80 },
      { id: 'a2', title: 'Part Two', passingScore: 90 },
    ],
  };

  it('is earned by clearing the bar on either one', () => {
    // A teacher who sets the same reward on both parts means either part earns
    // it — not both.
    expect(only([sub('a2', 95)], [twoParts]).earned).toBe(true);
    expect(only([sub('a1', 85)], [twoParts]).earned).toBe(true);
  });

  it('is not earned by a mark that clears the other activity\'s bar', () => {
    // 85 clears Part One's 80 but not Part Two's 90, and this is a Part Two
    // submission — each bar belongs to its own activity.
    expect(only([sub('a2', 85)], [twoParts]).earned).toBe(false);
  });

  it('reports the closest attempt rather than the first one found', () => {
    const result = only([sub('a1', 60), sub('a2', 88)], [twoParts]);
    expect(result.earned).toBe(false);
    expect(result.bestPercent).toBe(88);
    expect(result.passingScore).toBe(90);
  });
});

describe('what the trophy room is handed', () => {
  it('prefixes the id so it can never collide with a built-in badge', () => {
    expect(only([], [badge(75, { id: 'xyz' })]).id).toBe('custom:xyz');
  });

  it('marks it as custom, so the page styles it from the teacher\'s choices', () => {
    const result = only([], [badge(75)]);
    expect(result.custom).toBe(true);
    expect(result.icon).toBe('trophy');
    expect(result.color).toBe('sun');
  });

  it('normalises an icon or colour that is no longer offered', () => {
    const stale = badge(75, { icon: 'unicorn', color: 'chartreuse' });
    const result = only([], [stale]);
    expect(result.icon).toBe('award');
    expect(result.color).toBe('royal');
  });

  it('uses the teacher\'s own description when they wrote one', () => {
    const described = badge(75, { description: 'For mastering your 7s and 8s' });
    expect(only([], [described]).desc).toBe('For mastering your 7s and 8s');
  });

  it('explains the condition itself when the description is blank', () => {
    // A badge with no gloss must still tell the learner what to do.
    expect(only([], [badge(80)]).desc).toBe('Score at least 80% on "Times Table Drill"');
    expect(only([], [badge(80, { description: '   ' })]).desc)
      .toBe('Score at least 80% on "Times Table Drill"');
  });

  it('names the lowest bar when the badge sits on several activities', () => {
    const many = {
      id: 'b1', name: 'Project Star', activities: [
        { id: 'a1', title: 'Part One', passingScore: 90 },
        { id: 'a2', title: 'Part Two', passingScore: 70 },
      ],
    };
    // The lowest, because it is the one a learner can actually reach first —
    // quoting the highest would overstate what the badge asks for.
    expect(only([], [many]).desc).toBe('Score at least 70% on one of 2 activities');
  });

  it('falls back to a plain line when no bar was ever set', () => {
    expect(only([], [badge(null)]).desc).toBe('A badge from your teacher');
  });

  it('reports progress as one step, the way every other one-off badge does', () => {
    expect(only([sub('a1', 90)], [badge(75)])).toMatchObject({ progress: 1, target: 1 });
    expect(only([sub('a1', 10)], [badge(75)])).toMatchObject({ progress: 0, target: 1 });
  });

  it('rounds the best mark, so a stored 23.33% reads as 23%', () => {
    // Submission scores are Floats — see the note on Submission.aiScore.
    expect(only([sub('a1', 23.33)], [badge(75)]).bestPercent).toBe(23);
  });

  it('reports the bar even before any work has been handed in', () => {
    // What lets the locked card say "score 75% to earn this" rather than
    // showing an empty progress bar that explains nothing.
    const result = only([], [badge(75)]);
    expect(result.bestPercent).toBe(null);
    expect(result.passingScore).toBe(75);
  });
});
