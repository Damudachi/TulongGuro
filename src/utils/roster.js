/**
 * Roster parsing shared by the two places a teacher enters learners: creating
 * a section and adding to an existing one.
 *
 * Name and birthday used to arrive as one comma-separated line per learner,
 * split on the last comma. That worked, but it asked a teacher to hold a
 * format in their head while typing forty names, and "Dela Cruz, Juan,
 * 03/15/2014" has two commas doing two different jobs. The editor now has a
 * column each; these helpers survive because pasting a block of lines is still
 * the fastest way to fill it, and a pasted line still has to be read.
 */

/** Mirrors the server's parseBirthday: MM/DD/YYYY or YYYY-MM-DD, real dates only. */
export function isReadableDate(text) {
  let y, m, d;
  let match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);
  if (match) { [, y, m, d] = match; }
  else {
    match = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(text);
    if (match) { [, m, d, y] = match; }
  }
  if (!match) return false;
  y = Number(y); m = Number(m); d = Number(d);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return false;
  return y >= 1950 && date.getTime() <= Date.now();
}

/** The password the pupil will be given: their birthday as MMDDYYYY. */
export function previewPassword(raw) {
  if (!isReadableDate(raw)) return null;
  let y, m, d;
  let match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(raw);
  if (match) { [, y, m, d] = match; } else { [, m, d, y] = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(raw); }
  return `${String(Number(m)).padStart(2, '0')}${String(Number(d)).padStart(2, '0')}${y}`;
}

/**
 * Tidy a typed name, keeping the surname comma.
 *
 * This used to strip every comma, on the reasoning that the two-column editor
 * no longer needs "Last, First" as a separator. It does not need it — but the
 * comma is the only thing in the stored string that says where the surname
 * ends, and removing it made the greeting unfixable: "Dela Cruz Juan Miguel"
 * cannot be told from "Dela Cruz Juan Miguel" with a two-word surname, so
 * firstNameFromRoster fell back to the trailing word and greeted a child by
 * their second given name.
 *
 * So: a comma is optional to type and preserved when typed. At most one is
 * kept — a name has one surname boundary, and a second comma is a typo or a
 * paste artefact. Whitespace is collapsed either way.
 */
export const normalizeRosterName = (text) => {
  const collapsed = (text || '').replace(/\s+/g, ' ').trimStart();
  const first = collapsed.indexOf(',');
  if (first === -1) return collapsed;
  // Keep the first comma, demote any others to spaces.
  const head = collapsed.slice(0, first + 1);
  const tail = collapsed.slice(first + 1).replace(/,/g, ' ').replace(/\s+/g, ' ');
  return `${head}${tail}`;
};

/**
 * Turns pasted or extracted text into editor rows.
 *
 * Splits each line on its LAST comma only when a digit follows — so
 * "Dela Cruz, Juan, 03/15/2014" gives up its birthday. The surname comma in
 * the name portion survives: it is what marks where the family name ends.
 */
export function parseRosterLines(text) {
  return (text || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const cut = line.lastIndexOf(',');
      const looksDated = cut > 0 && /\d/.test(line.slice(cut + 1));
      return {
        name: normalizeRosterName((looksDated ? line.slice(0, cut) : line)).trim(),
        birthday: looksDated ? line.slice(cut + 1).trim() : '',
      };
    })
    .filter(r => r.name);
}

/**
 * Editor rows from an /extract-students response.
 *
 * The server sends `students` as name-and-birthday pairs. `names` is the older
 * shape it also still sends — one line per learner with the birthday after the
 * last comma — and is read here as a fallback so a client and server that are
 * briefly out of step with each other still fill the roster rather than
 * silently dropping every birthday.
 */
export function rowsFromExtraction(data) {
  if (Array.isArray(data?.students)) {
    return data.students
      .map(s => ({
        name: normalizeRosterName(String(s?.name ?? '')).trim(),
        birthday: String(s?.birthday ?? '').trim(),
      }))
      .filter(r => r.name);
  }
  return parseRosterLines((data?.names || []).join('\n'));
}

/** A row the teacher has actually put something in. */
export const isFilledRow = (row) => Boolean(row?.name?.trim());

/**
 * Drops a trailing middle initial from a given-name portion.
 *
 * School Form 1 writes learners as "SURNAME, First Name M.", so the portion
 * after the comma routinely ends in an initial and the dashboard greeted a
 * child as "Cedric James T." A lone letter is not a name anyone is called by.
 *
 * Only trailing tokens go. "Ma. Teresa" abbreviates a first name and has to
 * survive, which it does because the initial is not last. Suffixes are safe by
 * construction — "Jr." and "III" are more than one letter. At least one token
 * is always kept, so a stored name that is nothing but an initial still greets
 * somebody rather than resolving to an empty string.
 */
const stripMiddleInitial = (given) => {
  const words = given.split(' ');
  // A loop, not a single strip: "Juan D. L." carries two maternal initials, and
  // no given name anyone answers to is a single letter.
  while (words.length > 1 && /^[A-Za-z]\.?$/.test(words[words.length - 1])) words.pop();
  return words.join(' ');
};

/**
 * The name to greet a learner by: everything that is not their surname.
 *
 * Rosters are entered last-name-first to match DepEd School Form 1 sorting, so
 * a naive `.split(' ')[0]` yields the family name — the dashboard used to
 * greet children by their surname. The fix for that then took only the FIRST
 * token of the tail, which is wrong the other way for the very common
 * two-given-name shape: a child called "Juan Miguel" was greeted as "Juan"
 * when there was a comma, and as "Miguel" when there was not (the tail fell
 * back to the trailing word). Neither is their name.
 *
 * The whole given-name portion is returned instead:
 *
 *   "Dela Cruz, Juan Miguel" → everything after the comma  → "Juan Miguel"
 *   "Dela Cruz Juan Miguel"  → no comma, so drop one token → "Cruz Juan Miguel"
 *
 * minus a trailing middle initial, which School Form 1 puts there and nobody
 * is greeted by (see stripMiddleInitial).
 *
 * The comma case is exact. The no-comma case cannot be: nothing in the string
 * says whether the surname is one word or two, and this is why
 * normalizeRosterName keeps a typed comma. Dropping exactly one leading token
 * is the conservative guess — it is right for a single-word surname, the
 * common case, and its failure mode is including part of the surname rather
 * than greeting a child by a name that is not theirs.
 *
 * Falls back to the whole string when there is only one word to work with.
 */
export function firstNameFromRoster(fullName) {
  const raw = (fullName || '').trim().replace(/\s+/g, ' ');
  if (!raw) return '';
  if (raw.includes(',')) {
    const tail = raw.slice(raw.indexOf(',') + 1).trim();
    return tail ? stripMiddleInitial(tail) : raw;
  }
  const words = raw.split(' ');
  return words.length > 1 ? stripMiddleInitial(words.slice(1).join(' ')) : raw;
}

/** A roster with nothing in it yet — one empty row to type into. */
export const emptyRoster = () => [{ name: '', birthday: '' }];

/**
 * Keeps exactly one blank row at the end, so there is always somewhere to type
 * without the teacher having to press "Add another learner" for every name.
 * Trailing blanks beyond the first are dropped rather than accumulating.
 */
export const withBlankRow = (rows) => {
  const trimmed = [...rows];
  // Pops down to zero, not to one: stopping at one left an all-blank roster
  // with two empty rows after the append.
  while (
    trimmed.length > 0
    && !isFilledRow(trimmed[trimmed.length - 1])
    && !trimmed[trimmed.length - 1]?.birthday
  ) {
    trimmed.pop();
  }
  return [...trimmed, { name: '', birthday: '' }];
};

/** Rows carrying a birthday that cannot be read — each one is a lockout. */
export const unreadableRows = (rows) =>
  rows.filter(r => isFilledRow(r) && r.birthday?.trim() && !isReadableDate(r.birthday.trim()));

/** Named learners still waiting on a birthday. */
export const rowsMissingBirthday = (rows) =>
  rows.filter(r => isFilledRow(r) && !r.birthday?.trim());

/**
 * The rows to send, or `null` when something needs fixing first.
 *
 * A birthday is required, not optional. Leaving it blank used to mean "give
 * this learner a random six-digit password" — which reads as a convenience and
 * lands as a Grade 3 pupil holding a string nobody can reconstruct, shown once
 * at enrolment and re-issued by the teacher for the rest of the year. The
 * birthday is on the School Form the roster is copied from, and it gives a
 * password the child can be reminded of and the teacher can work out again.
 *
 * An unreadable birthday is refused for the same reason rather than dropped:
 * silently ignoring it hands out that random password while the teacher
 * believes they set a memorable one.
 *
 * The server enforces this too — this only saves the round trip and keeps the
 * teacher's place in the roster they are typing.
 */
export function rosterPayload(rows, onProblem) {
  const filled = rows.filter(isFilledRow);
  const missing = rowsMissingBirthday(rows);
  const bad = unreadableRows(rows);

  if (missing.length || bad.length) {
    const sections = [];
    if (missing.length) {
      sections.push(`These learners still need a birthday:\n\n${missing.map(r => `• ${r.name.trim()}`).join('\n')}`);
    }
    if (bad.length) {
      sections.push(`These birthdays could not be read:\n\n${bad.map(r => `• ${r.name.trim()} — "${r.birthday.trim()}"`).join('\n')}`);
    }
    onProblem?.(
      `${sections.join('\n\n')}\n\n`
      + 'The birthday becomes the password the learner signs in with. Use MM/DD/YYYY, for example 03/15/2014.'
    );
    return null;
  }

  return filled.map(r => ({ name: r.name.trim(), birthday: r.birthday.trim() }));
}

/**
 * Fold a string down to what a person searching actually means by it.
 *
 * Lowercased, accents stripped, and punctuation reduced to single spaces. The
 * accents matter here more than they would elsewhere: Filipino rosters carry
 * Peña, Muñoz and Sanchez-Villanueva, and an admin hunting for a child types
 * "pena" because that is what is on their keyboard. Byte-comparing "Peña"
 * against "pena" fails, and the search silently reports a learner who is
 * plainly on the list as not being there.
 *
 * The punctuation fold does the same job for the surname comma: the roster
 * stores "Dela Cruz, Juan Miguel", so a search for "cruz juan" — surname then
 * given name, exactly how it reads on the screen — would otherwise miss.
 */
export function foldForSearch(text) {
  return (text || '')
    .normalize('NFD')                 // split "ñ" into "n" + combining tilde
    .replace(/[\u0300-\u036f]/g, '')   // drop the marks, keep the letters
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Whether one learner answers to what was typed.
 *
 * Every whitespace-separated term has to match somewhere, in any order, so
 * "juan cruz" finds "Dela Cruz, Juan Miguel" and so does "cruz juan". Matching
 * the query as one string would make word order a rule the admin has to guess.
 *
 * The Student ID is searched alongside the name because it is the other thing
 * printed on the row, and it is what a teacher reads off a form when the
 * spelling of a name is the very thing in doubt.
 */
export function matchesRosterQuery(student, query) {
  const terms = foldForSearch(query).split(' ').filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = `${foldForSearch(student?.name)} ${foldForSearch(student?.username)}`;
  return terms.every(term => haystack.includes(term));
}

/**
 * A roster in the order a roster is read: alphabetical, by the stored name.
 *
 * That is surname order without any parsing, because the stored name already
 * starts with the surname — "Dela Cruz, Juan Miguel" — which is the format
 * every roster editor in the app asks for and the reason it asks. Sorting by
 * `username` instead, which is what these lists used to do, ordered them by
 * the sequence their accounts happened to be created in: an admin looking for
 * Sotto in a class of forty had to read all forty.
 *
 * `localeCompare` rather than `<`: it puts "Ñ" after "N" instead of after "Z",
 * treats case as a tiebreak rather than a division, and orders "de la Cruz"
 * next to "Dela Cruz" instead of a block apart. Numeric ordering is on so a
 * roster that has fallen back to Student IDs reads 2 before 10.
 *
 * Returns a new array; the caller's is left alone.
 */
export function sortRosterByName(students) {
  return [...(students || [])].sort((a, b) =>
    String(a?.name || '').localeCompare(String(b?.name || ''), undefined, {
      sensitivity: 'base', numeric: true,
    })
    // Two learners genuinely called the same thing keep a stable order rather
    // than swapping places between renders.
    || String(a?.username || '').localeCompare(String(b?.username || ''), undefined, { numeric: true })
  );
}
