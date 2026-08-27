/**
 * schoolSlug.js — the short code that separates one school's accounts from
 * every other school's.
 *
 * ── The bug this exists to close ──
 * `User.username` and `User.email` are unique platform-wide. Staff sign in with
 * an address on a synthetic domain (see accountEmails.js — nothing is
 * deliverable to @teacher.edu.ph, it is a username wearing an email's shape),
 * so `irma@teacher.edu.ph` was not "Irma at her school", it was *the* Irma for
 * the entire country. The second school to want an Irma was told the address
 * already existed, and shown no way past it. One namespace, many tenants.
 *
 * The same bug is already in student IDs, where it is quieter: studentIdIssuer
 * builds them from the school's initials, and its own comment admits that two
 * schools whose initials collide "have to be stepped past" — meaning San Isidro
 * and Sta. Ines share one SI-26-NNNN number line and neither one's sequence
 * means anything. It reads as gaps rather than as an error, which is why it was
 * never reported.
 *
 * ── The fix ──
 * Every school gets a code, and the code goes inside the identifier:
 *
 *   irma@teacher.mes-maba.edu.ph      Mabalacat Elementary School
 *   irma@teacher.mes-mabi.edu.ph      Mabiga Elementary School
 *   principal@admin.mes-maba.edu.ph
 *   MES-MABA-26-0001
 *
 * Both Irmas now exist. Login stays a single field — the tenant is carried by
 * the identifier itself, so nothing has to ask which school you are from, which
 * is what keeps this workable for a teacher on a shared classroom PC and for a
 * Grade 1 pupil copying an ID off the board.
 *
 * ── Why initials *and* four letters of the name ──
 * Initials alone are not enough: most Philippine public elementary schools are
 * named "<Place> Elementary School", which collapses to three letters, so a few
 * hundred codes would have to cover tens of thousands of schools. Adding the
 * first four letters of the name separates the common case — Mabalacat and
 * Mabiga are both MES but differ at the fourth letter.
 *
 * It does not separate schools with genuinely identical names, of which this
 * country has many: there are San Jose Elementary Schools in most provinces and
 * they all reduce to `sjes-san`. A numeric suffix is the fallback for exactly
 * that case and no other, so the ugly form stays rare instead of being the
 * default. suggestAlternatives() offers nicer options first.
 *
 * ── The three rules ──
 * 1. Frozen. Assigned once, never recomputed from School.name. A school that
 *    renames must not have every login and every student ID change under it.
 * 2. Never reused while the school row exists, whatever its status. Freeing a
 *    code would let a later registration inherit an identity — its accounts,
 *    its printed student IDs — and even a refused registration leaves an admin
 *    account holding an address built on the code. See the note further down on
 *    why there is no releaseSlug().
 * 3. Claimed at registration, not at approval. Two schools filling in the form
 *    the same afternoon must not both be told `sjes-san` is free. The unique
 *    constraint on School.slug is what actually enforces this; resolveSlug()
 *    keeps the common path off it rather than replacing it.
 */

/**
 * Codes that would produce a nonsense or misleading domain.
 *
 * `admin` and `teacher` are the dangerous two — they are the role labels that
 * sit to the left of the code, so a school coded `admin` yields
 * `teacher.admin.edu.ph`, which reads as an admin address and is not one. The
 * rest are the usual infrastructure names, reserved so a future mail or web
 * host for the platform cannot be shadowed by a school.
 */
const RESERVED_SLUGS = new Set([
  'admin', 'teacher', 'student', 'staff', 'school', 'schools',
  'www', 'mail', 'email', 'smtp', 'api', 'app', 'auth', 'login', 'register',
  'support', 'help', 'billing', 'system', 'root', 'test', 'demo',
  'tulongguro', 'tg',
]);

/**
 * Words that carry no identity, so they neither contribute an initial nor get
 * to be the "first word". Kept in step with schoolIdPrefix() in server.js,
 * which this replaces as the source of student-ID prefixes.
 */
const FILLER_WORDS = new Set(['of', 'the', 'and', 'de', 'del', 'da', 'las', 'los', 'sa', 'ng', 'para']);

/** How many characters of the name are taken for the second half of the code.
 *  Four separates Mabalacat from Mabiga while keeping `MES-MABA-26-0001` short
 *  enough for a Grade 1 learner to copy off the board. */
const PLACE_LENGTH = 4;

/** Bounds on a code someone types themselves. The upper bound is about the
 *  printed student ID, which carries the code plus `-YY-NNNN` on a slip a small
 *  child transcribes; the lower one rules out a code that identifies nothing. */
const MIN_SLUG_LENGTH = 3;
const MAX_SLUG_LENGTH = 24;

/**
 * Strips accents so "Doña Aurora" and "Dona Aurora" produce the same code.
 *
 * This is not cosmetic. The old schoolIdPrefix() replaced every non-ASCII run
 * with a space *before* splitting into words, so "Doña" became "Do a" — two
 * words, two initials — and every school with an ñ in its name got a corrupted
 * prefix. Ñ is common in Philippine place names (Doña, Niño, Peñaranda), so
 * this is the ordinary case, not an edge one. NFD splits a letter into its base
 * plus a combining mark; dropping the marks leaves the base letter behind.
 */
function foldAccents(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** The words of a school name that carry identity, accent-folded and stripped
 *  of punctuation. Order is preserved — the first one becomes the place part. */
function significantWords(schoolName) {
  return foldAccents(schoolName)
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word && !FILLER_WORDS.has(word.toLowerCase()));
}

/**
 * The initials half of the code: "Mabalacat Elementary School" -> "mes".
 *
 * A one-word name has no initials worth the name, so the first four letters
 * stand in ("Tulongguro" -> "tulo"). Capped at four for the same reason
 * PLACE_LENGTH is four.
 */
function initialsOf(schoolName) {
  const words = significantWords(schoolName);
  if (words.length === 0) return 'tg';
  if (words.length === 1) return words[0].toLowerCase().slice(0, 4);
  return words.map((word) => word[0]).join('').toLowerCase().slice(0, 4);
}

/**
 * The second half of the code: the first four letters of the *name*, with the
 * significant words run together.
 *
 * Taken across the whole name rather than from the first word alone, which is
 * what this did at first. The difference only shows on a first word shorter
 * than four letters — and Philippine school names are full of them: San, Sta,
 * Sto, Our. "San Joaquin Elementary School" gave `sjes-san`, spending a
 * four-character budget on three characters and throwing away the only part of
 * the name that says which San it is. Running the words together spends all
 * four: `sjes-sanj`.
 *
 * Note this does not, on its own, separate San Joaquin from San Jose — both
 * still reduce to `sanj`. Nothing four characters long could; what tells those
 * two apart is the second word, which is what suggestAlternatives offers first.
 */
function placeOf(schoolName) {
  const words = significantWords(schoolName);
  if (words.length === 0) return '';
  return words.join('').toLowerCase().slice(0, PLACE_LENGTH);
}

/**
 * The code a school name suggests, before any check that it is free.
 *
 * When the two halves are the same string there is nothing to join — a
 * one-word school would otherwise get `tulo-tulo`, which repeats itself and
 * lengthens every student ID for no information.
 */
function suggestSlug(schoolName) {
  const initials = initialsOf(schoolName);
  const place = placeOf(schoolName);
  if (!place || place === initials) return initials;
  return `${initials}-${place}`;
}

/**
 * Whether a code is well-formed, ignoring whether anyone already holds it.
 *
 * Lowercase letters, digits and single inner hyphens. The shape matters more
 * than usual here because the code is interpolated into a hostname
 * (`teacher.<slug>.edu.ph`): a leading or trailing hyphen, an empty label or an
 * underscore would produce a domain that is not a domain, and the exact-match
 * comparison in accountEmails.js would then refuse every address the school
 * ever creates without saying why.
 */
function validateSlug(raw) {
  const slug = String(raw ?? '').trim().toLowerCase();
  if (!slug) {
    return { ok: false, slug: '', error: 'A school code is required.' };
  }
  if (slug.length < MIN_SLUG_LENGTH) {
    return { ok: false, slug, error: `A school code needs at least ${MIN_SLUG_LENGTH} characters.` };
  }
  if (slug.length > MAX_SLUG_LENGTH) {
    return { ok: false, slug, error: `A school code can be at most ${MAX_SLUG_LENGTH} characters.` };
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return {
      ok: false,
      slug,
      error: 'A school code can use small letters, numbers and single hyphens — like mes-maba.',
    };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { ok: false, slug, error: `"${slug}" is reserved. Please choose another school code.` };
  }
  return { ok: true, slug, error: null };
}

/**
 * Codes to offer a school whose suggestion is taken, best first.
 *
 * The order is the point. A number is the last resort, not the first offer,
 * because `sjes-san2` tells its holder nothing and cannot be told apart from
 * `sjes-san3` by anyone who has to type it every morning. Ahead of it come two
 * forms that still say something: the whole first word rather than four letters
 * of it, and the second significant word, which for "San Jose" and "San Isidro"
 * is exactly what distinguishes them.
 *
 * `isTaken` is async so the caller can hand in a database lookup; the list is
 * short and short-circuits, so this is a handful of queries at most.
 */
async function suggestAlternatives(schoolName, isTaken, { limit = 3 } = {}) {
  const initials = initialsOf(schoolName);
  const words = significantWords(schoolName).map((word) => word.toLowerCase());
  const candidates = [];

  // The first word in full — "sjes-sanjose" rather than "sjes-san".
  if (words[0] && words[0].length > PLACE_LENGTH) {
    candidates.push(`${initials}-${words[0]}`);
  }
  // The second significant word — what actually separates San Jose from San
  // Isidro, both of which start "san".
  if (words[1]) {
    candidates.push(`${initials}-${words[1].slice(0, 6)}`);
  }
  // First and second word together, for names whose first word is shared by a
  // whole province's worth of schools.
  if (words[0] && words[1]) {
    candidates.push(`${initials}-${words[0].slice(0, PLACE_LENGTH)}${words[1].slice(0, PLACE_LENGTH)}`);
  }

  const offered = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (offered.length >= limit) break;
    const check = validateSlug(candidate);
    if (!check.ok || seen.has(check.slug)) continue;
    seen.add(check.slug);
    if (!(await isTaken(check.slug))) offered.push(check.slug);
  }

  // Numbered fallback, so the list is never empty. Starts at 2 because the
  // school holding the unnumbered code is, in effect, the first one.
  const base = suggestSlug(schoolName);
  for (let n = 2; offered.length < limit && n < 100; n += 1) {
    const candidate = `${base}${n}`;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (!(await isTaken(candidate))) offered.push(candidate);
  }

  return offered;
}

/**
 * Settles on a free code and returns it, without writing anything.
 *
 * `preferred` is what the registrant chose on the form; when it is absent or
 * malformed the derived suggestion stands in, so an API client that never sends
 * the field still gets a sensible code rather than a refusal.
 *
 * This deliberately does not promise the code is *still* free by the time the
 * caller inserts — nothing can, short of holding a lock. The unique constraint
 * on School.slug is the guarantee; this only keeps the common path from hitting
 * it.
 */
async function resolveSlug(schoolName, preferred, isTaken) {
  const chosen = validateSlug(preferred);
  if (chosen.ok && !(await isTaken(chosen.slug))) return chosen.slug;

  const base = validateSlug(suggestSlug(schoolName));
  if (base.ok && !(await isTaken(base.slug))) return base.slug;

  const [alternative] = await suggestAlternatives(schoolName, isTaken, { limit: 1 });
  if (alternative) return alternative;

  // Nothing derived from the name is free — a hundred identically named schools
  // would be needed to reach this. A code nobody has to remember beats a
  // registration that cannot complete.
  return `${base.ok ? base.slug : 'tg'}-${Date.now().toString(36).slice(-4)}`;
}

/**
 * ── Why there is no releaseSlug() ──
 *
 * Rejecting a school looks like the moment to free its code: nothing was issued
 * under it, no teachers, no student IDs. It isn't, for two reasons.
 *
 * The registrant's own admin row survives a rejection — the platform keeps
 * those rows, because a refusal is often "we couldn't verify you yet" and gets
 * reversed — and that row holds an address built on the code,
 * `principal@admin.sjes-jose.edu.ph`. Free the code, let a real San Jose take
 * it, and their principal cannot be created: the address is held by an account
 * at a school that no longer owns the code. The clash would surface as an
 * unexplainable "this email already exists" at a different school entirely,
 * which is the exact failure this whole module exists to remove.
 *
 * And a school that comes back from a rejection would need a second code and a
 * second login for the same person, having already been told the first.
 *
 * Codes are freed by deleting the school outright, which the platform route
 * allows for a PENDING or REJECTED school with no data. The row and its admin
 * account go together there, so nothing is orphaned and the unique constraint
 * releases the code by itself.
 */

/** The student-ID prefix a code produces: `mes-maba` -> `MES-MABA`. Uppercase
 *  because that is how IDs have always been printed and read aloud; the stored
 *  code stays lowercase, since it also has to be a hostname label. */
function studentPrefixFor(slug) {
  return String(slug ?? '').toUpperCase();
}

module.exports = {
  RESERVED_SLUGS,
  MIN_SLUG_LENGTH,
  MAX_SLUG_LENGTH,
  foldAccents,
  significantWords,
  initialsOf,
  placeOf,
  suggestSlug,
  validateSlug,
  suggestAlternatives,
  resolveSlug,
  studentPrefixFor,
};
