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
 * 2. Never reused once a school has been APPROVED on it. Freeing an owned code
 *    would let a later registration inherit an identity — its accounts, its
 *    printed student IDs. A code merely *claimed* by a PENDING or REJECTED
 *    registration is a different matter; see rule 3.
 * 3. Claimed at registration, owned at approval. Several registrations may
 *    carry `sjes-sanj` at once and all of them are allowed to: registration is
 *    the one door anyone can walk up to, so an unreviewed row is a claim by
 *    somebody who has not yet been shown to be a school, and letting it hold a
 *    code lets an invented San Joaquin take one from the real San Jose. At most
 *    one APPROVED school may hold a code, which is a partial unique index —
 *    `... ON "School"("slug") WHERE "status" = 'APPROVED'` — and that index is
 *    what actually enforces it. resolveSlug() and schoolSlugTaken() keep the
 *    common path off it rather than replacing it.
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

/**
 * School-type abbreviations, whose letters are themselves initials.
 *
 * "Magalang CS" is Magalang Central School. Taking one letter per word reads
 * `CS` as a single initial and throws the School away, giving a two-character
 * code — `mc` — for a school whose name plainly offers three. 15,594 of the
 * 83,094 masterlist schools came out with a head of two characters or fewer
 * for exactly this reason: nearly one school in five.
 *
 * Every entry here was taken from the masterlist's own token counts (each
 * appears as a standalone capitalised word at least 15 times), not guessed —
 * ES 16,750, NHS 2,168, PS 1,730, IS 573, CS 454, CES 439, HS 398, BLC 303,
 * MES 171, MS 127, SHS 68, MNHS 68, MHS 31, NCHS 17.
 *
 * Matched case-insensitively on purpose. 3,473 names are stored in full upper
 * case, and keying this on capitalisation would hand those rows a different
 * code from the identical school stored in mixed case.
 */
const TYPE_ABBREVIATIONS = new Set([
  'es', 'ces', 'mes', 'hs', 'nhs', 'shs', 'mhs', 'nchs', 'mnhs',
  'is', 'ps', 'ms', 'cs', 'blc',
]);

/**
 * Capitalised words that are not acronyms and must not be expanded.
 *
 * Roman numerals are the ones that matter: 902 names carry one, and "San
 * Nicolas II ES" would otherwise spend two of its four initials on i, i and
 * push the ES out entirely. `Inc` is a corporate suffix, not part of a school's
 * identity.
 */
const NOT_ACRONYMS = new Set(['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'inc']);

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
    // The possessive is removed before punctuation becomes a separator. Without
    // this, "Mary's Ville Academy" splits into Mary | s | Ville | Academy: the
    // orphaned s becomes an initial in its own right, giving `msva` instead of
    // `mva` and offering `msva-s` as an alternative code. 1,103 masterlist
    // names carry a possessive and 5,547 hold a one-letter word.
    .replace(/['’]s\b/gi, '')
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
  return initialLetters(schoolName).slice(0, 4);
}

/**
 * Every initial the name offers, in order, before any four-character cap.
 *
 *   "Mabalacat Elementary School"  ->  "mes"
 *   "Magalang CS"                  ->  "mcs"   (CS gives c AND s)
 *   "Ambitacay ES"                 ->  "aes"
 *
 * This is the pool a typed code is checked against, which is why it is not
 * truncated: a registrant may legitimately reach past the first four. For "Dr.
 * Clemente N. Dayrit Sr. Memorial High School" the pool is `dcndsmhs`, so
 * `dcnd` (the suggestion), `cndm` (honorific dropped) and `dmhs` (how the
 * school is known locally) are all readable off the name, while `mes` is not.
 *
 * Two ways a word contributes all of its letters rather than just its first: it
 * is a known school type, or it is written in capitals inside a name that is
 * not otherwise shouting — which is how STI, UCCP and AMA are caught without
 * having to be listed. A name in full upper case gives no such signal, since
 * every word in it looks like an acronym, so those fall back to the known set.
 * That is a real limit: "STI COLLEGE - DAGUPAN" yields `scd` where the
 * mixed-case spelling yields `stic`. It costs a handful of private schools
 * written wholly in capitals; the alternative — trusting capitalisation on rows
 * that are entirely capitalised — corrupts every ordinary school stored that
 * way, which is 3,473 of them.
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

/**
 * Whether the first half of a code can be read off the school's initials.
 *
 * In order, but not necessarily contiguously — that is what lets a registrant
 * drop an honorific or reach a suffix, both of which they may reasonably want
 * and neither of which one four-character suggestion can offer at once.
 *
 * Two characters is the floor, not three: "Magalang CS" offers only `mcs`, so
 * `mc` — what the old derivation produced, and what such a school may already
 * have on its letterhead — has to stay legal. 817 masterlist schools still
 * yield a head that short even after abbreviations are expanded.
 *
 * There is deliberately no ceiling. Four is what the *suggestion* is truncated
 * to, for the sake of the printed student ID, but it is not a limit on what a
 * name legitimately offers: "Angeles City NHS" reads `acnhs`, and refusing that
 * would reject the most natural code the school has. The pool of letters is its
 * own bound, and MAX_SLUG_LENGTH bounds the code as a whole.
 */
function headMatches(schoolName, head) {
  // A trailing number is stripped here as well as in tailMatches, because a
  // one-word school has no tail to carry it: "Shalom" suggests `shal`, and the
  // numbered fallback for a collision is `shal2`, which is the app's own answer
  // and must not be refused by the app's own check.
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
  // A one-word name has no initials to read, so its code takes letters from the
  // word itself. Mirrors the same fallback in initialsOf().
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

/**
 * Whether the second half of a code is built out of the school's own name.
 *
 * The tail must read as prefixes of consecutive significant words, starting at
 * any one of them. Both halves of that rule were found by running the codes
 * suggestAlternatives() itself produces back through it:
 *
 *   "magacs"  = maga|cs — prefixes of two consecutive words. Testing only for a
 *               prefix of the whole name run together refuses this, and it is
 *               one of the three alternatives Magalang CS is offered. That rule
 *               rejected 25.6% of the app's own suggestions; this one rejects
 *               0.7%, and those are single-letter tails that should never have
 *               been generated in the first place.
 *   "isidro"  = the second word alone, which is what separates San Isidro from
 *               San Jose — so the walk may begin at any word.
 *   "drcl"    = dr|cl, crossing a word boundary, and the suggested code for the
 *               Dayrit school.
 *   "maba"    cannot be read off "Magalang CS" at all, and is refused.
 *
 * A trailing number is allowed, because that is how a collision is settled.
 *
 * Deliberately NOT loosened to any in-order subsequence, which would admit
 * vowel-dropped forms like `mblct` for Mabalacat. Measured over 35,748 pairs of
 * same-head schools, that loosening raises the share able to claim another
 * school's code from 1.49% to 21.24%: "San Simon Integrated School" could then
 * take `ssis-sant`, which belongs to "Santiago Sur Integrated School". That is
 * the confusion this module exists to prevent.
 */
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
 * Whether a code belongs to the school claiming it.
 *
 * This is the check the platform was missing. validateSlug() only ever asked
 * whether a code was well-shaped, and the availability check only whether
 * someone else already held it — so "Magalang CS" could register `mes-maba`,
 * which is Mabalacat Elementary School's identity, and be shown a green tick
 * while doing it. The code is frozen for the life of the school and printed on
 * every student ID it ever issues, so first claim is the only moment to catch
 * this: by approval the addresses exist, and after a rename the stored code is
 * deliberately no longer derivable from the name at all.
 *
 * An absent name or code is not an error here. The registration form checks on
 * every keystroke, and a half-filled form must not go red before the registrant
 * has had a chance to fill it in; shape and presence are validateSlug's job.
 *
 * Returns the sentence to show rather than a boolean, matching validateSlug().
 */
function codeMatchesName(schoolName, code) {
  const name = String(schoolName ?? '').trim();
  const slug = String(code ?? '').trim().toLowerCase();
  if (!name || !slug) return { ok: true, error: null };

  const cut = slug.indexOf('-');
  const head = cut < 0 ? slug : slug.slice(0, cut);
  const tail = cut < 0 ? '' : slug.slice(cut + 1);

  if (!headMatches(name, head)) {
    return {
      ok: false,
      error: `"${head}" is not made from the initials of ${name}. Try ${suggestSlug(name)}.`,
    };
  }
  if (tail && !tailMatches(name, tail)) {
    return {
      ok: false,
      error: `"${tail}" does not come from the name ${name}. Try ${suggestSlug(name)}.`,
    };
  }
  return { ok: true, error: null };
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
      error: 'A school code can use small letters, numbers and single hyphens — like ses-samp.',
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
  // One-letter words are skipped when choosing which word a candidate is built
  // from. "Mary's Ville Academy" and "Emigdio A. Bondoc High School" otherwise
  // offer `msva-s` and `eabh-a`: a tail of a single letter, which identifies
  // nothing and which tailMatches() rightly refuses. 6.7% of masterlist names
  // hold a word this short.
  const words = significantWords(schoolName)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length >= 2);
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
 * ── Why there is still no releaseSlug() ──
 *
 * There is nothing here to release. A code is not held by a row's existence any
 * more, it is held by that row being APPROVED — so a rejected registration has
 * already stopped standing in anyone's way the moment its status changed, and a
 * function to "free" its code would have nothing left to do.
 *
 * What does need doing at that moment is not about the code at all. The
 * registrant's admin row survives a rejection — the platform keeps those rows,
 * because a refusal is often "we couldn't verify you yet" and gets reversed —
 * and it holds an address built on the code,
 * `principal@admin.sjes-sanj.edu.ph`. User.email is unique platform-wide, so
 * that address, not the code, is what would block a real San Jose from creating
 * their own principal. It would surface as an unexplainable "this email already
 * exists" at a different school entirely.
 *
 * So the addresses are what move, and they move at the only moment they have
 * to: when another school is actually approved onto the code. That is
 * releaseSchoolAddresses() in server.js, with reissueParkedAddresses() to put
 * them back if the rejected school is later approved on a code of its own.
 * Doing it at rejection instead would rename the logins of every school that
 * gets refused and then reinstated, for a conflict that mostly never comes.
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
  TYPE_ABBREVIATIONS,
  foldAccents,
  significantWords,
  initialsOf,
  initialLetters,
  headMatches,
  tailMatches,
  codeMatchesName,
  placeOf,
  suggestSlug,
  validateSlug,
  suggestAlternatives,
  resolveSlug,
  studentPrefixFor,
};
