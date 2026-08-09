import { describe, it, expect } from 'vitest';
import transfers from '../transfers.js';

const {
  matchingSourceClasses, duplicateTargetKeys, preArrivalActivityIds,
  carriedOverEntries, NO_MATCHING_CLASS, CLASS_HAS_NO_SUBJECT,
} = transfers;

const cls = (id, subject, gradeLevel = 'Grade 6', schoolYear = '2026-2027') =>
  ({ id, subject, gradeLevel, schoolYear });

describe('matchingSourceClasses', () => {
  it('matches on subject, gradeLevel and schoolYear together', () => {
    const candidates = [cls('a', 'English'), cls('b', 'Science')];
    const { matched, reason } = matchingSourceClasses(candidates, cls('t', 'English'));
    expect(matched.map(c => c.id)).toEqual(['a']);
    expect(reason).toBeNull();
  });

  it('does not match a different school year', () => {
    const candidates = [cls('a', 'English', 'Grade 6', '2025-2026')];
    const { matched, reason } = matchingSourceClasses(candidates, cls('t', 'English'));
    expect(matched).toEqual([]);
    expect(reason).toBe(NO_MATCHING_CLASS);
  });

  it('does not match a different grade level', () => {
    const candidates = [cls('a', 'English', 'Grade 5')];
    expect(matchingSourceClasses(candidates, cls('t', 'English')).reason).toBe(NO_MATCHING_CLASS);
  });

  // An unlabelled class is ambiguous, not a match. Two nulls matching would
  // merge a Maths class into a Science one.
  it('refuses to match when the target has no subject', () => {
    const { matched, reason } = matchingSourceClasses([cls('a', null)], cls('t', null));
    expect(matched).toEqual([]);
    expect(reason).toBe(CLASS_HAS_NO_SUBJECT);
  });

  it('ignores candidates with no subject even when the target has one', () => {
    expect(matchingSourceClasses([cls('a', null)], cls('t', 'English')).reason)
      .toBe(NO_MATCHING_CLASS);
  });

  // A student who moved twice (A -> B -> C) has two prior English classes and
  // both are legitimately theirs. Multiple sources is not an error.
  it('returns every matching source class, not just the first', () => {
    const candidates = [cls('a', 'English'), cls('b', 'English')];
    expect(matchingSourceClasses(candidates, cls('t', 'English')).matched.map(c => c.id))
      .toEqual(['a', 'b']);
  });

  it('survives empty and missing input', () => {
    expect(matchingSourceClasses([], cls('t', 'English')).reason).toBe(NO_MATCHING_CLASS);
    expect(matchingSourceClasses(null, cls('t', 'English')).reason).toBe(NO_MATCHING_CLASS);
  });
});

describe('duplicateTargetKeys', () => {
  // Two English 6 classes in the target section would each claim the same
  // carried-over work, counting it twice.
  it('names a key held by more than one class in the target section', () => {
    expect(duplicateTargetKeys([cls('a', 'English'), cls('b', 'English'), cls('c', 'Science')]))
      .toEqual(['English|Grade 6|2026-2027']);
  });

  it('is empty when every class is distinct', () => {
    expect(duplicateTargetKeys([cls('a', 'English'), cls('b', 'Science')])).toEqual([]);
  });

  it('ignores unlabelled classes, which never match anything anyway', () => {
    expect(duplicateTargetKeys([cls('a', null), cls('b', null)])).toEqual([]);
  });
});

describe('preArrivalActivityIds', () => {
  const ARRIVAL = new Date('2026-08-09T00:00:00Z');
  const before = { id: 'old', createdAt: new Date('2026-08-01T00:00:00Z'), deadline: '2026-08-05' };
  const after = { id: 'new', createdAt: new Date('2026-08-20T00:00:00Z'), deadline: '2026-08-25' };
  const closed = () => true;
  const open = () => false;

  it('excuses an activity assigned before arrival whose deadline has passed', () => {
    expect(preArrivalActivityIds([before], ARRIVAL, [], closed)).toEqual(['old']);
  });

  it('leaves an activity assigned after arrival alone', () => {
    expect(preArrivalActivityIds([after], ARRIVAL, [], closed)).toEqual([]);
  });

  // Assigned before she arrived but still open: she can still do it.
  it('leaves an activity that is still open alone', () => {
    expect(preArrivalActivityIds([before], ARRIVAL, [], open)).toEqual([]);
  });

  // A student returning to a section they were in earlier already has work
  // here, and that work is theirs.
  it('leaves an activity the student has already submitted alone', () => {
    expect(preArrivalActivityIds([before], ARRIVAL, ['old'], closed)).toEqual([]);
  });

  it('survives empty and missing input', () => {
    expect(preArrivalActivityIds([], ARRIVAL, [], closed)).toEqual([]);
    expect(preArrivalActivityIds(null, ARRIVAL, null, closed)).toEqual([]);
  });
});

describe('carriedOverEntries', () => {
  const sub = (percent, points, component) => ({
    status: 'GRADED', hitlScore: percent, archivedAt: null, excusedAt: null,
    activity: { points, component },
  });

  it('produces the shape computeGrade consumes', () => {
    expect(carriedOverEntries([sub(80, 50, 'PT')]))
      .toEqual([{ percent: 80, points: 50, component: 'PT' }]);
  });

  // Matches the export's own default (server.js:8125) and computeGrade's
  // treatment of an unrecognised component.
  it('defaults a null component to Written Work and null points to 100', () => {
    expect(carriedOverEntries([sub(80, null, null)]))
      .toEqual([{ percent: 80, points: 100, component: 'WW' }]);
  });

  it('drops work that is not a grade of record', () => {
    const pending = { status: 'PENDING', aiScore: 90, archivedAt: null, excusedAt: null, activity: { points: 100 } };
    const excused = { status: 'GRADED', hitlScore: 90, archivedAt: null, excusedAt: new Date(), activity: { points: 100 } };
    expect(carriedOverEntries([pending, excused])).toEqual([]);
  });

  it('keeps a validated zero, which is a real mark', () => {
    expect(carriedOverEntries([sub(0, 100, 'WW')]))
      .toEqual([{ percent: 0, points: 100, component: 'WW' }]);
  });

  it('survives empty and missing input', () => {
    expect(carriedOverEntries([])).toEqual([]);
    expect(carriedOverEntries(null)).toEqual([]);
  });
});
