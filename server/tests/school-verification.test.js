import { describe, it, expect } from 'vitest';
import masterlist from '../depedMasterlist.js';
import { validateContactEmail } from '../accountEmails.js';

const {
  MATCHED, NAME_MISMATCH, NOT_FOUND, NO_MASTERLIST, NAME_MATCH_FLOOR,
  normalizeSchoolId, normalizeSchoolName, nameSimilarity, distinctiveTokens,
  verifySchool, describeVerification, nearDuplicateNames,
} = masterlist;

/** A masterlist the way loadMasterlist() would hand one over. */
const listOf = (...rows) => new Map(rows.map(r => [r.id, r]));

const MANILA_SCI = {
  id: '136353',
  name: 'Manila Science High School',
  division: 'Manila',
  region: 'NCR',
};

describe('normalizeSchoolId', () => {
  it('keeps the digits and drops the decoration', () => {
    expect(normalizeSchoolId('136353')).toBe('136353');
    expect(normalizeSchoolId(' 136-353 ')).toBe('136353');
    expect(normalizeSchoolId('School ID: 136353')).toBe('136353');
  });

  it('accepts the five-to-nine digit band DepEd IDs fall in', () => {
    expect(normalizeSchoolId('12345')).toBe('12345');
    expect(normalizeSchoolId('123456789')).toBe('123456789');
  });

  // The unique column in the database is this value, so anything that isn't an
  // ID has to become null rather than become a row.
  it('rejects anything that cannot be an ID', () => {
    expect(normalizeSchoolId('N/A')).toBeNull();
    expect(normalizeSchoolId('1234')).toBeNull();
    expect(normalizeSchoolId('1234567890')).toBeNull();
    expect(normalizeSchoolId('')).toBeNull();
    expect(normalizeSchoolId(null)).toBeNull();
    expect(normalizeSchoolId(undefined)).toBeNull();
  });
});

describe('school name normalization', () => {
  it('expands the abbreviations schools actually type', () => {
    expect(normalizeSchoolName('Bagong Silang ES')).toBe('bagong silang elementary school');
    expect(normalizeSchoolName('Rizal NHS')).toBe('rizal national high school');
    expect(normalizeSchoolName('Sto. Niño Elem. School')).toBe('santo nino elementary school');
  });

  // Two keyboards, one school. A comparison that treated these as different
  // would flag a correct registration for review every single time.
  it('folds accents so Muñoz and Munoz are the same school', () => {
    expect(normalizeSchoolName('Muñoz Central School'))
      .toBe(normalizeSchoolName('Munoz Central School'));
  });

  it('treats punctuation as a separator, not as nothing', () => {
    // "St.Paul" must become two tokens, or it matches nothing.
    expect(normalizeSchoolName('St.Paul School')).toBe('saint paul school');
  });

  it('leaves the distinctive part of a name behind', () => {
    expect(distinctiveTokens('Manila Science High School')).toEqual(['manila', 'science']);
  });
});

describe('nameSimilarity', () => {
  it('scores an abbreviation against its expansion as the same school', () => {
    expect(nameSimilarity('Manila Science HS', 'Manila Science High School')).toBe(1);
  });

  it('stays above the floor when a word is dropped or added', () => {
    expect(nameSimilarity('Manila Science High School', 'Manila Science High School Main'))
      .toBeGreaterThanOrEqual(NAME_MATCH_FLOOR);
  });

  // The case the floor exists for: two schools that share every generic word
  // and no distinctive one.
  it('falls below the floor for schools that only share their generic words', () => {
    expect(nameSimilarity('San Jose Elementary School', 'Rizal Central Elementary School'))
      .toBeLessThan(NAME_MATCH_FLOOR);
  });

  it('is zero when either side is empty', () => {
    expect(nameSimilarity('', 'Manila Science High School')).toBe(0);
    expect(nameSimilarity('Manila Science High School', null)).toBe(0);
  });

  // A set, not a list — otherwise padding a name with repeats moves the score.
  it('is not moved by a repeated word', () => {
    expect(nameSimilarity('Manila Manila Science', 'Manila Science'))
      .toBe(nameSimilarity('Manila Science', 'Manila Science'));
  });
});

describe('verifySchool', () => {
  const list = listOf(MANILA_SCI);

  it('matches an ID whose name agrees', () => {
    const check = verifySchool({ schoolId: '136353', schoolName: 'Manila Science HS' }, list);
    expect(check.verdict).toBe(MATCHED);
    expect(check.official).toEqual(MANILA_SCI);
  });

  it('flags an ID whose name does not agree, and still returns the record', () => {
    const check = verifySchool({ schoolId: '136353', schoolName: 'Quezon City High School' }, list);
    expect(check.verdict).toBe(NAME_MISMATCH);
    // The operator needs to see what DepEd calls it, which is the whole point
    // of not simply refusing here.
    expect(check.official.name).toBe('Manila Science High School');
  });

  it('reports an ID that is not in the list', () => {
    expect(verifySchool({ schoolId: '999999', schoolName: 'Nowhere ES' }, list).verdict).toBe(NOT_FOUND);
  });

  it('treats an unusable ID as not found', () => {
    expect(verifySchool({ schoolId: 'N/A', schoolName: 'Nowhere ES' }, list).verdict).toBe(NOT_FOUND);
  });

  // The distinction this whole module turns on: NOT_FOUND is a statement about
  // the school, NO_MASTERLIST is a statement about us. Only the first may cost
  // a school anything, so they must never collapse into each other.
  it('says NO_MASTERLIST, not NOT_FOUND, when there is no list to check', () => {
    const check = verifySchool({ schoolId: '136353', schoolName: 'Manila Science HS' }, null);
    expect(check.verdict).toBe(NO_MASTERLIST);
    expect(check.verdict).not.toBe(NOT_FOUND);
    // The ID is still carried through — it is stored either way.
    expect(check.schoolId).toBe('136353');
  });
});

describe('describeVerification', () => {
  const list = listOf(MANILA_SCI);

  it('names where a matched school sits', () => {
    const note = describeVerification(verifySchool({ schoolId: '136353', schoolName: 'Manila Science HS' }, list), 'Manila Science HS');
    expect(note).toContain('136353');
    expect(note).toContain('Manila');
  });

  it('puts both spellings in front of the operator on a mismatch', () => {
    const check = verifySchool({ schoolId: '136353', schoolName: 'Quezon City High School' }, list);
    const note = describeVerification(check, 'Quezon City High School');
    expect(note).toContain('Manila Science High School');
    expect(note).toContain('Quezon City High School');
  });

  it('blames the server, not the school, when nothing was checked', () => {
    const note = describeVerification(verifySchool({ schoolId: '136353', schoolName: 'X' }, null), 'X');
    expect(note).toMatch(/no DepEd masterlist is installed/i);
  });
});

describe('nearDuplicateNames', () => {
  it('spots a school already registered under a near-identical name', () => {
    const found = nearDuplicateNames('Manila Science HS', ['Manila Science High School', 'Rizal ES']);
    expect(found.map(f => f.name)).toEqual(['Manila Science High School']);
  });

  // The false positive that would matter most in the Philippines: the same
  // school name in two different divisions is two real schools. This function
  // reports, and nothing acts on it — see the note on DUPLICATE_NAME_FLOOR.
  it('does not confuse schools that merely share a common name pattern', () => {
    expect(nearDuplicateNames('San Jose Elementary School', ['San Miguel Elementary School'])).toEqual([]);
  });

  it('returns nothing when there is nothing to compare against', () => {
    expect(nearDuplicateNames('Manila Science HS', [])).toEqual([]);
    expect(nearDuplicateNames('Manila Science HS', null)).toEqual([]);
  });

  it('ranks the closest match first', () => {
    const found = nearDuplicateNames('Manila Science High School', [
      'Manila Science High School Annex',
      'Manila Science High School',
    ]);
    expect(found[0].name).toBe('Manila Science High School');
  });
});

describe('validateContactEmail', () => {
  it('accepts a real school address', () => {
    const check = validateContactEmail('office@school.deped.gov.ph');
    expect(check.ok).toBe(true);
    expect(check.email).toBe('office@school.deped.gov.ph');
  });

  it('normalizes case and surrounding space', () => {
    expect(validateContactEmail('  Office@School.Deped.Gov.PH ').email).toBe('office@school.deped.gov.ph');
  });

  // The mistake this rule exists for: pasting the sign-in name into the field
  // meant for a mailbox, which would leave the school unreachable again.
  it('refuses the synthetic sign-in domains, which have no mailbox behind them', () => {
    expect(validateContactEmail('principal@admin.com').ok).toBe(false);
    expect(validateContactEmail('maam.reyes@teacher.edu.ph').ok).toBe(false);
    expect(validateContactEmail('principal@admin.com').error).toMatch(/sign-in names/i);
  });

  it('refuses a domain nothing outside this machine could deliver to', () => {
    expect(validateContactEmail('principal@localhost').ok).toBe(false);
    expect(validateContactEmail('principal@school').ok).toBe(false);
  });

  it('refuses malformed addresses and blanks', () => {
    expect(validateContactEmail('').ok).toBe(false);
    expect(validateContactEmail('not-an-address').ok).toBe(false);
    expect(validateContactEmail('two@at@signs.com').ok).toBe(false);
    expect(validateContactEmail('@school.com').ok).toBe(false);
  });
});
