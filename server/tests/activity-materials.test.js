import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Attachments on an activity, and who gets to see them.
 *
 * Activity Builder has collected "Additional Materials" since the beginning and
 * its own copy said they were "for students and AI grading context" — but only
 * the checker ever read them. No screen in the app rendered one, so a learner
 * set a comprehension task about a passage had no passage: the file sat in
 * storage, named in a column nothing displayed. These cover the rule that fixed
 * it, and the two shapes the column holds while it does.
 *
 * Loaded through createRequire for the same reason route-wiring.test.js does:
 * server.js is CommonJS, and Vitest's module runner would hand back a second copy.
 */

const require = createRequire(import.meta.url);
const {
  parseActivityFiles, studentMaterials, parseFileVisibility, fileNameFromUrl,
} = require('../server.js');

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');

describe('reading the attachments column', () => {
  it('reads the bare-URL array every activity created before visibility existed still holds', () => {
    const legacy = JSON.stringify([
      'https://storage.test/activity-files/1754902334812-Source-Passage.pdf',
      'https://storage.test/activity-files/1754902334999-Diagram.png',
    ]);
    expect(parseActivityFiles(legacy)).toEqual([
      {
        url: 'https://storage.test/activity-files/1754902334812-Source-Passage.pdf',
        name: 'Source-Passage.pdf',
        studentVisible: true,
      },
      {
        url: 'https://storage.test/activity-files/1754902334999-Diagram.png',
        name: 'Diagram.png',
        studentVisible: true,
      },
    ]);
  });

  it('treats a file with no flag as one the class may open', () => {
    // The default has to be *visible*: those files were attached under a panel
    // that said they were for students, and hiding them on upgrade would
    // silently withdraw readings that classes already depend on.
    expect(parseActivityFiles(JSON.stringify(['https://storage.test/a/passage.pdf']))[0].studentVisible).toBe(true);
    expect(parseActivityFiles(JSON.stringify([{ url: 'https://storage.test/a/passage.pdf' }]))[0].studentVisible).toBe(true);
  });

  it('honours the flag once a file carries one', () => {
    const stored = JSON.stringify([
      { url: 'https://storage.test/a/passage.pdf', name: 'Passage.pdf', studentVisible: true },
      { url: 'https://storage.test/a/key.pdf', name: 'Answer Key.pdf', studentVisible: false },
    ]);
    expect(parseActivityFiles(stored).map(f => f.studentVisible)).toEqual([true, false]);
  });

  it('survives every shape that means "nothing attached"', () => {
    for (const empty of [null, undefined, '', 'not json', '{}', '"a string"', '[]']) {
      expect(parseActivityFiles(empty), `${JSON.stringify(empty)}`).toEqual([]);
    }
  });

  it('drops an entry with no URL rather than rendering a dead link', () => {
    const stored = JSON.stringify([null, 42, {}, { name: 'orphan.pdf' }, 'https://storage.test/a/real.pdf']);
    expect(parseActivityFiles(stored).map(f => f.url)).toEqual(['https://storage.test/a/real.pdf']);
  });
});

describe('the name a learner is shown', () => {
  it('strips the upload timestamp safeUploadName puts on the front', () => {
    // Otherwise a Grade 7 pupil is offered "1754902334812-Reading-Passage.pdf".
    expect(fileNameFromUrl('https://storage.test/activity-files/1754902334812-Reading-Passage.pdf'))
      .toBe('Reading-Passage.pdf');
  });

  it('decodes a percent-escaped name and ignores a query string', () => {
    expect(fileNameFromUrl('https://storage.test/a/1754902334812-Banghay%20Aralin.docx?token=abc'))
      .toBe('Banghay Aralin.docx');
  });

  it('prefers the name recorded at upload, which is the one the teacher typed', () => {
    const stored = JSON.stringify([{ url: 'https://storage.test/a/1754902334812-x.pdf', name: 'Week 3 Reading.pdf' }]);
    expect(parseActivityFiles(stored)[0].name).toBe('Week 3 Reading.pdf');
  });

  it('never leaves a file nameless', () => {
    expect(fileNameFromUrl('https://storage.test/a/')).toBe('Attachment');
    expect(fileNameFromUrl('')).toBe('Attachment');
  });
});

describe('what may travel in a student response', () => {
  const activity = {
    additionalFiles: JSON.stringify([
      { url: 'https://storage.test/a/passage.pdf', name: 'Passage.pdf', studentVisible: true },
      { url: 'https://storage.test/a/key.pdf', name: 'Answer Key.pdf', studentVisible: false },
    ]),
  };

  it('hands over only the shared files', () => {
    expect(studentMaterials(activity)).toEqual([
      { url: 'https://storage.test/a/passage.pdf', name: 'Passage.pdf' },
    ]);
  });

  it('carries no flag with it, so nothing about the hidden file is implied', () => {
    expect(Object.keys(studentMaterials(activity)[0]).sort()).toEqual(['name', 'url']);
  });

  it('is empty for an activity with nothing attached', () => {
    expect(studentMaterials({ additionalFiles: null })).toEqual([]);
    expect(studentMaterials(null)).toEqual([]);
  });

  it('keeps the raw column out of both student activity responses', () => {
    // Filtering on screen would not be enough: the URL is a public one, so a
    // marking guide left in the payload is a marking guide the class can open
    // straight out of the network tab.
    const src = read('server', 'server.js');
    const routes = [
      "app.get('/api/student/:studentId/activities'",
      "app.get('/api/student/:studentId/activities/:activityId'",
    ];
    for (const marker of routes) {
      const start = src.indexOf(marker);
      expect(start, `${marker} is no longer registered`).toBeGreaterThan(-1);
      const body = src.slice(start, start + 4000);
      expect(body, `${marker} must strip additionalFiles before responding`)
        .toMatch(/const \{ additionalFiles, \.\.\./);
      expect(body, `${marker} must send the shareable subset`).toMatch(/studentMaterials\(/);
    }
  });
});

describe('the flags that ride alongside an upload', () => {
  it('lines the flags up with the files by position', () => {
    expect(parseFileVisibility(JSON.stringify([true, false, true]), 3)).toEqual([true, false, true]);
  });

  it('defaults a file the client said nothing about to shared', () => {
    // An older client sends no flags at all, and its files were picked under a
    // panel that described them as being for students.
    expect(parseFileVisibility(undefined, 2)).toEqual([true, true]);
    expect(parseFileVisibility('not json', 2)).toEqual([true, true]);
    expect(parseFileVisibility(JSON.stringify([false]), 3)).toEqual([false, true, true]);
  });

  it('never returns more flags than there are files', () => {
    expect(parseFileVisibility(JSON.stringify([true, true, true]), 1)).toEqual([true]);
    expect(parseFileVisibility(JSON.stringify([true]), 0)).toEqual([]);
  });
});

describe('the checker still reads every attachment', () => {
  it('sends hidden files to grading, which is what hiding them is for', () => {
    // A teacher hides an answer key so it can be given to the model without
    // being given to the class. Filtering the grading path by visibility would
    // turn that switch into "delete this file" instead.
    const src = read('server', 'server.js');
    const marker = 'let additionalMaterialParts = [];';
    const start = src.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, start + 900);
    expect(body).toMatch(/parseActivityFiles\(activity\.additionalFiles\)\.map\(f => f\.url\)/);
    expect(body).not.toMatch(/\.filter\(f => f\.studentVisible\)/);
  });
});

describe('the teacher can change attachments after publishing', () => {
  it('accepts uploads on the activity update route', () => {
    // The panel was live in Edit Activity long before this: the request was
    // JSON, so the files were dropped in the browser and the teacher was told
    // the activity saved.
    const src = read('server', 'server.js');
    const start = src.indexOf("app.put('/api/teacher/activities/:activityId'");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, start + 600);
    expect(body).toMatch(/multipart\/form-data/);
    expect(body).toMatch(/upload\.array\('additionalFiles', 10\)/);
  });

  it('sends the edit as a form, not as JSON', () => {
    const src = read('src', 'pages', 'teacher', 'ActivityBuilder.jsx');
    const start = src.indexOf('/api/teacher/activities/${editActivityId}');
    expect(start).toBeGreaterThan(-1);
    const call = src.slice(start - 300, start + 200);
    expect(call).toMatch(/method: 'PUT'/);
    expect(call).not.toMatch(/application\/json/);
  });

  it('leaves the attachments alone when a request does not mention them', () => {
    // "Said nothing" must not read as "remove everything" — any other caller,
    // and any older client, would otherwise wipe an activity's materials on an
    // unrelated deadline edit.
    const src = read('server', 'server.js');
    const start = src.indexOf("app.put('/api/teacher/activities/:activityId'");
    const body = src.slice(start, start + 12000);
    expect(body).toMatch(/if \(req\.body\.materials !== undefined \|\| \(req\.files \|\| \[\]\)\.length\)/);
  });

  it('only keeps back files the activity already holds', () => {
    // The kept list is a record of what was uploaded, not a free-text field:
    // the checker fetches every URL in it on every submission.
    const src = read('server', 'server.js');
    const start = src.indexOf("app.put('/api/teacher/activities/:activityId'");
    const body = src.slice(start, start + 12000);
    expect(body).toMatch(/const known = stored\.get\(url\);/);
    expect(body).toMatch(/if \(!known\) return null;/);
  });
});

describe('the screens that show them', () => {
  it('renders the materials card on both student activity screens', () => {
    for (const page of ['ActivityDetails.jsx', 'SubmitWork.jsx']) {
      const src = read('src', 'pages', 'student', page);
      expect(src, `${page} does not show attachments`).toMatch(/<ActivityMaterials/);
      expect(src, `${page} does not read the server's list`).toMatch(/materials=\{[a-zA-Z]+\.materials\}/);
    }
  });

  it('links each file rather than fetching it into the page', () => {
    // A plain link is what lets a phone offer "open" or "save" for a PDF, and
    // what lets a slow school connection retry without losing the page.
    const src = read('src', 'components', 'ActivityMaterials.jsx');
    expect(src).toMatch(/href=\{file\.url\}/);
    expect(src).toMatch(/rel="noopener noreferrer"/);
  });

  it('shows nothing at all when there is nothing attached', () => {
    const src = read('src', 'components', 'ActivityMaterials.jsx');
    expect(src).toMatch(/if \(!materials\?\.length\) return null;/);
  });
});
