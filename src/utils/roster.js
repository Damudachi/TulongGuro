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
 * Strip commas from a name — the two-column editor no longer needs "Last,
 * First" as a separator (the birthday lives in its own column), and a stray
 * comma in the stored name breaks first-name extraction for the greeting and
 * any downstream split. Collapses the extra space it leaves behind.
 */
export const stripNameCommas = (text) => (text || '').replace(/,/g, ' ').replace(/\s+/g, ' ').trimStart();

/**
 * Turns pasted or extracted text into editor rows.
 *
 * Splits each line on its LAST comma only when a digit follows — so
 * "Dela Cruz, Juan, 03/15/2014" gives up its birthday. Any remaining commas in
 * the name portion are then stripped, since the name column is comma-free.
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
        name: stripNameCommas((looksDated ? line.slice(0, cut) : line)).trim(),
        birthday: looksDated ? line.slice(cut + 1).trim() : '',
      };
    })
    .filter(r => r.name);
}

/** A row the teacher has actually put something in. */
export const isFilledRow = (row) => Boolean(row?.name?.trim());

/**
 * Best-guess first name for a greeting.
 *
 * Rosters are entered last-name-first to match DepEd School Form 1 sorting,
 * so a naive `.split(' ')[0]` on the stored name yields the surname — the
 * dashboard greeted a learner by their family name. Two shapes to handle:
 *
 *   "Dela Cruz, Juan"  → take what follows the last comma → "Juan"
 *   "Dela Cruz Juan"   → no comma; take the trailing word → "Juan"
 *
 * Both collapse to the first token of the tail, which is enough for a "Hello,
 * X!" line. Falls back to the whole string if nothing else works.
 */
export function firstNameFromRoster(fullName) {
  const raw = (fullName || '').trim();
  if (!raw) return '';
  const tail = raw.includes(',')
    ? raw.slice(raw.lastIndexOf(',') + 1).trim()
    : raw.split(/\s+/).pop();
  return (tail || raw).split(/\s+/)[0];
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

/**
 * The rows to send, or `null` when something needs fixing first.
 *
 * A birthday that cannot be parsed is refused rather than dropped: silently
 * ignoring it hands the learner a random password nobody wrote down, and the
 * teacher believes they set one they can work out again.
 */
export function rosterPayload(rows, onProblem) {
  const filled = rows.filter(isFilledRow);
  const bad = unreadableRows(rows);
  if (bad.length) {
    onProblem?.(
      `These birthdays could not be read:\n\n${bad.map(r => `• ${r.name.trim()} — "${r.birthday.trim()}"`).join('\n')}\n\n`
      + 'Use MM/DD/YYYY, for example 03/15/2014 — or leave it blank for a random password.'
    );
    return null;
  }
  return filled.map(r => ({
    name: r.name.trim(),
    // Blank is a real choice, not a mistake: it means "give them a random
    // password". The server takes null for that.
    birthday: r.birthday?.trim() ? r.birthday.trim() : null,
  }));
}
