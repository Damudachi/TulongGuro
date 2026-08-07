import { describe, it, expect } from 'vitest';
import {
  currentSchoolYear, schoolYearStart, isCurrentSchoolYear, compareSchoolYearsDesc,
} from '../schoolYear.js';
import { SCHOOL_YEARS, DEFAULT_SCHOOL_YEAR } from '../../src/constants/school.js';

/**
 * PH school years run June to March, so a year straddles two calendar years and
 * there is a gap in April and May belonging to neither. Both edges are tested
 * against a fixed clock, because the whole point of this module is that
 * sections must not appear or vanish on the wrong date.
 */

const at = (iso) => new Date(iso);

describe('currentSchoolYear', () => {
  it('opens the new year in June', () => {
    expect(currentSchoolYear(at('2026-05-31T12:00:00Z'))).toBe('2025-2026');
    expect(currentSchoolYear(at('2026-06-01T12:00:00Z'))).toBe('2026-2027');
  });

  it('holds through the turn of the calendar year', () => {
    // The year is named for when it opened, so December and the January after
    // it are the same school year.
    expect(currentSchoolYear(at('2026-12-31T12:00:00Z'))).toBe('2026-2027');
    expect(currentSchoolYear(at('2027-01-01T12:00:00Z'))).toBe('2026-2027');
    expect(currentSchoolYear(at('2027-03-31T12:00:00Z'))).toBe('2026-2027');
  });

  it('treats the April-May gap as the year that just ended', () => {
    // Classes are over but results are not finalised. Rolling forward here
    // would archive a section while its marks were still being entered.
    expect(currentSchoolYear(at('2027-04-15T12:00:00Z'))).toBe('2026-2027');
    expect(currentSchoolYear(at('2027-05-31T12:00:00Z'))).toBe('2026-2027');
  });
});

describe('schoolYearStart', () => {
  it('reads the first year out of a label', () => {
    expect(schoolYearStart('2026-2027')).toBe(2026);
    expect(schoolYearStart(' 2026 - 2027 ')).toBe(2026);
  });

  it('is null for anything it cannot read, rather than zero', () => {
    // Zero would sort as the oldest year and quietly archive the row.
    for (const bad of [null, undefined, '', 'SY 2026', '2026', 'next year', {}]) {
      expect(schoolYearStart(bad)).toBeNull();
    }
  });
});

describe('isCurrentSchoolYear', () => {
  const now = at('2026-08-07T12:00:00Z');   // inside SY 2026-2027

  it('keeps the year in progress', () => {
    expect(isCurrentSchoolYear('2026-2027', now)).toBe(true);
  });

  it('archives a year that has ended', () => {
    expect(isCurrentSchoolYear('2025-2026', now)).toBe(false);
    expect(isCurrentSchoolYear('2019-2020', now)).toBe(false);
  });

  it('keeps a year that has not started yet', () => {
    // A teacher preparing next June's sections has to be able to see them.
    expect(isCurrentSchoolYear('2027-2028', now)).toBe(true);
  });

  it('keeps anything it cannot classify', () => {
    // Hiding a roster nobody can find again is worse than one stale entry.
    for (const unknown of [null, undefined, '', 'SY 2026']) {
      expect(isCurrentSchoolYear(unknown, now)).toBe(true);
    }
  });

  it('does not archive last year during the April-May gap', () => {
    // 15 April 2027: SY 2026-2027's classes are done but it is not yet
    // archived, so its gradebooks stay in front of the teacher.
    expect(isCurrentSchoolYear('2026-2027', at('2027-04-15T12:00:00Z'))).toBe(true);
    // It archives once the next year actually opens.
    expect(isCurrentSchoolYear('2026-2027', at('2027-06-01T12:00:00Z'))).toBe(false);
  });
});

describe('compareSchoolYearsDesc', () => {
  it('puts the newest year first', () => {
    const sorted = ['2024-2025', '2026-2027', '2025-2026'].sort(compareSchoolYearsDesc);
    expect(sorted).toEqual(['2026-2027', '2025-2026', '2024-2025']);
  });

  it('floats unlabelled sections to the top, where they get noticed', () => {
    const sorted = ['2025-2026', null, '2026-2027'].sort(compareSchoolYearsDesc);
    expect(sorted).toEqual([null, '2026-2027', '2025-2026']);
  });
});

describe('parity with the client list in src/constants/school.js', () => {
  // The dropdown a teacher picks from and the rule that decides what is
  // archived have to agree, or a section is created into a year the list
  // immediately hides. This is the same twin problem as grading.js.
  it('the client default is the year this module calls current', () => {
    expect(DEFAULT_SCHOOL_YEAR).toBe(currentSchoolYear());
  });

  it('every year the client offers is one this module can read', () => {
    for (const year of SCHOOL_YEARS) {
      expect(schoolYearStart(year)).not.toBeNull();
    }
  });

  it('the client offers last year, this year and next', () => {
    expect(SCHOOL_YEARS).toHaveLength(3);
    expect(SCHOOL_YEARS[1]).toBe(currentSchoolYear());
    // Only the middle one is current-or-later by the archive rule; the first
    // is last year, which is exactly what "archived" should mean.
    expect(isCurrentSchoolYear(SCHOOL_YEARS[0])).toBe(false);
    expect(isCurrentSchoolYear(SCHOOL_YEARS[2])).toBe(true);
  });
});
