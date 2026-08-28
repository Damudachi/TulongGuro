/**
 * How a school's code is derived from its name, and how one that was typed by
 * hand is checked against it.
 *
 *   Mabalacat Elementary School   ->  mes-maba
 *   Magalang CS                   ->  mcs-maga
 *   Angeles Elementary School     ->  aes-ange
 *   San Joaquin Elementary School ->  sjes-sanj
 *   Doña Aurora Elementary School ->  daes-dona
 *
 * The initials of the significant words, then the first four letters of the
 * name with those words run together. See server/schoolSlug.js for what the
 * code is for and why it is shaped this way — that copy is the one that decides.
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

/** Words that carry no identity, so they contribute neither an initial nor any
 *  letters. Must match FILLER_WORDS in server/schoolSlug.js. */
const FILLER_WORDS = new Set(['of', 'the', 'and', 'de', 'del', 'da', 'las', 'los', 'sa', 'ng', 'para']);

/**
 * School-type abbreviations, whose letters are themselves initials, so
 * "Magalang CS" offers m, c and s rather than only m and c. Must match
 * TYPE_ABBREVIATIONS in server/schoolSlug.js, where the reasoning and the
 * masterlist counts behind each entry are set out.
 */
const TYPE_ABBREVIATIONS = new Set([
  'es', 'ces', 'mes', 'hs', 'nhs', 'shs', 'mhs', 'nchs', 'mnhs',
  'is', 'ps', 'ms', 'cs', 'blc',
]);

/** Capitalised words that are not acronyms and must not be expanded — mostly
 *  roman numerals, which 902 masterlist names carry. Mirrors the server. */
const NOT_ACRONYMS = new Set(['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'inc']);

/** Codes that would produce a nonsense or misleading domain. Mirrors
 *  RESERVED_SLUGS in server/schoolSlug.js — without it the field showed a green
 *  tick on `admin` and the refusal only arrived from the server afterwards. */
const RESERVED_CODES = new Set([
  'admin', 'teacher', 'student', 'staff', 'school', 'schools',
  'www', 'mail', 'email', 'smtp', 'api', 'app', 'auth', 'login', 'register',
  'support', 'help', 'billing', 'system', 'root', 'test', 'demo',
  'tulongguro', 'tg',
]);

/** How many characters of the name are taken for the second half of the code. */
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
    // The possessive goes before punctuation becomes a separator, or "Mary's
    // Ville Academy" splits into Mary | s | Ville | Academy and the orphaned s
    // becomes an initial of its own. Mirrors the server.
    .replace(/['’]s\b/gi, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word && !FILLER_WORDS.has(word.toLowerCase()));
}

/**
 * Every initial the name offers, in order, before any four-character cap.
 * "Magalang CS" -> "mcs"; "Mabalacat Elementary School" -> "mes".
 * See initialLetters() in server/schoolSlug.js.
 */
function initialLetters(schoolName) {
  const name = String(schoolName ?? '');
  const shouty = name === name.toUpperCase();
  return significantWords(name).map((word) => {
    const lower = word.toLowerCase();
    if (NOT_ACRONYMS.has(lower)) return lower[0];
    if (TYPE_ABBREVIATIONS.has(lower)) return lower;
    const looksLikeAcronym = !shouty
      && word.length >= 2 && word.length <= 5
      && /^[A-Za-z]+$/.test(word) && word === word.toUpperCase();
    return looksLikeAcronym ? lower : lower[0];
  }).join('');
}

/** The code a school name suggests, or '' when there is no name yet. */
export function suggestSchoolCode(schoolName) {
  const words = significantWords(schoolName);
  if (words.length === 0) return '';

  const initials = words.length === 1
    ? words[0].toLowerCase().slice(0, 4)
    : initialLetters(schoolName).slice(0, 4);
  // Four letters of the *name*, with the significant words run together — not
  // of the first word alone. The two differ only when the first word is shorter
  // than four letters, which in Philippine school names is common (San, Sta,
  // Sto, Our): "San Joaquin Elementary School" would otherwise spend a
  // four-character budget on `san` and drop the part that says which San it is.
  const place = words.join('').toLowerCase().slice(0, PLACE_LENGTH);

  // Nothing to join when the two halves are the same string — a one-word school
  // would otherwise get `tulo-tulo`, repeating itself and lengthening every
  // student ID for no information.
  return (!place || place === initials) ? initials : `${initials}-${place}`;
}

/** The words of a name as they were read before the possessive was stripped,
 *  so "Kid's Avenue" still yields the word `Kids`. See legacyInitialLetters. */
function legacyWords(schoolName) {
  return foldAccents(schoolName)
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word && !FILLER_WORDS.has(word.toLowerCase()));
}

/**
 * The same letters, read the way the code did before the possessive was
 * stripped: "Mary's Ville Academy" gave M, s, V, A.
 *
 * Accepted as well as the current reading, for two reasons. A registrant may
 * genuinely count the s — it is a capital letter in the name they are looking
 * at. And on the day this ships, a browser still holding the previous script
 * derives `msva-mary`, posts it, and would otherwise be refused by a server
 * that had changed its mind about the school's initials while the form was
 * open: 1,031 masterlist names carry a possessive, and a registration dying at
 * submit is the exact failure this module exists to prevent.
 */
function legacyInitialLetters(schoolName) {
  const name = String(schoolName ?? '');
  const shouty = name === name.toUpperCase();
  return legacyWords(name).map((word) => {
    const lower = word.toLowerCase();
    if (NOT_ACRONYMS.has(lower)) return lower[0];
    if (TYPE_ABBREVIATIONS.has(lower)) return lower;
    const looksLikeAcronym = !shouty
      && word.length >= 2 && word.length <= 5
      && /^[A-Za-z]+$/.test(word) && word === word.toUpperCase();
    return looksLikeAcronym ? lower : lower[0];
  }).join('');
}

/** Whether the first half of a code can be read off the school's initials, in
 *  order. See headMatches() in server/schoolSlug.js. */
function headMatches(schoolName, head) {
  const raw = String(head ?? '').trim().toLowerCase();
  // Same shape as the tail: the trailing number is a collision suffix unless
  // removing it leaves nothing to check, which is the case for a name whose own
  // word is a digit. "Purok 3" reads `p3` and suggests `p3-puro`, and stripping
  // the 3 would leave `p` — the module refusing a code it had just offered.
  const stripped = raw.replace(/\d+$/, '');
  const want = stripped.length >= 2 ? stripped : raw;
  if (want.length < 2) return false;
  const words = significantWords(schoolName);
  if (words.length === 0) return false;
  if (words.length === 1) return words[0].toLowerCase().startsWith(want);

  // Both readings of the name are accepted — see legacyInitialLetters.
  return [initialLetters(schoolName), legacyInitialLetters(schoolName)]
    .some((letters) => {
      let i = 0;
      for (const letter of letters) {
        if (letter === want[i]) i += 1;
        if (i === want.length) return true;
      }
      return false;
    });
}

/** Whether the second half of a code is built out of the school's own name —
 *  prefixes of consecutive words, from any word. See server/schoolSlug.js. */
function tailMatches(schoolName, tail) {
  const whole = String(tail ?? '').trim().toLowerCase();
  // Stripping the collision number would leave nothing at all for a name whose
  // own word is a number — "K of C Council 7377 Pre-School" offers `7377` as a
  // tail — so in that case the digits are the tail rather than a suffix on it.
  const stripped = whole.replace(/\d+$/, '');
  const stem = stripped.length >= 2 ? stripped : whole;
  if (stem.length < 2) return false;

  // Both readings of the name are accepted. placeOf() takes its four letters
  // from the same words, so "Kid's Avenue Learning Center" used to offer `kids`
  // and now offers `kida`: without the older reading, a form opened before this
  // shipped would post a tail the new server no longer recognised. See
  // legacyInitialLetters for the same argument about the head.
  const readings = [significantWords(schoolName), legacyWords(schoolName)]
    .map((list) => list.map((word) => word.toLowerCase()));

  const readable = (words) => {
    const walk = (pos, index) => {
      if (pos === stem.length) return true;
      if (index >= words.length) return false;
      const word = words[index];
      // A one-letter word may be stepped over without consuming anything.
      // Middle initials ("Emigdio A. Bondoc High School") sit between the two
      // words a code is most naturally built from, and suggestAlternatives
      // skips them too — without this, the tail it offers would fail the check
      // it has to pass.
      if (word.length === 1 && walk(pos, index + 1)) return true;
      for (let take = Math.min(word.length, stem.length - pos); take >= 1; take -= 1) {
        if (stem.substr(pos, take) === word.slice(0, take) && walk(pos + take, index + 1)) return true;
      }
      return false;
    };
    return words.some((_, index) => walk(0, index));
  };
  return readings.some(readable);
}

/**
 * What is wrong with a code *for this school*, or null if nothing is.
 *
 * The check the form was missing: shape and availability were both asked, but
 * never whether the code had anything to do with the school. "Magalang CS"
 * could type `mes-maba` — Mabalacat Elementary School's identity — and be shown
 * a green tick. The code is frozen for the life of the school and printed on
 * every student ID it issues, so first claim is the only chance to catch it.
 */
export function schoolCodeMatchProblem(schoolName, value) {
  const name = String(schoolName ?? '').trim();
  const code = String(value ?? '').trim().toLowerCase();
  if (!name || !code) return null;

  const cut = code.indexOf('-');
  const head = cut < 0 ? code : code.slice(0, cut);
  const tail = cut < 0 ? '' : code.slice(cut + 1);
  const suggestion = suggestSchoolCode(name);

  if (!headMatches(name, head)) {
    return `"${head}" is not made from the initials of ${name}. Try ${suggestion}.`;
  }
  if (tail && !tailMatches(name, tail)) {
    return `"${tail}" does not come from the name ${name}. Try ${suggestion}.`;
  }
  return null;
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
    return 'A school code can use small letters, numbers and single hyphens — like ses-samp.';
  }
  // Checked here as well as on the server so `admin` does not earn a green tick
  // in the field and a refusal a round-trip later.
  if (RESERVED_CODES.has(code)) {
    return `"${code}" is reserved. Please choose another school code.`;
  }
  return null;
}

/** The student-ID prefix a code produces: `aes-ange` -> `AES-ANGE`. */
export function studentPrefixFor(code) {
  return String(code ?? '').toUpperCase();
}
