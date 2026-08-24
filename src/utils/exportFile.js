/**
 * exportFile.js — naming a file the browser is about to drop in someone's
 * downloads folder.
 *
 * The gradebook export used to name its own download `grades_<classId>.xlsx`,
 * and classId is a uuid — so every export landed as
 * `grades_3f9c1b2e-7a04-4f11-9c2e-8b1d6f0a2c93.xlsx`. Unreadable, impossible
 * to tell one class from another, and it overrode the perfectly good name the
 * server had already chosen and sent in Content-Disposition.
 *
 * Lives in its own module so it can be unit-tested without pulling a React
 * page in — see server/tests/export-filename.test.js.
 */

/**
 * The filename the server chose, read off a Content-Disposition header.
 *
 * Prefers RFC 5987's `filename*`, which is the form that survives an accent in
 * a class name, and falls back to the plain quoted `filename`. Returns null
 * rather than a guess when the header is missing or unreadable — which is what
 * a cross-origin response that does not expose the header looks like — so the
 * caller knows to build its own name instead of saving something called
 * "download".
 */
export function fileNameFromDisposition(header) {
  if (!header) return null;
  const extended = /filename\*=\s*UTF-8''([^;]+)/i.exec(header);
  if (extended) {
    try {
      const decoded = decodeURIComponent(extended[1].trim());
      if (decoded) return decoded;
    } catch { /* malformed percent-encoding — fall through to the plain form */ }
  }
  const plain = /filename\s*=\s*"([^"]+)"/i.exec(header) || /filename\s*=\s*([^;]+)/i.exec(header);
  const name = plain ? plain[1].trim() : '';
  return name || null;
}

/**
 * One word of a filename: readable, and safe on Windows, macOS and Android.
 *
 * Runs of punctuation and whitespace collapse to a single hyphen rather than
 * one underscore each — that is what turned "English Grade 6 - Newton" into
 * `English_Grade_6___Newton`. Accents are folded rather than dropped, so
 * "Piñas" reads as "Pinas" and not "Pi-as". Mirrors fileNamePart() in
 * server/server.js so a name built here and a name built there look the same.
 */
export function fileNamePart(text, fallback = 'Class') {
  const folded = String(text || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return folded || fallback;
}

/**
 * A readable name for an exported gradebook when the header did not reach us.
 *
 * Deliberately the same shape as the server's — class, scope, term, ISO date —
 * so a teacher's downloads folder does not end up sorted into two different
 * naming schemes depending on whether a header survived the trip. The date is
 * resolved in Manila, because that is the day the teacher pressing the button
 * is living in; a late-evening export must not be filed under tomorrow.
 */
export function gradebookFileName(className, term, format) {
  const termPart = term ? `_Term-${term}` : '';
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  return `${fileNamePart(className)}_Grades${termPart}_${day}.${format === 'csv' ? 'csv' : 'xlsx'}`;
}
