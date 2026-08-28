import { describe, it, expect } from 'vitest';
import {
  significantWords, initialsOf, initialLetters, suggestSlug,
  headMatches, tailMatches, codeMatchesName, suggestAlternatives, validateSlug,
} from '../schoolSlug.js';
import {
  suggestSchoolCode, schoolCodeProblem, schoolCodeMatchProblem,
} from '../../src/constants/schoolCode.js';

/**
 * The school code is frozen for the life of a school and printed on every
 * student ID it ever issues, so a wrong answer here is not a bug that gets
 * fixed — it is a bug that gets laminated.
 *
 * Two things go untested at your peril, and both are covered below because both
 * were live defects:
 *
 *   1. A name that abbreviates its own school type. "Magalang CS" is Magalang
 *      Central School; reading CS as one initial gave `mc`, a two-character
 *      code, and did so for 15,594 of the 83,094 masterlist schools.
 *   2. suggestAlternatives offering a code that codeMatchesName then refuses.
 *      The first version of the tail rule rejected a quarter of the app's own
 *      suggestions, which would have left a school with a taken code and no
 *      clickable way out.
 */

const DAYRIT = 'DR. CLEMENTE N. DAYRIT SR. MEMORIAL HIGH SCHOOL';
const free = async () => false;

describe('significantWords', () => {
  it('drops a possessive rather than making it a word', () => {
    // "Mary" | "s" | "Ville" gave initials `msva` and offered `msva-s` as an
    // alternative code — a tail of one letter, identifying nothing.
    expect(significantWords("Mary's Ville Academy")).toEqual(['Mary', 'Ville', 'Academy']);
  });

  it('keeps ñ as one letter instead of splitting the word', () => {
    expect(significantWords('Doña Aurora ES')).toEqual(['Dona', 'Aurora', 'ES']);
  });
});

describe('initialLetters', () => {
  it('expands a school-type abbreviation into its own letters', () => {
    expect(initialLetters('Magalang CS')).toBe('mcs');
    expect(initialLetters('Ambitacay ES')).toBe('aes');
    expect(initialLetters('Angeles City NHS')).toBe('acnhs');
  });

  it('gives the same answer whatever case the masterlist row is stored in', () => {
    // 3,473 masterlist names are stored in full capitals. Keying acronym
    // detection on capitalisation would hand those rows a different code from
    // the identical school stored mixed-case.
    expect(initialLetters('MAGALANG CS')).toBe(initialLetters('Magalang CS'));
    expect(initialLetters('MABALACAT ELEMENTARY SCHOOL')).toBe(initialLetters('Mabalacat Elementary School'));
  });

  it('leaves a spelled-out name alone', () => {
    expect(initialLetters('Mabalacat Elementary School')).toBe('mes');
  });

  it('does not treat a roman numeral as an acronym', () => {
    // "San Nicolas II ES" would otherwise spend two initials on i, i.
    expect(initialLetters('San Nicolas II ES')).toBe('snies');
  });

  it('reads past the four characters a suggestion is truncated to', () => {
    expect(initialLetters(DAYRIT)).toBe('dcndsmhs');
    expect(initialsOf(DAYRIT)).toBe('dcnd');
  });
});

describe('suggestSlug', () => {
  it('gives an abbreviated and a spelled-out name the same code', () => {
    expect(suggestSlug('Mabalacat ES')).toBe('mes-maba');
    expect(suggestSlug('Mabalacat Elementary School')).toBe('mes-maba');
  });

  it('no longer produces a two-letter head for an abbreviated name', () => {
    expect(suggestSlug('Magalang CS')).toBe('mcs-maga');
    expect(suggestSlug('Ambitacay ES')).toBe('aes-ambi');
  });

  it('does not repeat itself for a one-word school', () => {
    expect(suggestSlug('Tulongguro')).toBe('tulo');
  });
});

describe('headMatches', () => {
  it('accepts initials read in order, contiguous or not', () => {
    expect(headMatches(DAYRIT, 'dcnd')).toBe(true);   // the suggestion
    expect(headMatches(DAYRIT, 'cndm')).toBe(true);   // honorific dropped
    expect(headMatches(DAYRIT, 'dmhs')).toBe(true);   // suffix reached
  });

  it('refuses a letter the name does not offer', () => {
    // The bug this whole check exists for: there is no e anywhere in `mcs`.
    expect(headMatches('Magalang CS', 'mes')).toBe(false);
  });

  it('allows a two-letter head, because some names offer nothing longer', () => {
    expect(headMatches('Magalang CS', 'mc')).toBe(true);
  });

  it('allows more than four letters when the name offers them', () => {
    // Four is what the suggestion is truncated to, not a limit on the name.
    expect(headMatches('Angeles City NHS', 'acnhs')).toBe(true);
  });

  it('takes letters from the word itself for a one-word school', () => {
    expect(headMatches('Tulongguro', 'tulo')).toBe(true);
    expect(headMatches('Tulongguro', 'xyz')).toBe(false);
  });

  it('ignores a trailing collision number', () => {
    // "Shalom" suggests `shal`; the numbered fallback is `shal2` and has no
    // tail to carry the digit.
    expect(headMatches('Shalom', 'shal2')).toBe(true);
  });
});

describe('tailMatches', () => {
  it('accepts prefixes of consecutive words', () => {
    expect(tailMatches('Magalang CS', 'maga')).toBe(true);
    expect(tailMatches('Magalang CS', 'magacs')).toBe(true);      // maga|cs
    expect(tailMatches(DAYRIT, 'drcl')).toBe(true);               // dr|cl
  });

  it('lets the walk start at any word', () => {
    // What separates San Isidro from San Jose, both of which begin "san".
    expect(tailMatches('San Isidro Elementary School', 'isidro')).toBe(true);
  });

  it('steps over a middle initial', () => {
    expect(tailMatches('Emigdio A. Bondoc High School', 'emigbond')).toBe(true);
  });

  it('refuses letters the name does not contain', () => {
    expect(tailMatches('Magalang CS', 'maba')).toBe(false);
  });

  it('refuses a vowel-dropped form', () => {
    // Allowing any in-order subsequence would admit this, and would raise the
    // share of schools able to claim another school's code from 1.5% to 21%.
    expect(tailMatches('Mabalacat Elementary School', 'mblct')).toBe(false);
  });

  it('allows a trailing collision number', () => {
    expect(tailMatches('Magalang CS', 'maga2')).toBe(true);
  });
});

describe('a code the previous rule derived still validates', () => {
  // Not a nicety. The server ships before every cached copy of the script does,
  // so for a while browsers post codes derived by the old rule. A check that
  // refuses them kills those registrations at submit — the failure this module
  // was written to remove. Both cases below were live until the deploy dry-run
  // caught them.
  it('accepts a possessive counted as its own initial', () => {
    // Was `msva-mary` before the possessive was stripped; is `mva-mary` now.
    expect(suggestSlug("Mary's Ville Academy")).toBe('mva-mary');
    expect(codeMatchesName("Mary's Ville Academy", 'msva-mary').ok).toBe(true);
    expect(codeMatchesName("Mary's Ville Academy", 'mva-mary').ok).toBe(true);
  });

  it('accepts a tail that counted the possessive too', () => {
    // placeOf() reads the same words, so the old four letters were `kids` and
    // the new ones are `kida`.
    expect(suggestSlug("Kid's Avenue Learning Center")).toBe('kalc-kida');
    expect(codeMatchesName("Kid's Avenue Learning Center", 'kalc-kids').ok).toBe(true);
    expect(codeMatchesName("Kid's Avenue Learning Center", 'kalc-kida').ok).toBe(true);
  });
});

describe('a name whose own word is a number', () => {
  it('does not mistake it for a collision suffix', () => {
    // "Purok 3" reads `p3` and suggests `p3-puro`. Stripping the trailing digit
    // as a collision number left `p`, below the two-character floor, and the
    // module refused a code it had just offered.
    expect(suggestSlug('Purok 3')).toBe('p3-puro');
    expect(codeMatchesName('Purok 3', 'p3-puro').ok).toBe(true);
  });

  it('still reads a real collision suffix as one', () => {
    expect(codeMatchesName('Shalom', 'shal2').ok).toBe(true);
    expect(codeMatchesName('Magalang CS', 'mcs-maga2').ok).toBe(true);
  });
});

describe('codeMatchesName', () => {
  it('refuses one school the identity of another', () => {
    // The registration in the bug report: Magalang CS holding Mabalacat's code.
    expect(codeMatchesName('Magalang CS', 'mes-maba').ok).toBe(false);
    expect(codeMatchesName(DAYRIT, 'mes-maba').ok).toBe(false);
  });

  it('refuses an invented tail even when the head is right', () => {
    expect(codeMatchesName('Magalang CS', 'mcs-maba').ok).toBe(false);
  });

  it('lets the school that owns the code keep it', () => {
    expect(codeMatchesName('Mabalacat Elementary School', 'mes-maba').ok).toBe(true);
    expect(codeMatchesName('Mabalacat ES', 'mes-maba').ok).toBe(true);
  });

  it('names a code the registrant can actually use', () => {
    expect(codeMatchesName('Magalang CS', 'mes-maba').error).toContain('mcs-maga');
  });

  it('says nothing while the form is still half-filled', () => {
    // The field is checked on every keystroke; going red before there is a
    // name to check against would be noise, not help.
    expect(codeMatchesName('', 'mes-maba').ok).toBe(true);
    expect(codeMatchesName('Magalang CS', '').ok).toBe(true);
  });
});

describe('suggestAlternatives', () => {
  it('never offers a code its own validation would refuse', () => {
    // The invariant. A rejected suggestion leaves a school with a taken code
    // and nothing clickable to escape to.
    const names = [
      'Magalang CS', 'Mabalacat Elementary School', DAYRIT,
      'San Isidro Elementary School', "Mary's Ville Academy",
      'Emigdio A. Bondoc High School', 'Shalom', 'Angeles City NHS',
      'San Nicolas II ES', 'Doña Aurora ES',
    ];
    return Promise.all(names.map(async (name) => {
      const base = suggestSlug(name);
      const offered = await suggestAlternatives(name, async (slug) => slug === base);
      expect(offered.length).toBeGreaterThan(0);
      for (const code of [base, ...offered]) {
        expect(validateSlug(code).ok, `${name} -> ${code} is malformed`).toBe(true);
        expect(codeMatchesName(name, code).ok, `${name} -> ${code} refused by its own check`).toBe(true);
      }
    }));
  });

  it('does not build a code out of a one-letter word', () => {
    return suggestAlternatives("Mary's Ville Academy", free).then((offered) => {
      for (const code of offered) expect(code.endsWith('-s')).toBe(false);
    });
  });
});

describe('client and server agree', () => {
  const names = [
    'Magalang CS', 'MAGALANG CS', 'Mabalacat ES', 'Mabalacat Elementary School',
    DAYRIT, 'San Isidro Elementary School', 'Tulongguro', 'Ambitacay ES',
    "Mary's Ville Academy", 'San Nicolas II ES', 'Doña Aurora ES', 'Angeles City NHS',
  ];

  it('derives the same code on both sides', () => {
    for (const name of names) expect(suggestSchoolCode(name)).toBe(suggestSlug(name));
  });

  it('reaches the same verdict on both sides', () => {
    const codes = ['mes-maba', 'mcs-maga', 'mc-maga', 'mcs-maba', 'dcnd-drcl', 'tulo', 'zzz-qqqq'];
    for (const name of names) {
      for (const code of codes) {
        expect(
          schoolCodeMatchProblem(name, code) === null,
          `${name} / ${code}`,
        ).toBe(codeMatchesName(name, code).ok);
      }
    }
  });

  it('refuses a reserved code without waiting for the server', () => {
    // `admin` sits to the left of the code in every address, so a school coded
    // `admin` yields teacher.admin.edu.ph. The client used to show a green tick
    // and let the refusal arrive a round-trip later.
    expect(schoolCodeProblem('admin')).toContain('reserved');
    expect(validateSlug('admin').ok).toBe(false);
  });
});
