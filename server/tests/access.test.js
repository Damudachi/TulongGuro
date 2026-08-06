import { describe, it, expect } from 'vitest';
import { classSchoolId, staffMayAccess } from '../access.js';

/**
 * Cross-tenant read isolation for staff.
 *
 * Both /api/activities/:activityId(/submissions) and /api/submissions/:id
 * wrote this as `if (schoolId) { ...compare... }` and then fell through to
 * allow. A class whose section had no schoolId — a state POST
 * /api/teacher/sections produces whenever the creating teacher has no school
 * yet — was therefore readable by every authenticated staff account on the
 * platform.
 */

const SCHOOL_A = 'school-a';
const SCHOOL_B = 'school-b';
const OWNER = 'teacher-owner';
const OTHER = 'teacher-other';

/** A class as CLASS_TENANCY_SELECT loads it. */
const aClass = ({ sectionSchool = null, teacherSchool = null, teacherId = OWNER } = {}) => ({
  teacherId,
  section: { schoolId: sectionSchool },
  teacher: { schoolId: teacherSchool },
});

describe('classSchoolId', () => {
  it('prefers the section, which is the primary signal', () => {
    expect(classSchoolId(aClass({ sectionSchool: SCHOOL_A, teacherSchool: SCHOOL_B }))).toBe(SCHOOL_A);
  });

  it('falls back to the owning teacher when the section has no school', () => {
    expect(classSchoolId(aClass({ sectionSchool: null, teacherSchool: SCHOOL_A }))).toBe(SCHOOL_A);
  });

  it('is null only when neither knows', () => {
    expect(classSchoolId(aClass())).toBeNull();
    expect(classSchoolId(null)).toBeNull();
    expect(classSchoolId(undefined)).toBeNull();
    expect(classSchoolId({})).toBeNull();
  });
});

describe('staffMayAccess — a class that belongs to a school', () => {
  const cls = aClass({ sectionSchool: SCHOOL_A });

  it('lets a colleague at the same school in', () => {
    // The coordinator / covering-teacher case, which is why these routes are
    // school-scoped rather than restricted to the exact owning teacher.
    expect(staffMayAccess(cls, { callerId: OTHER, callerSchoolId: SCHOOL_A })).toBe(true);
  });

  it('keeps another school out', () => {
    expect(staffMayAccess(cls, { callerId: OTHER, callerSchoolId: SCHOOL_B })).toBe(false);
  });

  it('keeps an unaffiliated staff account out', () => {
    expect(staffMayAccess(cls, { callerId: OTHER, callerSchoolId: null })).toBe(false);
  });

  it('does not let the owning teacher in on ownership alone once they have left the school', () => {
    // Ownership is not the rule on this rung — school membership is. A teacher
    // whose account has been moved to another school should lose the read.
    expect(staffMayAccess(cls, { callerId: OWNER, callerSchoolId: SCHOOL_B })).toBe(false);
  });
});

describe('staffMayAccess — a class with no school anywhere', () => {
  const cls = aClass();   // unaffiliated teacher's sandbox

  it('lets the owning teacher read their own work', () => {
    expect(staffMayAccess(cls, { callerId: OWNER, callerSchoolId: null })).toBe(true);
  });

  it('THE BUG: keeps every other staff account out', () => {
    // This returned true before the fix, for anyone holding a valid token.
    expect(staffMayAccess(cls, { callerId: OTHER, callerSchoolId: null })).toBe(false);
    expect(staffMayAccess(cls, { callerId: OTHER, callerSchoolId: SCHOOL_A })).toBe(false);
  });

  it('does not let a null or missing caller id match a null teacherId', () => {
    // Both sides being nullish must not read as a match.
    const orphan = { teacherId: null, section: { schoolId: null }, teacher: null };
    expect(staffMayAccess(orphan, { callerId: null, callerSchoolId: null })).toBe(false);
    expect(staffMayAccess(orphan, { callerId: undefined, callerSchoolId: null })).toBe(false);
    expect(staffMayAccess(orphan, {})).toBe(false);
  });
});

describe('staffMayAccess — fails closed on bad input', () => {
  it('refuses when there is no class at all', () => {
    expect(staffMayAccess(null, { callerId: OWNER, callerSchoolId: SCHOOL_A })).toBe(false);
    expect(staffMayAccess(undefined, { callerId: OWNER, callerSchoolId: SCHOOL_A })).toBe(false);
  });

  it('refuses when called with no caller argument at all', () => {
    expect(staffMayAccess(aClass({ sectionSchool: SCHOOL_A }))).toBe(false);
    expect(staffMayAccess(aClass())).toBe(false);
  });

  it('refuses a half-loaded class rather than reading the gap as "no school"', () => {
    // If a caller forgets the `teacher` select, the class looks unaffiliated.
    // It still fails closed: the caller is not the owner, so no read.
    const halfLoaded = { teacherId: OWNER, section: { schoolId: null } };
    expect(staffMayAccess(halfLoaded, { callerId: OTHER, callerSchoolId: SCHOOL_A })).toBe(false);
  });
});
