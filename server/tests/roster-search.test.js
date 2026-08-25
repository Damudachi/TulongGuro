import { describe, it, expect } from 'vitest';
import { foldForSearch, matchesRosterQuery, sortRosterByName } from '../../src/utils/roster.js';

/**
 * Finding one learner in a roster, and reading a roster in order.
 *
 * Both failure modes here are quiet ones. A search that misses reports a child
 * who is plainly on the list as not being there, and an admin believes the
 * transfer already happened or the account was never made. A sort that is not
 * a sort makes a forty-name section something you read top to bottom every
 * time — which is what ordering by Student ID, the sequence accounts happened
 * to be created in, actually was.
 */

/** A roster in the shape these screens hold it, names as the editor stores them. */
const ROSTER = [
  { id: '1', name: 'Sotto, Elisha Xandra S.', username: 'YBS-26-0021' },
  { id: '2', name: 'Paracuelles, Rella Vaunne G.', username: 'YBS-26-0022' },
  { id: '3', name: 'Naguiat, Jeon Edrei', username: 'YBS-26-0023' },
  { id: '4', name: 'Dela Cruz, Juan Miguel', username: 'YBS-26-0024' },
  { id: '5', name: 'Peña, Sophia Marie', username: 'YBS-26-0025' },
  { id: '6', name: 'Blair, Aaron', username: 'YBS-26-0026' },
];

const namesOf = (list) => list.map(s => s.name);
const search = (q) => namesOf(ROSTER.filter(s => matchesRosterQuery(s, q)));

describe('foldForSearch', () => {
  it('strips the accents a Filipino roster actually carries', () => {
    expect(foldForSearch('Peña')).toBe('pena');
    expect(foldForSearch('Muñoz')).toBe('munoz');
  });

  it('reduces the surname comma to a space so word order can be free', () => {
    expect(foldForSearch('Dela Cruz, Juan Miguel')).toBe('dela cruz juan miguel');
  });

  it('is unbothered by empty and missing input', () => {
    expect(foldForSearch('')).toBe('');
    expect(foldForSearch(null)).toBe('');
    expect(foldForSearch(undefined)).toBe('');
  });
});

describe('matchesRosterQuery', () => {
  it('finds a learner by surname', () => {
    expect(search('sotto')).toEqual(['Sotto, Elisha Xandra S.']);
  });

  it('finds a learner by their given name, which is not what the string starts with', () => {
    expect(search('juan')).toEqual(['Dela Cruz, Juan Miguel']);
  });

  /**
   * The reason terms are matched independently. "cruz juan" is how the row
   * reads on screen; "juan cruz" is how a person says it. Requiring one of
   * them makes word order a rule the admin has to guess at.
   */
  it('does not care which order the terms come in', () => {
    expect(search('cruz juan')).toEqual(['Dela Cruz, Juan Miguel']);
    expect(search('juan cruz')).toEqual(['Dela Cruz, Juan Miguel']);
  });

  it('matches across the comma, which a plain substring search would not', () => {
    expect(search('cruz, juan')).toEqual(['Dela Cruz, Juan Miguel']);
  });

  it('finds an accented name from an unaccented keyboard', () => {
    expect(search('pena')).toEqual(['Peña, Sophia Marie']);
    expect(search('Peña')).toEqual(['Peña, Sophia Marie']);
  });

  it('searches the Student ID too — the other thing printed on the row', () => {
    expect(search('0023')).toEqual(['Naguiat, Jeon Edrei']);
    expect(search('YBS-26-0026')).toEqual(['Blair, Aaron']);
  });

  it('ignores case', () => {
    expect(search('BLAIR')).toEqual(['Blair, Aaron']);
  });

  /** An empty box is not a filter. Every learner stays on screen. */
  it('matches everyone when nothing has been typed', () => {
    expect(search('')).toHaveLength(ROSTER.length);
    expect(search('   ')).toHaveLength(ROSTER.length);
  });

  it('reports nothing rather than everything when there is no match', () => {
    expect(search('zzz')).toEqual([]);
  });

  /** Every term must land, or "juan santos" would match Juan and Santos both. */
  it('requires all terms, not any', () => {
    expect(search('juan sotto')).toEqual([]);
  });
});

describe('sortRosterByName', () => {
  it('orders by surname, because that is what the stored name starts with', () => {
    expect(namesOf(sortRosterByName(ROSTER))).toEqual([
      'Blair, Aaron',
      'Dela Cruz, Juan Miguel',
      'Naguiat, Jeon Edrei',
      'Paracuelles, Rella Vaunne G.',
      'Peña, Sophia Marie',
      'Sotto, Elisha Xandra S.',
    ]);
  });

  /**
   * "Ñ" sorts beside N, not after Z. A byte comparison puts Peña after Sotto,
   * which is how an admin ends up scrolling past a name that is filed exactly
   * where they looked for it.
   */
  it('files an accented surname where a reader expects it', () => {
    const sorted = namesOf(sortRosterByName(ROSTER));
    expect(sorted.indexOf('Peña, Sophia Marie')).toBeLessThan(sorted.indexOf('Sotto, Elisha Xandra S.'));
    expect(sorted.indexOf('Paracuelles, Rella Vaunne G.')).toBeLessThan(sorted.indexOf('Peña, Sophia Marie'));
  });

  it('leaves the caller\'s array alone', () => {
    const original = namesOf(ROSTER);
    sortRosterByName(ROSTER);
    expect(namesOf(ROSTER)).toEqual(original);
  });

  it('breaks a tie on Student ID rather than shuffling between renders', () => {
    const twins = [
      { id: 'b', name: 'Santos, Maria', username: 'YBS-26-0040' },
      { id: 'a', name: 'Santos, Maria', username: 'YBS-26-0009' },
    ];
    expect(sortRosterByName(twins).map(s => s.username)).toEqual(['YBS-26-0009', 'YBS-26-0040']);
  });

  it('survives an empty roster and a missing name', () => {
    expect(sortRosterByName([])).toEqual([]);
    expect(sortRosterByName(null)).toEqual([]);
    expect(sortRosterByName([{ id: 'x' }, { id: 'y', name: 'Abad, Ana' }]).map(s => s.id))
      .toEqual(['x', 'y']);
  });
});
