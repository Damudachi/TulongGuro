import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatSectionName, sectionShortName, defaultClassName, courseShellName } from '../../src/constants/school.js';

/**
 * What a course shell is called: "English Grade 6 - Newton".
 *
 * It used to be "Subject — Grade Level", which read fine on one shell and fell
 * apart on two: a teacher taking English into both Grade 6 blocks got two
 * shells called "English — Grade 6", and the gradebook, the class list and the
 * transfer dialogs all showed the same string for the two things an admin most
 * needs to tell apart. The SECTION is the part that was missing.
 *
 * The create form asks for the block and nothing else — "Newton", "Tesla" —
 * and the subject and grade level chosen in the fields above it are put in
 * front. Typing the grade into the name box is what the old "Class name" field
 * invited, and what made one school's shells read three different ways.
 *
 * The catch is that sections are not stored under their bare names either. The
 * section create form prepends the house-style grade prefix (see
 * formatSectionName), so the section is "Grade 6 - Newton" on disk — and naming
 * a shell straight off it would produce "English Grade 6 - Grade 6 - Newton".
 * These are the guard on that.
 */

describe('sectionShortName undoes what formatSectionName prepends', () => {
  it('strips the house-style grade prefix', () => {
    expect(sectionShortName('Grade 6 - Newton')).toBe('Newton');
    expect(sectionShortName('Grade 10 - Ruby')).toBe('Ruby');
  });

  it('accepts the shapes admins actually type, not just the stored one', () => {
    // The same set formatSectionName tolerates on the way in.
    expect(sectionShortName('G6 Sampaguita')).toBe('Sampaguita');
    expect(sectionShortName('Gr. 6: Newton')).toBe('Newton');
    expect(sectionShortName('grade 6 ruby')).toBe('ruby');
  });

  it('leaves a bare section name alone', () => {
    expect(sectionShortName('Newton')).toBe('Newton');
    expect(sectionShortName('')).toBe('');
    expect(sectionShortName(null)).toBe('');
  });

  it('keeps a section genuinely named after its grade', () => {
    // Stripping "Grade 6" from "Grade 6" leaves nothing, and a shell called
    // "English — " is worse than one that repeats the grade.
    expect(sectionShortName('Grade 6')).toBe('Grade 6');
  });

  it('round-trips whatever formatSectionName stores', () => {
    for (const typed of ['Newton', 'Ruby', 'Sampaguita', 'Grade 6 - Newton', 'G6 Newton']) {
      expect(sectionShortName(formatSectionName(typed, 'Grade 6'))).toBe(sectionShortName(typed));
    }
  });
});

describe('defaultClassName names a shell subject, grade level, then block', () => {
  it('reads "English Grade 6 - Newton"', () => {
    expect(defaultClassName('English', 'Grade 6 - Newton', 'Grade 6')).toBe('English Grade 6 - Newton');
  });

  it('does not say the grade level twice', () => {
    // The section arrives carrying its own "Grade 6 - " prefix.
    expect(defaultClassName('English', 'Grade 6 - Newton', 'Grade 6'))
      .not.toContain('Grade 6 - Grade 6');
  });

  it('tells two blocks of one grade apart', () => {
    // The whole point. Both of these used to be "English — Grade 6".
    expect(defaultClassName('English', 'Grade 6 - Newton', 'Grade 6'))
      .not.toBe(defaultClassName('English', 'Grade 6 - Einstein', 'Grade 6'));
  });

  it('falls back to whichever halves it has', () => {
    expect(defaultClassName('English', '', 'Grade 6')).toBe('English Grade 6');
    expect(defaultClassName('', 'Grade 6 - Newton', '')).toBe('Newton');
    expect(defaultClassName('English', 'Grade 6 - Newton', '')).toBe('English - Newton');
    expect(defaultClassName('', '', '')).toBe('');
  });
});

describe('courseShellName resolves the create form', () => {
  it('builds the name from the block the admin typed', () => {
    // "Tesla" typed into Section name, with English and Grade 6 chosen above.
    expect(courseShellName('English', 'Grade 6', 'Tesla', 'Grade 6 - Newton'))
      .toBe('English Grade 6 - Tesla');
  });

  it('falls back to the block section chosen above when the box is blank', () => {
    expect(courseShellName('English', 'Grade 6', '', 'Grade 6 - Newton'))
      .toBe('English Grade 6 - Newton');
    expect(courseShellName('English', 'Grade 6', '   ', 'Grade 6 - Newton'))
      .toBe('English Grade 6 - Newton');
  });

  it('does not repeat a grade the admin typed anyway', () => {
    expect(courseShellName('English', 'Grade 6', 'Grade 6 - Tesla', 'Grade 6 - Newton'))
      .toBe('English Grade 6 - Tesla');
  });
});

describe('the server resolves a blank name the same way', () => {
  /**
   * The route cannot import this module — server.js is CommonJS and
   * src/constants/school.js is ESM — so the strip pattern is written out twice.
   * Checked rather than trusted: a shell named by the server and a placeholder
   * shown by the form that disagreed would be a bug nobody sees until a teacher
   * asks why the name is not what the box promised.
   */
  it('carries the same grade-prefix pattern in POST /api/admin/:adminId/classes', () => {
    const src = readFileSync(join(fileURLToPath(new URL('../', import.meta.url)), 'server.js'), 'utf8');
    const clientPattern = String(/^(?:grade|gr|g)\s*\.?\s*\d{1,2}\s*[-–—:.]?\s*/i);
    expect(src).toContain('const bareSection');
    expect(src.replace(/\\\\/g, '\\')).toContain(clientPattern.slice(1, clientPattern.lastIndexOf('/')));
    // And it is subject + grade level, then the section, in that order.
    expect(src).toContain("const shellHead = [subject, gradeLevel].filter(Boolean).join(' ').trim()");
    expect(src).toContain("[shellHead, bareSection].filter(Boolean).join(' - ')");
  });
});
