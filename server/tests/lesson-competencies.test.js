import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Learning Competencies, read out of the school's own curriculum guide.
 *
 * A DepEd curriculum document states these per week, in their own column. The
 * extraction used to read straight past them and keep a one-or-two sentence
 * summary, which was then everything the AI knew about what a lesson was for.
 * That is why a hardcoded Grade 6 English competency map existed beside this:
 * it was the only place a specific "evaluate for X, then Y" instruction could
 * come from, and it covered one subject out of every subject a school teaches.
 *
 * Now the column is kept, so every lesson carries its own competencies in
 * whatever subject it belongs to — and the hardcoded list is retired to a
 * read-only name lookup for tags made before the change.
 *
 * These are the rules that has to hold. The text goes verbatim into a grading
 * prompt, so what gets stored is what a pupil is marked against.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const readSource = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');

// server.js opens a database connection and starts listening on import, which
// this suite deliberately avoids. The two helpers are pure, so they are lifted
// out of the source and evaluated on their own.
const source = readSource('server.js');
function lift(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in server.js`);
  // Balance braces from the first one after the signature.
  let i = source.indexOf('{', start), depth = 0, end = -1;
  for (let j = i; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) { end = j + 1; break; }
  }
  return new Function(`${source.slice(start, end)}; return ${name};`)();
}
const normalizeCompetencies = lift('normalizeCompetencies');
const readCompetencies = lift('readCompetencies');

describe('normalizeCompetencies — what gets stored on a lesson', () => {
  it('stores a list as a JSON array', () => {
    const stored = normalizeCompetencies([
      'Identify hyperbole and irony in literary texts',
      'Explain how figures of speech affect tone',
    ]);
    expect(JSON.parse(stored)).toEqual([
      'Identify hyperbole and irony in literary texts',
      'Explain how figures of speech affect tone',
    ]);
  });

  it('stores null when the document listed none', () => {
    // Null and not "[]": "this lesson listed none" and "this lesson predates
    // the column" mean the same thing to grading, and a caller checking
    // truthiness should not have to know the difference.
    expect(normalizeCompetencies([])).toBeNull();
    expect(normalizeCompetencies(null)).toBeNull();
    expect(normalizeCompetencies(undefined)).toBeNull();
    expect(normalizeCompetencies(['', '   '])).toBeNull();
  });

  it('accepts a bare string, which is what a model returns when it forgets the array', () => {
    expect(JSON.parse(normalizeCompetencies('Summarise a literary text')))
      .toEqual(['Summarise a literary text']);
  });

  it('drops blanks and repeats rather than writing them into a prompt', () => {
    const stored = normalizeCompetencies([
      'Summarise a literary text',
      '',
      'summarise a literary text',
      '   ',
      'Sequence at least eight events',
    ]);
    expect(JSON.parse(stored)).toEqual([
      'Summarise a literary text',
      'Sequence at least eight events',
    ]);
  });

  it('collapses runaway whitespace from a table cell', () => {
    // Extracted from a document, so line breaks and padding inside one cell
    // are normal and would otherwise land in the prompt as written.
    expect(JSON.parse(normalizeCompetencies(['Identify   hyperbole\n\n  and irony'])))
      .toEqual(['Identify hyperbole and irony']);
  });

  it('caps a runaway list so it cannot crowd out the rubric', () => {
    const many = Array.from({ length: 40 }, (_, i) => `Competency ${i}`);
    expect(JSON.parse(normalizeCompetencies(many))).toHaveLength(12);
  });

  it('caps a single runaway competency', () => {
    const [only] = JSON.parse(normalizeCompetencies(['x'.repeat(2000)]));
    expect(only).toHaveLength(400);
  });

  it('ignores non-strings rather than stringifying them into the prompt', () => {
    expect(normalizeCompetencies([null, undefined, {}, []])).toBeNull();
  });
});

describe('readCompetencies — what grading gets back', () => {
  it('round-trips what normalizeCompetencies stored', () => {
    const list = ['Infer the author’s purpose', 'Draw a conclusion from the text'];
    expect(readCompetencies(normalizeCompetencies(list))).toEqual(list);
  });

  it('is empty for a lesson that has none', () => {
    expect(readCompetencies(null)).toEqual([]);
    expect(readCompetencies('')).toEqual([]);
  });

  it('never throws on a column it cannot parse', () => {
    // A grading run must not die because one lesson's column is malformed —
    // the lesson still contributes its title and description.
    expect(readCompetencies('not json at all')).toEqual([]);
    expect(readCompetencies('{"not":"an array"}')).toEqual([]);
    expect(readCompetencies('[1, 2, 3]')).toEqual([]);
  });
});

describe('the extraction asks for competencies and does not invent them', () => {
  it('requests the column in the response schema', () => {
    expect(source).toContain('"competencies": ["<one learning competency, verbatim from the document>"');
  });

  it('tells the model not to make them up', () => {
    // An invented competency becomes an invented marking criterion, which is
    // the same class of failure as an invented rubric — and that one is
    // already refused in code two lines below.
    expect(source).toMatch(/do NOT invent any the document does not state/i);
  });

  it('normalises whatever comes back before storing it', () => {
    expect(source).toContain('competencies: normalizeCompetencies(lesson.competencies)');
  });
});

describe('competencies survive every path a lesson takes', () => {
  it('is stored when an admin uploads a school curriculum', () => {
    expect(source).toContain('competencies: l.competencies ?? null,');
  });

  it('is stored when a teacher parses a curriculum onto their own class', () => {
    expect(source).toContain('competencies: lesson.competencies ?? null,');
  });

  it('is carried across when a class accepts the school curriculum', () => {
    // Missing here, a class created through the main flow got lessons whose
    // competencies stayed behind in CurriculumLesson, and its grading fell
    // back to the one-line description with nothing saying so.
    expect(source).toContain('competencies: l.competencies,');
  });

  it('reaches the grading prompt', () => {
    expect(source).toContain('Learning Competencies for this lesson:');
    expect(source).toContain('Do not mark against competencies that are not listed here.');
    // And is actually selected, or the block above always reads as empty.
    expect(source).toContain('defaultRubric: true, competencies: true');
    expect(source).toContain('select: { title: true, description: true, competencies: true }');
  });
});

describe('the retired competency map stays readable', () => {
  it('is still served, so old tags can be named', () => {
    // Deleting it outright would redraw a term's worth of a teacher's tags as
    // raw slugs on the one screen where they can be removed.
    expect(source).toContain("app.get('/api/topics'");
  });

  it('is marked as retired where someone would go looking', () => {
    expect(readSource('depedTopics.js')).toContain('RETIRED AS A PICKER, KEPT AS A READER');
  });
});
