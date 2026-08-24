import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

/**
 * The gradebook table and the file it exports have to be the same record.
 *
 * They were not. On one real class the screen said 62% and the exported sheet
 * said 87% for the same learner, because the two computed different things:
 *
 *   • The table totalled raw points across every activity, so a 10-point drill
 *     counted per point exactly as much as a 100-point performance task —
 *     no DepEd component weighting at all.
 *   • The table counted AI drafts the teacher had never validated; the export
 *     (correctly) left them out.
 *   • The export's cells held percentages while the table's held points, so
 *     even a single activity read as two different numbers: "16.6" on screen
 *     and "83" in the file.
 *   • School.useTransmutation moved the exported grade and nothing on screen.
 *
 * The export was the side that was right about the grade. These tests pin down
 * that the route now hands the screen everything it needs to reach the same
 * answer, that the file's own cells are in the same unit as the screen's, and
 * that the sheet computes rather than merely records — a teacher who edits a
 * score in Excel gets the grade recalculated for them.
 *
 * The client half of the arithmetic is proved separately, in
 * gradebook-parity.test.js, which loads both src/utils/grading.js and
 * server/grading.js and asserts they return the same number. There is no
 * frontend test runner, so that pairing — the server hands over the policy,
 * and both implementations of the policy agree — is the whole chain.
 *
 * Harness notes as in route-wiring.test.js: CommonJS through createRequire, a
 * Prisma proxy swapped in before server.js is required, no database.
 */

const require = createRequire(import.meta.url);

function makePrismaFake() {
  const models = new Map();
  const defaults = {
    findUnique: null, findFirst: null, findMany: [], count: 0,
    create: {}, createMany: { count: 0 }, update: {}, updateMany: { count: 0 },
    delete: {}, deleteMany: { count: 0 },
    aggregate: {}, groupBy: [], upsert: {},
  };
  const makeModel = () => {
    const model = {};
    for (const [method, value] of Object.entries(defaults)) {
      model[method] = vi.fn().mockResolvedValue(value);
    }
    return model;
  };
  const rawQuery = vi.fn().mockResolvedValue([]);
  const fake = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop === 'then') return undefined;
      if (prop === '$transaction') return (a) => (typeof a === 'function' ? a(fake) : Promise.all(a));
      if (prop === '$queryRaw') return rawQuery;
      if (prop.startsWith('$')) return () => Promise.resolve(undefined);
      if (!models.has(prop)) models.set(prop, makeModel());
      return models.get(prop);
    },
  });
  const reset = () => {
    for (const model of models.values()) {
      for (const [method, value] of Object.entries(defaults)) {
        model[method].mockReset().mockResolvedValue(value);
      }
    }
    rawQuery.mockReset().mockResolvedValue([]);
  };
  return { fake, reset };
}

const { fake: prismaFake, reset: resetPrisma } = makePrismaFake();

process.env.AUTH_SECRET = 'gradebook-table-and-export-secret';
process.env.NODE_ENV = 'test';

const TEACHER = 'teacher-gb';
const CLASS_ID = 'class-gb';
const SECTION_ID = 'section-gb';
const SCHOOL_ID = 'school-gb';

// Deliberately NOT in alphabetical order — this is the order the roster came
// back in on the class the bug was reported from.
const STUDENTS = [
  { id: 'stu-teodoro', name: 'Teodoro, Alyssa Bianca K.', username: 'SHU-26-0007' },
  { id: 'stu-santos', name: 'Santos, Mark Lester E.', username: 'SHU-26-0006' },
  { id: 'stu-umali', name: 'Umali, Danielle Patrick G.', username: 'SHU-26-0008' },
  { id: 'stu-zamora', name: 'Zamora, Carlo Rafael D.', username: 'SHU-26-0010' },
  { id: 'stu-villanueva', name: 'Villanueva, Sophia Nicole M.', username: 'SHU-26-0009' },
];

const ALPHABETICAL = [
  'Santos, Mark Lester E.',
  'Teodoro, Alyssa Bianca K.',
  'Umali, Danielle Patrick G.',
  'Villanueva, Sophia Nicole M.',
  'Zamora, Carlo Rafael D.',
];

/**
 * The shape that produced the reported discrepancy: a 10-point Written Work
 * drill next to a 100-point Performance Task essay. Under a flat points total
 * the drill is worth a tenth of the essay; under DO 8 s.2015 with Languages
 * weights (WW 30 / PT 50) the whole Written Work component is worth 30% of the
 * grade however small the drill is.
 */
const ACTIVITIES = [
  {
    id: 'act-drill', title: 'PETA GOLD #9', points: 10, component: 'WW', term: 1,
    createdAt: '2026-06-01T00:00:00Z',
    submissions: [
      { studentId: 'stu-santos', aiScore: null, hitlScore: 100, status: 'GRADED', archivedAt: null, excusedAt: null },
      { studentId: 'stu-teodoro', aiScore: null, hitlScore: 100, status: 'GRADED', archivedAt: null, excusedAt: null },
    ],
  },
  {
    id: 'act-essay', title: 'Badge Activity — Write Your Own Story', points: 100, component: 'PT', term: 1,
    createdAt: '2026-06-08T00:00:00Z',
    submissions: [
      { studentId: 'stu-santos', aiScore: null, hitlScore: 30, status: 'GRADED', archivedAt: null, excusedAt: null },
      // Never validated. It is a draft, and no draft is a grade.
      { studentId: 'stu-teodoro', aiScore: 95, hitlScore: null, status: 'SUBMITTED', archivedAt: null, excusedAt: null },
    ],
  },
];

const classRow = () => ({
  id: CLASS_ID, name: 'English Grade 6 - Newton', subject: 'English', gradeLevel: 'Grade 6',
  schoolYear: '2026-2027', sectionId: SECTION_ID,
  section: {
    id: SECTION_ID, name: 'Grade 6 - Newton', gradeLevel: 'Grade 6', schoolId: SCHOOL_ID,
    students: STUDENTS.map(s => ({ ...s })),
  },
  activities: ACTIVITIES.map(a => ({ ...a, submissions: a.submissions.map(s => ({ ...s })) })),
});

let baseUrl;
let server;
let signToken;
let restoreClient;
let ExcelJS;

beforeAll(async () => {
  restoreClient = require('../db.js').__setClientForTests(prismaFake);
  const { app } = require('../server.js');
  ({ signToken } = require('../auth.js'));
  ExcelJS = require('exceljs');
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}, 60000);

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (restoreClient) restoreClient();
});

/** Wires the fake for one school setting; `user.findUnique` doubles as the session check. */
function setUp({ useTransmutation = false } = {}) {
  resetPrisma();
  prismaFake.user.findUnique.mockResolvedValue({ sessionsValidFrom: null });
  prismaFake.school.findUnique.mockResolvedValue({ passingGrade: 75, useTransmutation });
  prismaFake.gradingPolicy.findUnique.mockResolvedValue(null);   // no override: DepEd defaults
  prismaFake.class.findFirst.mockResolvedValue({ id: CLASS_ID });
  prismaFake.class.findUnique.mockImplementation(({ where }) => (
    where.id === CLASS_ID ? Promise.resolve(classRow()) : Promise.resolve(null)
  ));
  prismaFake.class.findMany.mockResolvedValue([classRow()]);
  prismaFake.activity.findMany.mockResolvedValue(
    ACTIVITIES.map(a => ({ ...a, classId: CLASS_ID, class: classRow(), submissions: a.submissions.map(s => ({ ...s })) }))
  );
}

beforeEach(() => setUp());

const token = () => signToken({ id: TEACHER, role: 'TEACHER', schoolId: SCHOOL_ID });
const get = (path) => fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token()}` } });

const gradebook = () => get(`/api/teacher/${TEACHER}/gradebook?classId=${CLASS_ID}`).then(r => r.json());
const exportCsv = () => get(`/api/teacher/${TEACHER}/gradebook/export?classId=${CLASS_ID}&format=csv`);
const exportXlsx = () => get(`/api/teacher/${TEACHER}/gradebook/export?classId=${CLASS_ID}&format=xlsx`);

/** Reads the exported workbook back, so the assertions are about the file. */
async function loadSheet(res) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  return wb.worksheets[0];
}

/**
 * Split one CSV line into cells.
 *
 * A naive `split(',')` is wrong here, and wrong in a way that reads as a
 * passing test: every learner's name is "Surname, Given names", so the first
 * comma is inside the quoted name and every column index after it is off by
 * one.
 */
function cells(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur); cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** The row whose first cell starts with `prefix`, as a plain array of values. */
function findRow(sheet, prefix) {
  let found = null;
  sheet.eachRow((row) => {
    if (found) return;
    const first = row.getCell(1).value;
    if (typeof first === 'string' && first.startsWith(prefix)) found = row;
  });
  return found;
}

// ───────────────────────────────────────────────────────────────────
// The screen is told what the file knows
// ───────────────────────────────────────────────────────────────────

describe('the gradebook hands the table the policy the export uses', () => {
  it('sends the school\'s component weights, per class', async () => {
    const body = await gradebook();
    // English is a Languages subject: DO 8 s.2015 weighs it 30 / 50 / 20.
    // Without this the table could only guess, and its guess was "no weights
    // at all" — a flat points total.
    expect(body.grading[CLASS_ID].policy).toEqual({ WW: 30, PT: 50, QA: 20 });
  });

  it('sends the transmutation switch, so the table can apply it too', async () => {
    expect((await gradebook()).grading[CLASS_ID].useTransmutation).toBe(false);
    setUp({ useTransmutation: true });
    expect((await gradebook()).grading[CLASS_ID].useTransmutation).toBe(true);
  });

  it('reverts cleanly when an admin turns transmutation back off', async () => {
    // The switch is read live off the school on every request, never cached or
    // snapshotted into the response shape, so turning it off is just the
    // absence of turning it on — there is no second code path to get wrong.
    setUp({ useTransmutation: true });
    expect((await gradebook()).grading[CLASS_ID].useTransmutation).toBe(true);
    setUp({ useTransmutation: false });
    const body = await gradebook();
    expect(body.grading[CLASS_ID].useTransmutation).toBe(false);
    expect(body.grading[CLASS_ID].policy).toEqual({ WW: 30, PT: 50, QA: 20 });
  });

  it('sends the passing grade the table colours against', async () => {
    expect((await gradebook()).grading[CLASS_ID].passingGrade).toBe(75);
  });
});

// ───────────────────────────────────────────────────────────────────
// Alphabetical
// ───────────────────────────────────────────────────────────────────

describe('students are listed alphabetically', () => {
  it('on the screen', async () => {
    const body = await gradebook();
    const names = body.classes.find(c => c.id === CLASS_ID).section.students.map(s => s.name);
    expect(names).toEqual(ALPHABETICAL);
  });

  it('in the exported file', async () => {
    const csv = await (await exportCsv()).text();
    const order = csv.split('\n').filter(l => l.startsWith('"')).map(l => cells(l)[0]);
    expect(order).toEqual(ALPHABETICAL);
  });

  it('in the same order in both, so the two can be read side by side', async () => {
    const body = await gradebook();
    const onScreen = body.classes.find(c => c.id === CLASS_ID).section.students.map(s => s.name);
    const csv = await (await exportCsv()).text();
    const inFile = csv.split('\n').filter(l => l.startsWith('"')).map(l => cells(l)[0]);
    expect(inFile).toEqual(onScreen);
  });
});

// ───────────────────────────────────────────────────────────────────
// Same unit, same grade
// ───────────────────────────────────────────────────────────────────

describe('the exported cells are in the same unit as the table', () => {
  it('holds raw points, not percentages', async () => {
    const csv = await (await exportCsv()).text();
    const santos = cells(csv.split('\n').find(l => l.startsWith('"Santos')));
    // 100% of a 10-point drill is 10 points, and 30% of a 100-point essay is
    // 30. The old export wrote "100" and "30" — the percentages — so the
    // drill's cell disagreed with the table's "10" by a factor of ten.
    expect(santos[1]).toBe('10');
    expect(santos[2]).toBe('30');
  });

  it('says what each mark is out of, so the points can be read', async () => {
    const csv = await (await exportCsv()).text();
    const hps = cells(csv.split('\n').find(l => l.startsWith('Highest Possible Score')));
    expect(hps.slice(1, 3)).toEqual(['10', '100']);
  });

  it('says which component each activity counts toward', async () => {
    const csv = await (await exportCsv()).text();
    const comp = cells(csv.split('\n').find(l => l.startsWith('Component')));
    expect(comp.slice(1, 3)).toEqual(['WW', 'PT']);
  });
});

describe('the exported grade is the DepEd one, and drafts are not in it', () => {
  it('weighs the components rather than totalling points', async () => {
    const csv = await (await exportCsv()).text();
    const santos = cells(csv.split('\n').find(l => l.startsWith('"Santos')));
    // WW 10/10 = 100%, PT 30/100 = 30%. Weighted 30/50 renormalised over 80:
    // (100*30 + 30*50) / 80 = 56.25 -> 56.
    //
    // A flat points total — the old table's arithmetic — would be
    // 40/110 = 36%. The gap between those two numbers is the bug.
    expect(santos[santos.length - 1]).toBe('56%');
  });

  it('leaves an unvalidated AI draft out of the grade entirely', async () => {
    const csv = await (await exportCsv()).text();
    const teodoro = cells(csv.split('\n').find(l => l.startsWith('"Teodoro')));
    // Her essay is an AI draft, so her only grade of record is the 10/10
    // drill. Written Work alone renormalises to the whole grade: 100.
    expect(teodoro[1]).toBe('10');
    expect(teodoro[2]).toBe('');
    expect(teodoro[teodoro.length - 1]).toBe('100%');
    expect(csv).toContain('# INCOMPLETE: 1 submission(s) not yet validated');
  });

  it('transmutes the computed grade when the school says to, and only then', async () => {
    const untransmuted = await (await exportCsv()).text();
    expect(cells(untransmuted.split('\n').find(l => l.startsWith('"Santos'))).pop()).toBe('56%');
    expect(untransmuted).toContain('# Grading basis: Initial Grade');

    setUp({ useTransmutation: true });
    const transmuted = await (await exportCsv()).text();
    expect(transmuted).toContain('# Grading basis: DepEd transmutation table applied');
    // 56.25 is below 60, so it falls on the lower segment: 75 + floor((56.25-60)/4)
    // = 75 - 1 = 74. Still a fail, which is the point — the table floors at 60
    // but does not manufacture a pass out of a 56.
    expect(cells(transmuted.split('\n').find(l => l.startsWith('"Santos'))).pop()).toBe('74%');
  });
});

// ───────────────────────────────────────────────────────────────────
// The workbook computes
// ───────────────────────────────────────────────────────────────────

describe('the exported workbook is a working gradebook, not a printout', () => {
  it('carries the two rows its formulas read', async () => {
    const sheet = await loadSheet(await exportXlsx());
    expect(findRow(sheet, 'Highest Possible Score').getCell(2).value).toBe(10);
    expect(findRow(sheet, 'Highest Possible Score').getCell(3).value).toBe(100);
    expect(findRow(sheet, 'Component').getCell(2).value).toBe('WW');
    expect(findRow(sheet, 'Component').getCell(3).value).toBe('PT');
  });

  it('computes each component percentage with a live formula', async () => {
    const sheet = await loadSheet(await exportXlsx());
    const row = findRow(sheet, 'Santos');
    // Columns: 1 name, 2-3 the two activities, then WW / PT / QA / Initial / Final.
    const ww = row.getCell(4).value;
    expect(ww.formula).toContain('SUMIFS');
    // The denominator counts only the columns this learner actually has a mark
    // in — the ">=0" test — so a blank or an "Excused" is not a zero.
    expect(ww.formula).toContain('">=0"');
    expect(Math.round(ww.result)).toBe(100);
    expect(Math.round(row.getCell(5).value.result)).toBe(30);
  });

  it('weights and renormalises the Initial Grade with a live formula', async () => {
    const sheet = await loadSheet(await exportXlsx());
    const initial = findRow(sheet, 'Santos').getCell(7).value;
    // The weights are baked into the formula from the school's own policy,
    // never hardcoded, so a school that has overridden them gets a sheet that
    // recomputes against theirs.
    expect(initial.formula).toContain('*30');
    expect(initial.formula).toContain('*50');
    // ISNUMBER is the renormalising: a component with nothing in it drops out
    // of both the numerator and the divisor.
    expect(initial.formula).toContain('ISNUMBER');
    expect(initial.result).toBeCloseTo(56.25, 2);
  });

  it('has a Final Grade formula that is a plain round when transmutation is off', async () => {
    const sheet = await loadSheet(await exportXlsx());
    const final = findRow(sheet, 'Santos').getCell(8).value;
    expect(final.formula).toContain('ROUND');
    expect(final.formula).not.toContain('MEDIAN');
    expect(final.result).toBe(56);
  });

  it('writes the DepEd transmutation table as a formula when it is on', async () => {
    setUp({ useTransmutation: true });
    const sheet = await loadSheet(await exportXlsx());
    const final = findRow(sheet, 'Santos').getCell(8).value;
    // The two straight lines of DO 8 s.2015: 1.6 initial points per grade
    // point above 60, 4 below it, floored at 60 and capped at 100.
    expect(final.formula).toContain('1.6');
    expect(final.formula).toContain('MAX(60');
    expect(final.formula).toContain('MIN(100');
    // INT, not FLOOR — Excel's FLOOR disagrees with itself across versions on
    // negative numbers, which is exactly the case below an Initial Grade of 60.
    expect(final.formula).toContain('INT(');
    expect(final.result).toBe(74);
  });

  it('caches the app\'s own answer next to every formula', async () => {
    // Excel recalculates on open, but Google Sheets' importer, a preview pane
    // and a phone's file viewer show the cached value — a formula with no
    // result is a blank cell in all of them, which would make the grade column
    // look empty on the devices a teacher actually checks it on.
    const sheet = await loadSheet(await exportXlsx());
    const row = findRow(sheet, 'Santos');
    for (const col of [4, 5, 7, 8]) {
      expect(row.getCell(col).value).toHaveProperty('result');
    }
  });

  it('averages the class with formulas too', async () => {
    const sheet = await loadSheet(await exportXlsx());
    const avg = findRow(sheet, 'CLASS AVERAGE');
    expect(avg.getCell(2).value.formula).toContain('AVERAGE');
    expect(avg.getCell(8).value.formula).toContain('AVERAGE');
    // Santos 56, Teodoro 100, and nobody else has a mark: (56+100)/2 = 78.
    expect(avg.getCell(8).value.result).toBe(78);
  });

  it('tells the teacher the file is live, because it does not look it', async () => {
    const sheet = await loadSheet(await exportXlsx());
    expect(findRow(sheet, 'This file computes:').getCell(2).value).toContain('recalculate');
    expect(findRow(sheet, 'Weights:').getCell(2).value).toContain('Written Work 30%');
  });

  it('freezes the name column and the headings so far columns stay attributable', async () => {
    const sheet = await loadSheet(await exportXlsx());
    expect(sheet.views[0].state).toBe('frozen');
    expect(sheet.views[0].xSplit).toBe(1);
    expect(sheet.views[0].ySplit).toBeGreaterThan(1);
  });
});

// ───────────────────────────────────────────────────────────────────
// The download
// ───────────────────────────────────────────────────────────────────

describe('the downloaded file is named after the class', () => {
  it('names both formats readably, with the day it was taken', async () => {
    for (const res of [await exportXlsx(), await exportCsv()]) {
      const disposition = res.headers.get('content-disposition');
      expect(disposition).toMatch(/English-Grade-6-Newton_Grades_\d{4}-\d{2}-\d{2}\.(xlsx|csv)/);
      // No `English_Grade_6___Newton` — a run of punctuation is one hyphen.
      expect(disposition).not.toContain('__');
    }
  });

  it('sends the name in the RFC 5987 form as well, so accents survive', async () => {
    const disposition = (await exportXlsx()).headers.get('content-disposition');
    expect(disposition).toContain("filename*=UTF-8''");
  });
});
