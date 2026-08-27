/**
 * How a school's code is derived from its name.
 *
 *   Mabalacat Elementary School  ->  mes-maba
 *   Angeles Elementary School    ->  aes-ange
 *   Doña Aurora Elementary School -> daes-dona
 *
 * The initials of the significant words, then the first four letters of the
 * first word. See server/schoolSlug.js for what the code is for and why it is
 * shaped this way — that copy is the one that decides.
 *
 * ── Why a client copy exists ──
 * The suggestion is a pure function of the school name, so it does not need the
 * server at all, and making it wait for one had two costs. The obvious one is
 * latency: the field sat spinning behind a debounce and a round-trip before it
 * could show a code the browser could have worked out instantly. The other is
 * worse — when the check could not run, no code appeared at all, and the
 * registrant was left looking at a placeholder from a different school with
 * nothing telling them the field was broken rather than empty.
 *
 * So the client derives and displays; the server is asked only the question the
 * client genuinely cannot answer, which is whether the code is already taken.
 *
 * The same client/server mirror as src/constants/accountEmails.js, and for the
 * same reason: there is no build step in this app that could share one module
 * across the boundary. If the two ever disagree the server wins — registration
 * validates the code again on submit.
 */

/** Words that carry no identity, so they neither contribute an initial nor get
 *  to be the "first word". Must match FILLER_WORDS in server/schoolSlug.js. */
const FILLER_WORDS = new Set(['of', 'the', 'and', 'de', 'del', 'da', 'las', 'los', 'sa', 'ng', 'para']);

/** How many characters of the first word are taken. */
const PLACE_LENGTH = 4;

export const MIN_SCHOOL_CODE_LENGTH = 3;
export const MAX_SCHOOL_CODE_LENGTH = 24;

/**
 * Strips accents, so "Doña Aurora" and "Dona Aurora" give the same code.
 *
 * Without this the punctuation strip below turns "Doña" into "Do a" — two
 * words, two initials — and every school with an ñ in its name gets a corrupted
 * code. Ñ is ordinary in Philippine place names, not an edge case.
 */
function foldAccents(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** The words of a school name that carry identity, in order. */
function significantWords(schoolName) {
  return foldAccents(schoolName)
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word && !FILLER_WORDS.has(word.toLowerCase()));
}

/** The code a school name suggests, or '' when there is no name yet. */
export function suggestSchoolCode(schoolName) {
  const words = significantWords(schoolName);
  if (words.length === 0) return '';

  const initials = words.length === 1
    ? words[0].toLowerCase().slice(0, 4)
    : words.map((word) => word[0]).join('').toLowerCase().slice(0, 4);
  const place = words[0].toLowerCase().slice(0, PLACE_LENGTH);

  // Nothing to join when the two halves are the same string — a one-word school
  // would otherwise get `tulo-tulo`, repeating itself and lengthening every
  // student ID for no information.
  return (!place || place === initials) ? initials : `${initials}-${place}`;
}

/**
 * What is wrong with a code, or null if nothing is.
 *
 * Returns the sentence to show rather than a boolean, matching fullNameProblem
 * on the registration form. The shape rules matter because the code is
 * interpolated into a hostname (`teacher.<code>.edu.ph`), so a leading hyphen or
 * an empty label would produce a domain that is not a domain.
 */
export function schoolCodeProblem(value) {
  const code = String(value ?? '').trim().toLowerCase();
  if (!code) return 'A school code is required.';
  if (code.length < MIN_SCHOOL_CODE_LENGTH) {
    return `A school code needs at least ${MIN_SCHOOL_CODE_LENGTH} characters.`;
  }
  if (code.length > MAX_SCHOOL_CODE_LENGTH) {
    return `A school code can be at most ${MAX_SCHOOL_CODE_LENGTH} characters.`;
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(code)) {
    return 'A school code can use small letters, numbers and single hyphens — like mes-maba.';
  }
  return null;
}

/** The student-ID prefix a code produces: `aes-ange` -> `AES-ANGE`. */
export function studentPrefixFor(code) {
  return String(code ?? '').toUpperCase();
}
