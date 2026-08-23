import { describe, it, expect } from 'vitest';
import {
  cellToText, readBirthday, headerRole, extractRoster,
  looksLikeAHeaderRow, splitDateOutOfName, composeName, withSurnameComma, tidyRosterEntry,
  middleInitial, abbreviateMiddleName,
} from '../rosterSheet.js';

/**
 * Reading a class list out of a spreadsheet.
 *
 * Pinned because every failure here lands on a teacher at enrolment time and
 * two of them are silent. A refused file is at least visible — the parser used
 * to reject a DepEd School Form outright because it read "Republic of the
 * Philippines" as the column headings. A dropped learner and a misread
 * birthday are not: one child is missing from the class list, and one child
 * has a password built from the wrong day.
 */

/** A School Form 1 as exported: title rows, then headings, then the class. */
const SCHOOL_FORM = [
  ['Republic of the Philippines'],
  ['Department of Education'],
  ['Region III — Central Luzon'],
  ['School ID: 102938', '', 'School Year: 2026-2027'],
  ['Grade & Section: VI - Rizal'],
  [],
  ['No.', 'Last Name', 'First Name', 'Middle Name', 'Date of Birth', "Parent's Name"],
  ['MALE'],
  ['1', 'Dela Cruz', 'Juan Miguel', 'Santos', '03/15/2014', 'Dela Cruz, Pedro'],
  ['2', 'Reyes', 'Mark', 'Lopez', '07/02/2014', 'Reyes, Ana'],
  ['FEMALE'],
  ['3', 'Bautista', 'Maria Clara', 'Cruz', '11/30/2013', 'Bautista, Rosa'],
  [],
  ['TOTAL', '3'],
];

describe('the reported failure — a roster whose headings are not on row 1', () => {
  it('finds the headings under the form title rows instead of refusing the file', () => {
    const { students, source } = extractRoster(SCHOOL_FORM);
    expect(source).toBe('headings');
    expect(students).toHaveLength(3);
  });

  it('rejoins split name columns with the surname comma the app greets on', () => {
    const { students } = extractRoster(SCHOOL_FORM);
    // The middle name comes back as its initial — the form spells "Santos" out
    // in its own column, the class list this builds prints one letter. See
    // middleInitial.
    expect(students[0].name).toBe('Dela Cruz, Juan Miguel S.');
    expect(students[2].name).toBe('Bautista, Maria Clara C.');
  });

  it('reads the birthday column, which used to be dropped entirely', () => {
    const { students } = extractRoster(SCHOOL_FORM);
    expect(students.map(s => s.birthday)).toEqual(['03/15/2014', '07/02/2014', '11/30/2013']);
  });

  it('does not enrol the MALE/FEMALE dividers or the totals line as learners', () => {
    const { students } = extractRoster(SCHOOL_FORM);
    expect(students.map(s => s.name)).not.toContain('MALE');
    expect(students.map(s => s.name)).not.toContain('FEMALE');
    expect(students.map(s => s.name)).not.toContain('TOTAL');
  });

  it("takes the learner's name, not the parent's, from a form carrying both", () => {
    const { students } = extractRoster(SCHOOL_FORM);
    expect(students[0].name).not.toContain('Pedro');
  });
});

describe('headings', () => {
  it('recognises the ways a roster labels the learner', () => {
    expect(headerRole('Name')).toBe('full');
    expect(headerRole("LEARNER'S NAME")).toBe('full');
    expect(headerRole('Pangalan ng Mag-aaral')).toBe('full');
    expect(headerRole('Last Name')).toBe('last');
    expect(headerRole('Apelyido')).toBe('last');
    expect(headerRole('First Name')).toBe('first');
    expect(headerRole('Given Name')).toBe('first');
    expect(headerRole('Middle Name')).toBe('middle');
    expect(headerRole('M.I.')).toBe('middle');
  });

  it('recognises a birth date without mistaking other dates for one', () => {
    expect(headerRole('Date of Birth')).toBe('birthday');
    expect(headerRole('Birthday')).toBe('birthday');
    expect(headerRole('DOB')).toBe('birthday');
    expect(headerRole('Kaarawan')).toBe('birthday');
    expect(headerRole('Date Enrolled')).toBeNull();
    expect(headerRole('Place of Birth')).toBeNull();
  });

  it('ignores columns naming someone other than the learner, or nobody at all', () => {
    expect(headerRole("Parent's Name")).toBeNull();
    expect(headerRole('Guardian Name')).toBeNull();
    expect(headerRole("Mother's Name")).toBeNull();
    expect(headerRole('Name of School')).toBeNull();
    expect(headerRole('Student No.')).toBeNull();
    expect(headerRole('LRN')).toBeNull();
    expect(headerRole('Age')).toBeNull();
  });
});

describe('a list with no headings at all', () => {
  it('finds the names by their shape', () => {
    const { students, source } = extractRoster([
      ['Dela Cruz, Juan Miguel'],
      ['Reyes, Mark'],
      ['Bautista, Maria Clara'],
    ]);
    expect(source).toBe('values');
    // "Juan Miguel" loses its second word to the middle-name reading — the
    // known cost of abbreviateMiddleName, which cannot tell a second given
    // name from a maternal surname in a combined column. "Reyes, Mark" has
    // only one given name, so there is nothing to abbreviate.
    expect(students.map(s => s.name)).toEqual(['Dela Cruz, Juan M.', 'Reyes, Mark', 'Bautista, Maria C.']);
  });

  it('picks up a birthday column alongside them when there is exactly one', () => {
    const { students } = extractRoster([
      ['Dela Cruz, Juan', '03/15/2014'],
      ['Reyes, Mark', '07/02/2014'],
    ]);
    expect(students[0].birthday).toBe('03/15/2014');
  });

  it('drops the roster numbering rather than making it part of the name', () => {
    const { students } = extractRoster([['1. Dela Cruz, Juan'], ['2) Reyes, Mark']]);
    expect(students.map(s => s.name)).toEqual(['Dela Cruz, Juan', 'Reyes, Mark']);
  });

  it('leaves the form boilerplate out of the class list', () => {
    const { students } = extractRoster([
      ['Republic of the Philippines'],
      ['Department of Education'],
      ['Dela Cruz, Juan'],
      ['Reyes, Mark'],
    ]);
    expect(students.map(s => s.name)).toEqual(['Dela Cruz, Juan', 'Reyes, Mark']);
  });

  it('keeps surnames that merely contain a boilerplate word', () => {
    // "Malen" is a surname; a substring match on /male/ deleted the learner.
    const { students } = extractRoster([['Malen, Josefa'], ['Regino, Tomas'], ['Totaan, Luis']]);
    expect(students.map(s => s.name)).toEqual(['Malen, Josefa', 'Regino, Tomas', 'Totaan, Luis']);
  });

  it('claims nothing from a sheet with only one name-shaped cell in it', () => {
    const { students, source } = extractRoster([['Attendance'], ['', 'x']]);
    expect(source).toBe('none');
    expect(students).toEqual([]);
  });
});

describe('two date columns and no heading to tell them apart', () => {
  it('reads neither, rather than guessing which one is the birthday', () => {
    const { students } = extractRoster([
      ['Dela Cruz, Juan', '03/15/2014', '06/03/2026'],
      ['Reyes, Mark', '07/02/2014', '06/03/2026'],
    ]);
    expect(students.every(s => s.birthday === '')).toBe(true);
  });

  it('but uses the one a heading names, ignoring the other', () => {
    const { students } = extractRoster([
      ['Name', 'Date Enrolled', 'Date of Birth'],
      ['Dela Cruz, Juan', '06/03/2026', '03/15/2014'],
    ]);
    expect(students[0].birthday).toBe('03/15/2014');
  });
});

describe('readBirthday', () => {
  it('reads the formats a school form actually carries', () => {
    expect(readBirthday('03/15/2014')).toBe('03/15/2014');
    expect(readBirthday('3/5/2014')).toBe('03/05/2014');
    expect(readBirthday('2014-03-15')).toBe('03/15/2014');
    expect(readBirthday('March 15, 2014')).toBe('03/15/2014');
    expect(readBirthday('15-Mar-2014')).toBe('03/15/2014');
  });

  it('drops a date it cannot read, instead of passing a guess through as a password', () => {
    expect(readBirthday('02/30/2014')).toBe('');
    expect(readBirthday('n/a')).toBe('');
    expect(readBirthday('')).toBe('');
    expect(readBirthday('03/15/1899')).toBe('');   // before any learner
    expect(readBirthday('03/15/2099')).toBe('');   // not yet born
  });

  it('reads an Excel day serial only where a heading has called the column a birthday', () => {
    // 41713 is 2014-03-15. Elsewhere it is far more likely an LRN or a score.
    expect(readBirthday('41713', { allowSerial: true })).toBe('03/15/2014');
    expect(readBirthday('41713')).toBe('');
  });
});

describe('a whole table row arriving as one string', () => {
  // What a photographed list produced when the model transcribed rows rather
  // than columns: the row number and the birth date both ended up inside the
  // name, and every learner got a random password despite the list having a
  // Date of Birth column.
  it('takes the row number off the front and the birthday out of the middle', () => {
    expect(tidyRosterEntry('1 Mercer Alex 03/14/2005')).toEqual({ name: 'Mercer Alex', birthday: '03/14/2005' });
    expect(tidyRosterEntry('7 Santos Gabriel August 27, 2003')).toEqual({ name: 'Santos Gabriel', birthday: '08/27/2003' });
  });

  it('leaves a name already carrying its comma intact', () => {
    expect(tidyRosterEntry('Dela Cruz, Juan Miguel, March 15, 2014'))
      .toEqual({ name: 'Dela Cruz, Juan Miguel', birthday: '03/15/2014' });
  });

  it('keeps a birthday from its own column over one found inside the name', () => {
    expect(tidyRosterEntry('Mercer Alex 03/14/2005', '03/15/2014').birthday).toBe('03/15/2014');
  });

  it('leaves a name alone when the digits in it are not a date', () => {
    expect(tidyRosterEntry('Mercer Alex III')).toEqual({ name: 'Mercer Alex III', birthday: '' });
    expect(splitDateOutOfName('Room 214 Mercer').birthday).toBe('');
  });

  it('drops the heading row instead of enrolling it as a learner', () => {
    expect(looksLikeAHeaderRow('# Surname First Name Date of Birth')).toBe(true);
    expect(looksLikeAHeaderRow('Last Name, First Name')).toBe(true);
    expect(looksLikeAHeaderRow('Dela Cruz, Juan Miguel')).toBe(false);
    expect(looksLikeAHeaderRow('Delacruz, Norma')).toBe(false);
  });

  it('reads the reported sheet end to end, learners only', () => {
    const { students } = extractRoster([
      ['#', 'Surname', 'First Name', 'Date of Birth'],
      ['1', 'Mercer', 'Alex', 'March 14, 2005'],
      ['2', 'Ramos', 'Beatrice', 'July 22, 2004'],
      ['6', 'Al-Mansoor', 'Fatima', 'April 12, 2004'],
    ]);
    expect(students).toEqual([
      { name: 'Mercer, Alex', birthday: '03/14/2005' },
      { name: 'Ramos, Beatrice', birthday: '07/22/2004' },
      { name: 'Al-Mansoor, Fatima', birthday: '04/12/2004' },
    ]);
  });
});

describe('composeName — the shape the app sorts and greets on', () => {
  it('writes "Surname, Given" when the surname arrived as its own field', () => {
    expect(composeName({ lastName: 'Mercer', firstName: 'Alex' })).toBe('Mercer, Alex');
    expect(composeName({ lastName: 'Dela Cruz', firstName: 'Juan', middleName: 'Santos' })).toBe('Dela Cruz, Juan S.');
  });

  it('leaves a combined name for withSurnameComma to handle after tidying', () => {
    // composeName runs before the row number and the date come off, so it must
    // not write a comma into "1 Mercer Alex 03/14/2005".
    expect(composeName({ name: 'Mercer Alex' })).toBe('Mercer Alex');
    expect(composeName({ lastName: 'Mercer' })).toBe('Mercer');
  });
});

describe('middleInitial — School Form 1 prints one letter, not the whole name', () => {
  it('abbreviates a spelled-out middle name', () => {
    expect(middleInitial('Balestero')).toBe('B.');
    expect(middleInitial('Santos')).toBe('S.');
  });

  it('leaves a name already written as an initial on the same letter', () => {
    // The same column is headed "Middle Name" on one export and "Middle
    // Initial" on the next, so this runs over both. "S" and "S." must not
    // become "S.." or "S. .".
    expect(middleInitial('S')).toBe('S.');
    expect(middleInitial('S.')).toBe('S.');
    expect(middleInitial('S. C.')).toBe('S.');
  });

  it('takes one letter from a multi-word maternal surname', () => {
    // The form has one box for it, so "Dela Cruz" is "D." and not "D.C.".
    expect(middleInitial('Dela Cruz')).toBe('D.');
  });

  it('drops the placeholders a roster puts in an empty middle-name column', () => {
    // "N/A" used to become the initial "N." — a letter belonging to no
    // relative, printed on the class list all year.
    for (const filler of ['', '  ', 'N/A', 'n/a', 'NA', 'none', '-', '--', '.', 'x']) {
      expect(middleInitial(filler)).toBe('');
    }
  });

  it('does not leave a stray full stop when there is no middle name', () => {
    expect(composeName({ lastName: 'Mercer', firstName: 'Alex', middleName: 'N/A' })).toBe('Mercer, Alex');
    expect(composeName({ lastName: 'Mercer', firstName: 'Alex', middleName: null })).toBe('Mercer, Alex');
  });
});

describe('abbreviateMiddleName — the middle name inside a single combined column', () => {
  it('abbreviates the trailing middle name of a surname-first name', () => {
    // The reported failure: a class list with one "LEARNER'S NAME" column came
    // back spelled out, in a format nobody at the school uses.
    expect(abbreviateMiddleName('Faustino, Rafael Luis Balestero')).toBe('Faustino, Rafael Luis B.');
    expect(abbreviateMiddleName('Geronimo, Alyssa Jane Mamitag')).toBe('Geronimo, Alyssa Jane M.');
  });

  it('leaves a name with no surname boundary alone', () => {
    // Without a comma there is nothing saying where the given names start, so
    // the last word may well be the surname. withSurnameComma runs first and
    // supplies the comma when it can.
    expect(abbreviateMiddleName('Rafael Luis Balestero')).toBe('Rafael Luis Balestero');
  });

  it('needs two given names before there is a middle one to find', () => {
    expect(abbreviateMiddleName('Faustino, Rafael')).toBe('Faustino, Rafael');
  });

  it('is idempotent, and gives a bare initial its full stop', () => {
    // Runs over names that composeName/joinName already reduced, so it must
    // not turn "B." into "B.." or re-abbreviate "Luis".
    expect(abbreviateMiddleName('Faustino, Rafael Luis B.')).toBe('Faustino, Rafael Luis B.');
    expect(abbreviateMiddleName('Faustino, Rafael Luis B')).toBe('Faustino, Rafael Luis B.');
    expect(abbreviateMiddleName(abbreviateMiddleName('Faustino, Rafael Luis Balestero')))
      .toBe('Faustino, Rafael Luis B.');
  });

  it('keeps a suffix, and does not mistake it for the middle name', () => {
    expect(abbreviateMiddleName('Santos, Juan Cruz Jr.')).toBe('Santos, Juan C. Jr.');
    expect(abbreviateMiddleName('Santos, Juan Cruz III')).toBe('Santos, Juan C. III');
    // Nothing left to abbreviate once the suffix is lifted off.
    expect(abbreviateMiddleName('Santos, Juan Jr.')).toBe('Santos, Juan Jr.');
  });

  it('takes one letter from a multi-word maternal surname', () => {
    // The form gives it one box, so "Dela Cruz" is "D." — and the particle
    // must not be read as the whole middle name, which would give "Juan D."
    // from a different word than intended or strand "Cruz" as a given name.
    expect(abbreviateMiddleName('Santos, Juan Dela Cruz')).toBe('Santos, Juan D.');
    expect(abbreviateMiddleName('Santos, Juan Miguel San Jose')).toBe('Santos, Juan Miguel S.');
  });

  it('will not abbreviate the only spelled-out name a learner has', () => {
    // "Ma." is short for Maria and "Teresa" is the child's actual first name.
    // Abbreviating the trailing word here would leave "Ma. T." and no name.
    expect(abbreviateMiddleName('Dela Cruz, Ma. Teresa')).toBe('Dela Cruz, Ma. Teresa');
    // With a real middle name after it, there is something to reduce again.
    expect(abbreviateMiddleName('Dela Cruz, Ma. Teresa Santos')).toBe('Dela Cruz, Ma. Teresa S.');
  });

  it('accepts the case it gets wrong, knowingly', () => {
    // A child with two given names and no middle name. Nothing in the string
    // distinguishes this from the Balestero case above, and the roster editor
    // shows the result for the teacher to correct before any account is made.
    // Pinned so the trade-off is visible rather than discovered later.
    expect(abbreviateMiddleName('Dela Cruz, Juan Miguel')).toBe('Dela Cruz, Juan M.');
  });
});

describe('a middle name is inferred only where the sheet left it to be inferred', () => {
  it('reduces a combined name column, which is the common School Form export', () => {
    const { students } = extractRoster([
      ["Learner's Name", 'Birthday'],
      ['Faustino, Rafael Luis Balestero', '03/30/2004'],
      ['Bautista, Maria Clara Cruz', '11/30/2013'],
    ]);
    expect(students.map(s => s.name)).toEqual(['Faustino, Rafael Luis B.', 'Bautista, Maria Clara C.']);
  });

  it('leaves a First Name column alone when no middle column sits beside it', () => {
    // The sheet has said the whole column is given names. Inferring here would
    // abbreviate a real first name — "Rafael Luis" is not "Rafael L.".
    const { students } = extractRoster([
      ['Last Name', 'First Name'],
      ['Faustino', 'Rafael Luis'],
    ]);
    expect(students[0].name).toBe('Faustino, Rafael Luis');
  });

  it('collapses two middle columns to one initial rather than one each', () => {
    // A sheet carrying both "Middle Name" and "Middle Initial" is describing
    // the same name twice. "Juan S. S." is not a name.
    const { students } = extractRoster([
      ['Last Name', 'First Name', 'Middle Name', 'Middle Initial'],
      ['Dela Cruz', 'Juan', 'Santos', 'S.'],
    ]);
    expect(students[0].name).toBe('Dela Cruz, Juan S.');
  });
});

describe('withSurnameComma — the surname boundary in a combined name', () => {
  it('marks the surname in a roster entered last name first', () => {
    expect(withSurnameComma('Mercer Alex')).toBe('Mercer, Alex');
    expect(withSurnameComma('Villanueva Ian')).toBe('Villanueva, Ian');
    expect(withSurnameComma('Al-Mansoor Fatima')).toBe('Al-Mansoor, Fatima');
  });

  it('keeps a multi-word surname whole', () => {
    expect(withSurnameComma('Dela Cruz Juan Miguel')).toBe('Dela Cruz, Juan Miguel');
    expect(withSurnameComma('De Guzman Maria')).toBe('De Guzman, Maria');
    expect(withSurnameComma('Delos Santos Ana Marie')).toBe('Delos Santos, Ana Marie');
    expect(withSurnameComma('De La Cruz Juan')).toBe('De La Cruz, Juan');
    expect(withSurnameComma('San Juan Pedro')).toBe('San Juan, Pedro');
  });

  it('changes nothing that is already settled or has nothing to split', () => {
    expect(withSurnameComma('Dela Cruz, Juan Miguel')).toBe('Dela Cruz, Juan Miguel');
    expect(withSurnameComma('Mercer')).toBe('Mercer');
    expect(withSurnameComma('')).toBe('');
    // A name that is nothing but particles keeps a given name rather than
    // swallowing the last word into the surname.
    expect(withSurnameComma('Dela Cruz')).toBe('Dela, Cruz');
  });
});

describe('a single combined name column', () => {
  it('gets the surname comma, since a roster is entered last name first', () => {
    const { students } = extractRoster([
      ['Name', 'Date of Birth'],
      ['Mercer Alex', 'March 14, 2005'],
      ['Dela Cruz Juan Miguel', '03/15/2014'],
    ]);
    expect(students).toEqual([
      { name: 'Mercer, Alex', birthday: '03/14/2005' },
      // Surname comma inferred by withSurnameComma, then the trailing given
      // word read as the middle name — see abbreviateMiddleName, and the test
      // there that pins this exact trade-off.
      { name: 'Dela Cruz, Juan M.', birthday: '03/15/2014' },
    ]);
  });

  it('leaves a surname-only column alone rather than splitting the surname', () => {
    // "Dela Cruz" here is one family name, not a surname and a given name.
    const { students } = extractRoster([['Last Name'], ['Dela Cruz'], ['De Guzman']]);
    expect(students.map(s => s.name)).toEqual(['Dela Cruz', 'De Guzman']);
  });
});

describe('cellToText — what exceljs actually hands back', () => {
  it('reads a date cell as the day the teacher typed, not a timezone away from it', () => {
    expect(cellToText(new Date(Date.UTC(2014, 2, 15)))).toBe('03/15/2014');
  });

  it('reads formatted, linked and calculated cells instead of "[object Object]"', () => {
    expect(cellToText({ richText: [{ text: 'Dela Cruz, ' }, { text: 'Juan' }] })).toBe('Dela Cruz, Juan');
    expect(cellToText({ text: 'Reyes, Mark', hyperlink: 'mailto:x@y.z' })).toBe('Reyes, Mark');
    expect(cellToText({ formula: 'A1&B1', result: 'Bautista, Maria' })).toBe('Bautista, Maria');
    expect(cellToText({ error: '#REF!' })).toBe('');
    expect(cellToText(null)).toBe('');
  });

  it('carries a formatted name through the whole extraction', () => {
    const { students } = extractRoster([
      ['Name'],
      [cellToText({ richText: [{ text: 'Dela Cruz, ' }, { text: 'Juan' }] })],
      [cellToText({ richText: [{ text: 'Reyes, Mark' }] })],
    ]);
    expect(students.map(s => s.name)).toEqual(['Dela Cruz, Juan', 'Reyes, Mark']);
  });
});
