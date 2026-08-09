import { describe, it, expect, vi } from 'vitest';
import {
  isReadableDate, previewPassword, parseRosterLines,
  isFilledRow, withBlankRow, emptyRoster, rosterPayload,
  normalizeRosterName, firstNameFromRoster,
} from '../../src/utils/roster.js';

/**
 * The roster editor's parsing, now that name and birthday are separate columns.
 *
 * Worth pinning because both failure modes are silent and land on a child: a
 * birthday read wrongly is an account they cannot sign in to, and a birthday
 * dropped instead of refused hands them a random password nobody wrote down.
 */

describe('isReadableDate', () => {
  it('accepts the formats a Philippine school form actually carries', () => {
    expect(isReadableDate('03/15/2014')).toBe(true);
    expect(isReadableDate('3/5/2014')).toBe(true);
    expect(isReadableDate('2014-03-15')).toBe(true);
    expect(isReadableDate('3-15-2014')).toBe(true);
  });

  it('refuses dates that do not exist', () => {
    expect(isReadableDate('02/30/2014')).toBe(false);
    expect(isReadableDate('13/01/2014')).toBe(false);
    expect(isReadableDate('00/10/2014')).toBe(false);
  });

  it('refuses anything outside a plausible range for a learner', () => {
    expect(isReadableDate('03/15/1900')).toBe(false);      // before 1950
    expect(isReadableDate('03/15/2999')).toBe(false);      // in the future
  });

  it('refuses text that is not a date at all', () => {
    for (const bad of ['', '   ', 'abc', '15/2014', '2014']) {
      expect(isReadableDate(bad)).toBe(false);
    }
  });
});

describe('previewPassword', () => {
  it('is the birthday as MMDDYYYY, zero-padded', () => {
    expect(previewPassword('03/15/2014')).toBe('03152014');
    expect(previewPassword('3/5/2014')).toBe('03052014');
    expect(previewPassword('2014-03-15')).toBe('03152014');
  });

  it('is null for anything unreadable, rather than a guess', () => {
    expect(previewPassword('02/30/2014')).toBeNull();
    expect(previewPassword('')).toBeNull();
  });
});

describe('parseRosterLines — what a paste turns into', () => {
  it('keeps a surname comma as part of the name', () => {
    // "Dela Cruz, Juan" is one learner, not a name and a birthday.
    expect(parseRosterLines('Dela Cruz, Juan')).toEqual([{ name: 'Dela Cruz, Juan', birthday: '' }]);
  });

  it('splits off a trailing date, and only a trailing date', () => {
    expect(parseRosterLines('Dela Cruz, Juan, 03/15/2014')).toEqual([
      { name: 'Dela Cruz, Juan', birthday: '03/15/2014' },
    ]);
  });

  it('reads a whole pasted block, blank lines and all', () => {
    const pasted = 'Dela Cruz, Juan, 03/15/2014\n\nSantos, Maria Clara, 07/02/2014\nRizal, Jose\n   ';
    expect(parseRosterLines(pasted)).toEqual([
      { name: 'Dela Cruz, Juan', birthday: '03/15/2014' },
      { name: 'Santos, Maria Clara', birthday: '07/02/2014' },
      { name: 'Rizal, Jose', birthday: '' },
    ]);
  });

  it('keeps an unreadable date rather than discarding it', () => {
    // It has to survive parsing to be reported back to the teacher.
    expect(parseRosterLines('Rizal, Jose, 31/31/2014')).toEqual([
      { name: 'Rizal, Jose', birthday: '31/31/2014' },
    ]);
  });

  it('survives empty input', () => {
    expect(parseRosterLines('')).toEqual([]);
    expect(parseRosterLines(null)).toEqual([]);
  });
});

describe('normalizeRosterName', () => {
  it('keeps the surname comma — it is the only marker of where a family name ends', () => {
    expect(normalizeRosterName('Dela Cruz, Juan Miguel')).toBe('Dela Cruz, Juan Miguel');
  });

  it('collapses runs of whitespace', () => {
    expect(normalizeRosterName('Dela  Cruz,   Juan')).toBe('Dela Cruz, Juan');
  });

  it('keeps only the first comma — a name has one surname boundary', () => {
    expect(normalizeRosterName('Dela Cruz, Juan, Miguel')).toBe('Dela Cruz, Juan Miguel');
  });

  it('leaves a comma-free name alone', () => {
    expect(normalizeRosterName('Dela Cruz Juan')).toBe('Dela Cruz Juan');
  });
});

describe('firstNameFromRoster — who the dashboard says hello to', () => {
  // Two regressions live here. The original took .split(' ')[0] and greeted a
  // child by their surname; the fix for that took only the first token of the
  // tail, so "Juan Miguel" was greeted as "Juan" with a comma and — once
  // commas were being stripped on save — as "Miguel" without one, because the
  // no-comma branch fell back to the trailing word.
  it('greets the whole given name, not just its first word', () => {
    expect(firstNameFromRoster('Dela Cruz, Juan Miguel')).toBe('Juan Miguel');
  });

  it('greets a single given name', () => {
    expect(firstNameFromRoster('Rizal, Jose')).toBe('Jose');
  });

  it('never greets by the trailing word, which is a second given name', () => {
    // The reported bug: "Rizal Jose Protacio" was greeted as "Protacio".
    expect(firstNameFromRoster('Rizal Jose Protacio')).not.toBe('Protacio');
    expect(firstNameFromRoster('Rizal Jose Protacio')).toBe('Jose Protacio');
  });

  it('drops exactly one token when no comma was typed', () => {
    // Cannot be exact without the comma — a two-word surname is
    // indistinguishable from a second given name. Including part of the
    // surname is the safer miss than greeting a child by a name that is not
    // theirs.
    expect(firstNameFromRoster('Dela Cruz Juan')).toBe('Cruz Juan');
  });

  it('falls back to the whole string when there is nothing to drop', () => {
    expect(firstNameFromRoster('Madonna')).toBe('Madonna');
    expect(firstNameFromRoster('')).toBe('');
    expect(firstNameFromRoster(null)).toBe('');
  });
});

describe('withBlankRow', () => {
  it('always leaves exactly one empty row to type into', () => {
    const rows = withBlankRow([{ name: 'Rizal, Jose', birthday: '' }]);
    expect(rows).toHaveLength(2);
    expect(isFilledRow(rows[1])).toBe(false);
  });

  it('collapses trailing blanks instead of letting them pile up', () => {
    const rows = withBlankRow([
      { name: 'Rizal, Jose', birthday: '' },
      { name: '', birthday: '' },
      { name: '', birthday: '' },
      { name: '', birthday: '' },
    ]);
    expect(rows).toHaveLength(2);
  });

  it('does not eat a row that has only a birthday typed so far', () => {
    // Mid-entry: the teacher tabbed to the date first. Dropping it would
    // delete what they just typed.
    const rows = withBlankRow([{ name: '', birthday: '03/15/2014' }]);
    expect(rows[0].birthday).toBe('03/15/2014');
  });

  it('starts from an empty roster without collapsing to nothing', () => {
    expect(withBlankRow(emptyRoster())).toHaveLength(1);
  });
});

describe('rosterPayload — what gets sent', () => {
  const onProblem = vi.fn();

  it('drops the trailing blank row and trims what is left', () => {
    const payload = rosterPayload([
      { name: '  Dela Cruz, Juan  ', birthday: ' 03/15/2014 ' },
      { name: '', birthday: '' },
    ], onProblem);
    expect(payload).toEqual([{ name: 'Dela Cruz, Juan', birthday: '03/15/2014' }]);
  });

  it('sends null for a learner with no birthday — a real choice, not a mistake', () => {
    const payload = rosterPayload([{ name: 'Rizal, Jose', birthday: '' }], onProblem);
    expect(payload).toEqual([{ name: 'Rizal, Jose', birthday: null }]);
  });

  it('refuses the whole roster when a birthday cannot be read', () => {
    // Refused rather than dropped: dropping it silently gives the learner a
    // random password while the teacher believes they set a memorable one.
    const problem = vi.fn();
    const payload = rosterPayload([
      { name: 'Rizal, Jose', birthday: '31/31/2014' },
    ], problem);

    expect(payload).toBeNull();
    expect(problem).toHaveBeenCalledOnce();
    expect(problem.mock.calls[0][0]).toContain('Rizal, Jose');
    expect(problem.mock.calls[0][0]).toContain('31/31/2014');
  });

  it('ignores a stray date typed against no name', () => {
    // An abandoned half-row must not block the submit.
    const problem = vi.fn();
    const payload = rosterPayload([
      { name: 'Rizal, Jose', birthday: '' },
      { name: '', birthday: 'nonsense' },
    ], problem);

    expect(payload).toEqual([{ name: 'Rizal, Jose', birthday: null }]);
    expect(problem).not.toHaveBeenCalled();
  });

  it('is empty, not null, when nothing has been entered', () => {
    expect(rosterPayload(emptyRoster(), onProblem)).toEqual([]);
  });
});
