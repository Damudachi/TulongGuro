/**
 * depedMasterlist.js — is the school registering with us a school that exists?
 *
 * Registration is the one door into this system that anybody can walk up to.
 * Everything behind it is invitation-only: admins create teachers, teachers
 * create students, nobody self-registers. So the whole of the abuse surface is
 * this one form, and the only thing it used to cost an attacker to fill our
 * approvals queue with a thousand invented schools was a thousand POSTs.
 *
 * The fix that actually fits the problem is that Philippine schools are not an
 * open set. DepEd publishes the Masterlist of Schools — every public and
 * recognised private school, each with a School ID, its official name, and the
 * region/division/district it sits in. A school that does not appear in it is
 * either brand new, recently renamed, or not real, and those are three
 * different conversations for a human to have. A school that does appear can be
 * checked against what the person typed without asking anyone anything.
 *
 * ── What this does and does not prove ──
 * Matching a School ID proves the *school* exists. It does not prove the person
 * filling in the form belongs to it — they could read a real ID off a public
 * list as easily as we can. That is deliberately somebody else's job: the
 * operator approval gate and the contact email are what address impersonation.
 * This module addresses volume, which is the thing that scales against us.
 *
 * ── Why a bundled file and not an API ──
 * There is no official DepEd lookup API. The masterlist is published as a
 * spreadsheet, so it is imported once by scripts/import-deped-masterlist.js and
 * read from disk here. That means no network call on the registration path, no
 * third-party rate limit, and no outage in someone else's service turning into
 * an outage in ours — at the cost of the file going stale, which is what the
 * NOT_FOUND path with its proof-of-existence upload exists to absorb.
 *
 * ── Degrading without the file ──
 * If the masterlist has not been imported, every lookup returns NO_MASTERLIST
 * rather than NOT_FOUND. The distinction matters: NOT_FOUND is a statement
 * about the school ("we looked, it isn't there"), NO_MASTERLIST is a statement
 * about us ("we couldn't look"). Refusing schools on the strength of the second
 * would be refusing them for our own missing config, so registration stays open
 * and the approvals screen says loudly that nothing was verified.
 *
 * The pure functions here take the masterlist as an argument so they can be
 * tested without the data file; loadMasterlist() is the only part that touches
 * disk.
 */

const fs = require('fs');
const path = require('path');

/** Where the imported masterlist lives. Overridable for tests and for hosts
 *  that mount the data somewhere else. */
const MASTERLIST_PATH = process.env.DEPED_MASTERLIST_PATH
  || path.join(__dirname, 'data', 'deped-schools.json');

/** The four answers a lookup can give. See the header for NOT_FOUND vs NO_MASTERLIST. */
const MATCHED = 'MATCHED';
const NAME_MISMATCH = 'NAME_MISMATCH';
const NOT_FOUND = 'NOT_FOUND';
const NO_MASTERLIST = 'NO_MASTERLIST';

/**
 * How alike the typed name and the official name must be to count as the same
 * school. 0.6 on the token-set Dice coefficient below, the same floor
 * pairLessons() in server.js uses for the same kind of judgement.
 *
 * Set by what real registrations look like rather than by taste. A school
 * typing "Manila Science HS" against an official "Manila Science High School"
 * scores well above it; "San Jose Elementary School" against an official
 * "Rizal Central Elementary School" scores well below. The band between is
 * where a human should look, which is exactly what NAME_MISMATCH routes it to
 * — a mismatch is never an automatic refusal, only a flag on the queue.
 */
const NAME_MATCH_FLOOR = 0.6;

/**
 * School IDs are six digits today, but older records carry five and DepEd has
 * room to grow, so the check is a digit-count band rather than exactly six.
 * Being loose here costs nothing: an ID of the wrong length that is otherwise
 * plausible simply fails the lookup and lands on the NOT_FOUND path.
 */
const SCHOOL_ID_SHAPE = /^\d{5,9}$/;

/**
 * Digits only, so "136353", "136-353" and "ID 136353" are the same ID. Returns
 * null for anything that cannot be one, which is what callers check.
 */
function normalizeSchoolId(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return SCHOOL_ID_SHAPE.test(digits) ? digits : null;
}

/**
 * Abbreviations that appear in Philippine school names often enough that not
 * expanding them would make a correct registration look like a mismatch. A
 * school types the short form on the way in — "Bagong Silang ES" — and the
 * masterlist carries the long one.
 *
 * Expansion is one-directional and applied to both sides, so it does not matter
 * which form each side uses. Deliberately conservative: "IS" for Integrated
 * School is left out because it collides with the English word, and a false
 * expansion is worse than a missed one — a missed one only costs a similarity
 * point or two, while a false one can pull two different schools together.
 */
const ABBREVIATIONS = new Map(Object.entries({
  es: 'elementary school',
  elem: 'elementary',
  ps: 'primary school',
  nhs: 'national high school',
  hs: 'high school',
  shs: 'senior high school',
  jhs: 'junior high school',
  ces: 'central elementary school',
  natl: 'national',
  sci: 'science',
  mem: 'memorial',
  st: 'saint',
  sto: 'santo',
  sta: 'santa',
  elemtry: 'elementary',
}));

/**
 * Words carried by so many school names that their presence says nothing about
 * whether two names are the same one. Left *in* for scoring — dropping them
 * entirely would make "San Jose" and "San Jose" score 1.0 against each other
 * when one is an elementary school and the other a high school, and that
 * distinction is the whole point. They are listed here only so callers that
 * want a name's distinctive part can ask for it.
 */
const GENERIC_TOKENS = new Set([
  'school', 'elementary', 'primary', 'high', 'national', 'central',
  'integrated', 'senior', 'junior', 'memorial', 'annex', 'extension',
  'campus', 'pilot', 'community', 'learning', 'center', 'centre',
]);

/**
 * A school name reduced to the tokens worth comparing: lowercased, stripped of
 * accents and punctuation, abbreviations expanded.
 *
 * Accent folding matters here specifically — "Muñoz" and "Munoz" are the same
 * school written by two keyboards, and a comparison that treated them as
 * different would flag a correct registration for review every time.
 */
function nameTokens(raw) {
  const folded = String(raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // strip combining accents
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')      // punctuation to spaces, not to nothing
    .replace(/\s+/g, ' ')
    .trim();
  if (!folded) return [];
  const out = [];
  for (const token of folded.split(' ')) {
    const expanded = ABBREVIATIONS.get(token);
    if (expanded) out.push(...expanded.split(' '));
    else out.push(token);
  }
  return out;
}

/** The comparable form of a name as a single string — used for exact-match
 *  shortcuts and for spotting near-duplicate registrations. */
function normalizeSchoolName(raw) {
  return nameTokens(raw).join(' ');
}

/**
 * How alike two school names are, 0 to 1.
 *
 * Token-set Dice rather than edit distance: school names differ by whole words
 * far more often than by characters ("Manila Science High School" vs "Manila
 * Science HS Main"), and edit distance punishes a dropped word in proportion to
 * its length rather than to its importance. Sets rather than lists so a
 * repeated word cannot inflate the score.
 */
function nameSimilarity(a, b) {
  const setA = new Set(nameTokens(a));
  const setB = new Set(nameTokens(b));
  if (!setA.size || !setB.size) return 0;
  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared++;
  return (2 * shared) / (setA.size + setB.size);
}

/**
 * The distinctive half of a name — what is left after the words every school
 * has. Used to explain a mismatch to an operator ("you typed Bagong Silang,
 * the record says Bagong Nayon") rather than to decide anything.
 */
function distinctiveTokens(raw) {
  return nameTokens(raw).filter(t => !GENERIC_TOKENS.has(t));
}

/**
 * Look one School ID up and judge the name that came with it.
 *
 * `masterlist` is a Map of normalized id -> record, or null when none is
 * loaded. Returns a verdict plus everything an operator needs to act on it:
 * the official record when there is one, and the similarity score that
 * produced the verdict.
 */
function verifySchool({ schoolId, schoolName }, masterlist) {
  const id = normalizeSchoolId(schoolId);
  if (!id) {
    return { verdict: NOT_FOUND, schoolId: null, official: null, similarity: 0 };
  }
  if (!masterlist) {
    return { verdict: NO_MASTERLIST, schoolId: id, official: null, similarity: 0 };
  }
  const official = masterlist.get(id) || null;
  if (!official) {
    return { verdict: NOT_FOUND, schoolId: id, official: null, similarity: 0 };
  }
  const similarity = nameSimilarity(schoolName, official.name);
  return {
    verdict: similarity >= NAME_MATCH_FLOOR ? MATCHED : NAME_MISMATCH,
    schoolId: id,
    official,
    similarity,
  };
}

/**
 * One line explaining a verdict, in the words an operator needs to act on it.
 *
 * Written at registration and stored, not computed when the queue is read. The
 * masterlist file is replaced whenever DepEd publishes a new one, so a note
 * regenerated months later could describe a different record than the one the
 * decision was actually made against — and an approvals queue whose evidence
 * silently changes underneath it is worse than one with none.
 */
function describeVerification(check, typedName) {
  switch (check.verdict) {
    case MATCHED: {
      const where = [check.official?.division, check.official?.region].filter(Boolean).join(', ');
      return `Matched DepEd School ID ${check.schoolId}${where ? ` — ${where}` : ''}.`;
    }
    case NAME_MISMATCH:
      return `DepEd School ID ${check.schoolId} exists but is registered to "${check.official?.name}", `
        + `not "${typedName}" (${Math.round(check.similarity * 100)}% alike). `
        + `Check this is the same school before approving.`;
    case NOT_FOUND:
      return `DepEd School ID ${check.schoolId || '(none given)'} is not in our copy of the masterlist. `
        + `Verify against the attached document.`;
    case NO_MASTERLIST:
      return `Not checked — no DepEd masterlist is installed on this server. `
        + `Verify this school by hand.`;
    default:
      return '';
  }
}

/**
 * Schools already on the platform whose names are close enough to a new one to
 * be worth a second look before approving.
 *
 * Reported, never enforced. Philippine school names repeat legitimately and
 * often — there is a "San Jose Elementary School" in a great many divisions,
 * and refusing the second one would be refusing a real school because another
 * real school got there first. What a duplicate name actually signals is
 * "check the division before you approve", which is a sentence for an operator,
 * not a 400.
 *
 * The floor is higher than NAME_MATCH_FLOOR because this question is different:
 * there, two names are known to describe one School ID and the only question is
 * how they drifted; here, nothing links the two names at all, so only a close
 * match is informative.
 */
const DUPLICATE_NAME_FLOOR = 0.85;

function nearDuplicateNames(name, existingNames) {
  const seen = [];
  for (const other of existingNames || []) {
    const score = nameSimilarity(name, other);
    if (score >= DUPLICATE_NAME_FLOOR) seen.push({ name: other, similarity: score });
  }
  return seen.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Read the imported masterlist into a Map, once.
 *
 * Cached in module scope because the file is large and never changes while the
 * process is up. A missing file is not an error — see the header on degrading
 * without it — so it is logged once and remembered as "absent" rather than
 * retried on every registration.
 */
let cached;          // Map | null once resolved
let cacheResolved = false;

function loadMasterlist() {
  if (cacheResolved) return cached;
  cacheResolved = true;
  cached = null;
  try {
    if (!fs.existsSync(MASTERLIST_PATH)) {
      console.warn(
        `⚠ DepEd masterlist not found at ${MASTERLIST_PATH} — school registrations ` +
        `cannot be verified automatically. Import it with:\n` +
        `   node scripts/import-deped-masterlist.js <masterlist.xlsx>`
      );
      return cached;
    }
    const parsed = JSON.parse(fs.readFileSync(MASTERLIST_PATH, 'utf8'));
    const rows = Array.isArray(parsed) ? parsed : parsed.schools;
    if (!Array.isArray(rows) || !rows.length) {
      console.warn(`⚠ DepEd masterlist at ${MASTERLIST_PATH} has no school rows.`);
      return cached;
    }
    const map = new Map();
    for (const row of rows) {
      const id = normalizeSchoolId(row.id);
      // A row with an unusable id is skipped rather than aborting the load: a
      // few malformed rows in a 60,000-row government spreadsheet should cost
      // those rows, not the whole file.
      if (id && row.name) map.set(id, row);
    }
    cached = map.size ? map : null;
    if (cached) console.log(`🏫 DepEd masterlist loaded: ${map.size.toLocaleString()} schools`);
    return cached;
  } catch (err) {
    console.warn(`⚠ Could not read DepEd masterlist: ${err.message}`);
    return cached;
  }
}

/** Test seam — lets a suite install a masterlist without writing a file. */
function _setMasterlistForTests(map) {
  cached = map;
  cacheResolved = true;
}

module.exports = {
  MATCHED, NAME_MISMATCH, NOT_FOUND, NO_MASTERLIST,
  NAME_MATCH_FLOOR, DUPLICATE_NAME_FLOOR, MASTERLIST_PATH,
  normalizeSchoolId, normalizeSchoolName, nameTokens, nameSimilarity,
  distinctiveTokens, verifySchool, describeVerification, nearDuplicateNames,
  loadMasterlist, _setMasterlistForTests,
};
