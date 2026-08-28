import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatSectionName, sectionShortName, defaultClassName } from '../../src/constants/school.js';

/**
 * What a course shell is called when the admin leaves the name field blank.
 *
 * It used to be "Subject — Grade Level", which read fine on one shell and fell
 * apart on two: a teacher taking English into both Grade 6 blocks got two
 * shells called "English — Grade 6", and the gradebook, the class list and the
 * transfer dialogs all showed the same string for the two things an admin most
 * needs to tell apart. The grade level is already the shell's own column and
 * its own badge; the SECTION is the part that was missing.
 *
 * The catch is that sections are not stored under their bare names. The create
 * form prepends the house-style grade prefix (see formatSectionName), so the
 * section is "Grade 6 - Newton" on disk — and naming a shell straight off it
 * would produce "English — Grade 6 - Newton", putting the grade level back in
 * the name it was deliberately taken out of. These are the guard on that.
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

describe('defaultClassName names a shell after its subject and section', () => {
  it('uses the section, not the grade level', () => {
    expect(defaultClassName('English', 'Grade 6 - Newton')).toBe('English — Newton');
  });

  it('tells two blocks of one grade apart', () => {
    // The whole point. Both of these used to be "English — Grade 6".
    expect(defaultClassName('English', 'Grade 6 - Newton'))
      .not.toBe(defaultClassName('English', 'Grade 6 - Einstein'));
  });

  it('falls back to whichever half it has', () => {
    expect(defaultClassName('English', '')).toBe('English');
    expect(defaultClassName('', 'Grade 6 - Newton')).toBe('Newton');
    expect(defaultClassName('', '')).toBe('');
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
    const src = readFileSync(join(new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'server.js'), 'utf8');
    const clientPattern = String(/^(?:grade|gr|g)\s*\.?\s*\d{1,2}\s*[-–—:.]?\s*/i);
    expect(src).toContain('const bareSection');
    expect(src.replace(/\\\\/g, '\\')).toContain(clientPattern.slice(1, clientPattern.lastIndexOf('/')));
    // And it is the section, not the grade level, that the name is built from.
    expect(src).toContain("[subject, bareSection].filter(Boolean).join(' — ')");
  });
});
