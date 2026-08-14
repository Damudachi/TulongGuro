/**
 * rosterSheet.js — reading a class list out of a spreadsheet.
 *
 * Split out of server.js's extract-students handler because the parsing was
 * the part that kept refusing real rosters, and none of it could be tested
 * while it was tangled up with exceljs and an Express response. Everything
 * here is pure: a grid of strings in, learners out.
 *
 * The grid is what teachers actually upload, which is not a tidy table:
 *
 *   - A DepEd School Form 1 opens with several title rows ("Republic of the
 *     Philippines", "School ID:", "Grade & Section:") before the column
 *     headings. The old parser took the FIRST non-empty row as the header row,
 *     found no "Name" in "Republic of the Philippines", and refused the file —
 *     the "Could not find a Name column" report this module exists to fix.
 *   - The name is usually three columns (Last / First / Middle), not one, and
 *     the surname boundary between them is worth keeping: it is what lets the
 *     dashboard greet a learner by their actual first name.
 *   - MALE and FEMALE appear as rows of their own, splitting the class in two.
 *   - Some exports carry no headings at all, just names down one column.
 *
 * None of that is exotic. It is one form, printed by one department.
 *
 * A birthday is read here too. It was not before: the handler returned names
 * only, so a teacher who had filled in the Date of Birth column watched every
 * learner get a random password anyway. A birthday that cannot be read
 * unambiguously is dropped rather than guessed at, because a misread birthday
 * is an account the child cannot sign in to — and a dropped one is visible,
 * counted in the editor's "N learners have no birthday" banner.
 */

/** How far down to look for the column headings before giving up on them. */
const HEADER_SCAN_ROWS = 30;

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

/** The earliest birth year a primary learner could plausibly have. */
const EARLIEST_BIRTH_YEAR = 1950;

/** Excel counts days from 1899-12-30 (the 1900 leap-year bug is baked in). */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86400000;

const pad2 = (n) => String(n).padStart(2, '0');

/** Headings reduced to bare words, so "M.I." and "Middle Name:" compare alike. */
const normalizeHeader = (text) =>
  String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** A date column that is emphatically not a birth date. */
const NOT_A_BIRTH_DATE = /(place|lugar|address|certificate|cert|order|weight|height|hospital|town|city|province|enrol|enroll|admit|admission|registr|encoded|updated)/;
const BIRTHDAY_WORDS = /(birth|bday|b day|dob|d o b|kaarawan|kapanganakan|silang)/;

/** Whose name it is. A roster carries several people's names; only one is the learner's. */
const NOT_THE_LEARNER = /(parent|guardian|father|mother|ama|ina|magulang|teacher|adviser|principal|school|emergency|contact|remarks|address|nickname|username|user name|file|signature)/;

/** Headings that identify rather than name: "Student No.", "LRN", "Sex". */
const AN_IDENTIFIER = /(^| )(no|nos|number|num|id|lrn|code|rank|count|age|sex|gender|status)( |$)/;

/**
 * What a heading says its column holds, or null when it says nothing useful.
 *
 * Returns 'last' | 'first' | 'middle' | 'full' | 'birthday'. The split roles
 * matter: given a Last Name and a First Name column, the two are rejoined as
 * "Dela Cruz, Juan" rather than "Dela Cruz Juan", and that comma is the only
 * thing in the stored name that marks where the family name ends.
 */
function headerRole(raw) {
  const t = normalizeHeader(raw);
  if (!t) return null;
  if (BIRTHDAY_WORDS.test(t) && !NOT_A_BIRTH_DATE.test(t)) return 'birthday';
  if (NOT_THE_LEARNER.test(t)) return null;
  if (AN_IDENTIFIER.test(t)) return null;

  const namesSomeone = /(name|pangalan|apelyido|learner|pupil|student)/.test(t) || t === 'm i';
  if (!namesSomeone) return null;

  if (/(last|family|surname|sur name|apelyido)/.test(t)) return 'last';
  if (/(first|given|christian)/.test(t)) return 'first';
  if (/(middle|gitna)/.test(t) || t === 'm i') return 'middle';
  return 'full';
}

/**
 * One cell as text.
 *
 * exceljs hands back more than strings: a formula cell is { formula, result },
 * a styled cell is { richText: [...] }, a linked cell is { text, hyperlink },
 * and a date-formatted cell is a JS Date. The old parser ran String() over all
 * of them, so a roster whose names carried any formatting at all became a
 * column of "[object Object]".
 */
function cellToText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return dateToSlashes(value);
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map(p => p?.text ?? '').join('').trim();
    if ('result' in value) return cellToText(value.result);           // formula
    if ('text' in value) return cellToText(value.text);               // hyperlink
    if ('error' in value) return '';
    return '';
  }
  return String(value).trim();
}

/**
 * A Date as MM/DD/YYYY, read in UTC.
 *
 * exceljs materialises a date cell at UTC midnight, so the UTC getters are the
 * ones that return the day the teacher typed. Reading it locally would shift
 * every birthday back a day for anyone west of Greenwich, and a birthday off
 * by one is a password that does not work.
 */
function dateToSlashes(date) {
  if (!(date instanceof Date) || isNaN(date)) return '';
  return `${pad2(date.getUTCMonth() + 1)}/${pad2(date.getUTCDate())}/${date.getUTCFullYear()}`;
}

/** A real calendar date in a range a learner could have been born in. */
function validBirthday(y, m, d) {
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  // 31 February rolls over silently, so compare the parts back.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  if (y < EARLIEST_BIRTH_YEAR || date.getTime() > Date.now()) return null;
  return `${pad2(m)}/${pad2(d)}/${y}`;
}

/**
 * A birthday as MM/DD/YYYY, or '' when the text cannot be read as one.
 *
 * Numeric-only values are read as Excel day serials only when `allowSerial` is
 * set — i.e. only for a column a heading has already called a birth date.
 * Without that, an LRN or an age in a neighbouring column would quietly become
 * somebody's date of birth.
 */
function readBirthday(raw, { allowSerial = false } = {}) {
  if (raw instanceof Date) {
    if (isNaN(raw)) return '';
    return validBirthday(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate()) || '';
  }
  const text = String(raw ?? '').trim();
  if (!text) return '';

  let m;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text))) {          // 2014-03-15
    return validBirthday(+m[1], +m[2], +m[3]) || '';
  }
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text))) {          // 03/15/2014
    return validBirthday(+m[3], +m[1], +m[2]) || '';
  }
  if ((m = /^([a-z]+)\.?\s+(\d{1,2})\s*,?\s+(\d{4})$/i.exec(text))) {      // March 15, 2014
    const month = MONTHS[m[1].toLowerCase()];
    return month ? (validBirthday(+m[3], month, +m[2]) || '') : '';
  }
  if ((m = /^(\d{1,2})[\s-]+([a-z]+)\.?[\s-]+(\d{4})$/i.exec(text))) {     // 15-Mar-2014
    const month = MONTHS[m[2].toLowerCase()];
    return month ? (validBirthday(+m[3], month, +m[1]) || '') : '';
  }
  if (allowSerial && /^\d{4,6}(\.\d+)?$/.test(text)) {                     // 41713
    const date = new Date(EXCEL_EPOCH_MS + Math.floor(Number(text)) * MS_PER_DAY);
    return validBirthday(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()) || '';
  }
  return '';
}

/**
 * Form furniture that sits in the same column as the names but is not a name.
 *
 * Matched on word boundaries, not as substrings: "Malen", "Totaan" and
 * "Regino" are surnames, and a bare /male|total|region/ would have deleted
 * those learners from their own class list.
 */
const FORM_BOILERPLATE = /\b(republic|philippines|department of education|deped|division|district|region|school id|school year|school form|grade and section|grade section|name of school|barangay|municipality|prepared by|certified by|checked by|noted by|signature)\b/;

/**
 * A cell that fills the name column without naming anyone — the MALE/FEMALE
 * dividers a School Form 1 splits a class with, a repeated heading, a totals
 * line. Anchored, so only a cell that is nothing but one of these is dropped.
 */
const NOT_A_PERSON = /^(name|names|student|students|learner|learners|pupil|pupils|n a|na|none|nil|no|number|sex|gender|age|lrn|remarks|blank|tba|male|males|female|females|boy|boys|girl|girls|total|totals|sub total|grand total)$/;

/** Strip a roster's own numbering: "1. Dela Cruz" and "12) Dela Cruz". */
const stripNumbering = (text) => text.replace(/^\s*\d{1,3}\s*[.)\-]\s+/, '').trim();

const cleanName = (raw) => stripNumbering(String(raw ?? '').replace(/\s+/g, ' ').trim());

/**
 * Whether this cell is plausibly a person's name.
 *
 * Used both to skip the MALE/FEMALE divider rows inside a roster and, when a
 * file has no headings at all, to work out which column the names are in.
 */
function looksLikeAName(raw) {
  const t = cleanName(raw);
  if (t.length < 2) return false;
  if (!/[a-z]{2}/i.test(t)) return false;               // needs two letters somewhere
  if (t.includes(':')) return false;                    // "School: Sto. Niño ES" is a form label
  if (t.split(' ').length > 7) return false;            // a heading or a title, not a person
  if (readBirthday(t)) return false;                    // a date is not a name
  const normalized = normalizeHeader(t);
  if (NOT_A_PERSON.test(normalized)) return false;
  if (FORM_BOILERPLATE.test(normalized)) return false;
  return true;
}

/**
 * The row carrying the column headings, chosen by how much it explains rather
 * than by being first. Ties go to the earliest row, which is what a repeated
 * heading on a two-page printout should resolve to.
 */
function findHeaderRow(grid) {
  let best = null;
  const limit = Math.min(grid.length, HEADER_SCAN_ROWS);
  for (let r = 0; r < limit; r++) {
    const roles = (grid[r] || []).map(headerRole);
    const nameCols = roles.filter(role => role && role !== 'birthday').length;
    if (!nameCols) continue;
    const score = nameCols + (roles.includes('birthday') ? 1 : 0);
    if (!best || score > best.score) best = { row: r, roles, score };
  }
  return best;
}

/**
 * The column the names are in when nothing is labelled — whichever holds the
 * most name-shaped values. Needs two to agree before it will claim a column,
 * so a single stray word does not become a one-learner roster.
 */
function findNameColumnByValues(grid) {
  const width = grid.reduce((w, row) => Math.max(w, row.length), 0);
  let best = null;
  for (let c = 0; c < width; c++) {
    const hits = grid.reduce((n, row) => n + (looksLikeAName(row[c]) ? 1 : 0), 0);
    if (hits >= 2 && (!best || hits > best.hits)) best = { column: c, hits };
  }
  return best;
}

/**
 * A birth-date column identified by its contents rather than its heading.
 *
 * Deliberately refuses to choose when two columns both read as dates: a form
 * carrying both a birth date and a date of enrolment gives no way to tell them
 * apart from the values alone, and picking the wrong one hands every learner a
 * password built from the wrong day.
 */
function findBirthdayColumnByValues(grid, startRow, excluded) {
  const width = grid.reduce((w, row) => Math.max(w, row.length), 0);
  const candidates = [];
  for (let c = 0; c < width; c++) {
    if (excluded.has(c)) continue;
    let filled = 0, dates = 0;
    for (let r = startRow; r < grid.length; r++) {
      const text = String(grid[r]?.[c] ?? '').trim();
      if (!text) continue;
      filled++;
      if (readBirthday(text)) dates++;
    }
    if (dates >= 2 && dates / filled >= 0.7) candidates.push(c);
  }
  return candidates.length === 1 ? candidates[0] : -1;
}

/**
 * Rebuild one learner's name from however many columns it was split across.
 *
 * Surname and given names are rejoined with a comma; anything else is joined
 * left to right, which is the order a roster prints them in.
 */
function joinName(parts) {
  const pick = (role) => parts.filter(p => p.role === role).map(p => p.text).filter(Boolean);
  const last = pick('last').join(' ').trim();
  const given = [...pick('first'), ...pick('middle')].join(' ').trim();
  if (last && given) return `${last}, ${given}`.replace(/\s+/g, ' ');
  return parts.map(p => p.text).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Read a sheet — already flattened to a grid of strings — into learners.
 *
 * Returns { students, source, headings }. `students` is empty when the sheet
 * held nothing readable; `headings` is what the sheet did appear to say, so
 * the caller can tell the teacher what it saw instead of only what it wanted.
 */
function extractRoster(grid) {
  const rows = Array.isArray(grid) ? grid.map(r => (Array.isArray(r) ? r : [])) : [];
  const header = findHeaderRow(rows);

  let nameColumns;      // [{ column, role }]
  let birthdayColumn;   // index, or -1
  let firstDataRow;
  let source;

  if (header) {
    nameColumns = header.roles
      .map((role, column) => ({ role, column }))
      .filter(x => x.role && x.role !== 'birthday');
    birthdayColumn = header.roles.findIndex(role => role === 'birthday');
    firstDataRow = header.row + 1;
    source = 'headings';
  } else {
    // No headings anywhere — fall back to the shape of the values themselves,
    // which is what a plain pasted list of names looks like.
    const found = findNameColumnByValues(rows);
    if (!found) {
      return { students: [], source: 'none', headings: headingsSeen(rows) };
    }
    nameColumns = [{ column: found.column, role: 'full' }];
    birthdayColumn = -1;
    firstDataRow = 0;
    source = 'values';
  }

  if (birthdayColumn === -1) {
    const used = new Set(nameColumns.map(c => c.column));
    birthdayColumn = findBirthdayColumnByValues(rows, firstDataRow, used);
  }

  const students = [];
  for (let r = firstDataRow; r < rows.length; r++) {
    const row = rows[r];
    const parts = nameColumns.map(({ column, role }) => ({ role, text: cleanName(row[column]) }));
    const name = joinName(parts);
    if (!name || !looksLikeAName(name)) continue;

    const birthday = birthdayColumn === -1
      ? ''
      : readBirthday(String(row[birthdayColumn] ?? '').trim(), { allowSerial: true });

    students.push({ name, birthday });
  }

  return { students, source, headings: headingsSeen(rows) };
}

/** The first row that has any text in it, as a list of its cells — for error messages. */
function headingsSeen(rows) {
  for (const row of rows.slice(0, HEADER_SCAN_ROWS)) {
    const texts = (row || []).map(c => String(c ?? '').trim()).filter(Boolean);
    if (texts.length) return texts.slice(0, 8);
  }
  return [];
}

module.exports = {
  cellToText,
  dateToSlashes,
  readBirthday,
  headerRole,
  looksLikeAName,
  extractRoster,
  HEADER_SCAN_ROWS,
};
