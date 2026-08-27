/**
 * accountEmails.js — which email address a staff account is allowed to have.
 *
 * A school's console is opened by two kinds of staff account, and until now the
 * only thing separating them was the `role` column. Nothing about the address
 * itself said which one a person was, so an admin creating accounts in bulk had
 * no check on the one field they type by hand: `maam.reyes@gmail.com` created
 * as an admin and `principal@gmail.com` created as a teacher both went through,
 * and the mistake only surfaced later as "why can't I see the admin console".
 *
 * So the domain carries the role — and, since the school-code change, the
 * school as well:
 *
 *   TEACHER -> @teacher.<school-code>.edu.ph
 *   ADMIN   -> @admin.<school-code>.edu.ph
 *
 * ── Why the school is in there ──
 * `User.email` and `User.username` are unique across the whole platform, and
 * these domains are synthetic — see the note below on deliverability — so
 * `irma@teacher.edu.ph` was not one school's Irma, it was the only Irma the
 * platform could ever hold. The second school to hire an Irma was told the
 * address existed and given no way past it. Putting the school's code inside
 * the domain gives every school its own namespace while keeping the identifier
 * a single field, so login never has to ask which school you belong to. See
 * schoolSlug.js for how a code is chosen.
 *
 * ── The legacy domains ──
 * Every account created before school codes existed sits on the two flat
 * domains, and those addresses are the credential people actually sign in with.
 * They therefore stay valid: `accountDomain()` falls back to them for a school
 * with no code yet, and `isSyntheticLoginDomain()` still recognises them. They
 * are not offered to new accounts at a school that has a code. Retiring them is
 * a separate, later step that has to be announced first — dropping them here
 * would sign out every existing teacher and admin on the morning it deployed.
 *
 * ── What this is and is not ──
 * This is *format validation*, not proof that anyone owns the mailbox. There is
 * no SMTP configured on this server and no confirmation link is sent, so a
 * well-formed address that nobody reads still creates an account. What the rule
 * actually buys is that the address a school hands out matches the authority it
 * carries and the school it belongs to, and that a typo is refused at the point
 * of creation rather than discovered at the first failed login.
 *
 * ── Why it lives in its own module ──
 * Four call sites enforce it (public school registration, admin-creates-teacher,
 * admin-creates-admin, teacher-promoted-to-admin) and they must not drift. The
 * frontend keeps a mirror in src/constants/accountEmails.js — this codebase has
 * no build step that could share a module across the client/server boundary,
 * the same constraint that already forces the depedTopics.js / utils/topics.js
 * pair. The client copy is a courtesy that puts the rule in front of the person
 * typing; this copy is the one that decides.
 */

/** The suffix every school-coded login domain ends in. Both roles share it:
 *  the leftmost label is what distinguishes them, so admin moved off the old
 *  `.com` to sit alongside teacher rather than beside it. */
const ACCOUNT_EMAIL_TLD = 'edu.ph';

/** The leftmost label of the domain — the half that carries the role. */
const ROLE_LABEL = {
  TEACHER: 'teacher',
  ADMIN: 'admin',
};

/**
 * The flat domains used before school codes existed.
 *
 * Kept because accounts on them are live credentials, not because they are
 * still issued. Anything reading these should be asking "is this an existing
 * login" and never "is this the domain a new account should get".
 */
const LEGACY_TEACHER_EMAIL_DOMAIN = 'teacher.edu.ph';
const LEGACY_ADMIN_EMAIL_DOMAIN = 'admin.com';

const LEGACY_DOMAIN_BY_ROLE = {
  TEACHER: LEGACY_TEACHER_EMAIL_DOMAIN,
  ADMIN: LEGACY_ADMIN_EMAIL_DOMAIN,
};

/**
 * Deliberately loose. This is not trying to be RFC 5322 — a regex that tries
 * ends up rejecting real addresses — it only rules out the shapes that cannot
 * be an address at all: no `@`, more than one `@`, nothing either side of it,
 * or whitespace anywhere. The domain half is then checked exactly, which is the
 * part that actually matters here.
 */
const LOCAL_PART = /^[^\s@]+$/;

/**
 * Any domain this platform issues logins on, old shape or new.
 *
 * Pattern-matched rather than compared against a list, because the new domains
 * vary per school and the list would be as long as the schools table. The
 * school-code label is checked for shape only — a code that is not a real
 * school still cannot be *created*, it just isn't recognised as a mailbox here,
 * which is exactly what this predicate is asked about.
 */
const SYNTHETIC_LOGIN_DOMAIN = /^(?:admin|teacher)\.[a-z0-9]+(?:-[a-z0-9]+)*\.edu\.ph$/;

/** Trimmed and lowercased. Addresses are stored and compared in this form. */
function normalizeEmail(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

/**
 * The domain a role's accounts must use at one school.
 *
 * `schoolSlug` is the school's code. Null or absent means a school that has not
 * been given one yet, which falls back to the legacy flat domain — that is what
 * lets this ship before the backfill has run, and what keeps an API client that
 * never learned about codes working against an un-migrated school.
 *
 * Returns null for roles with no rule (STUDENT, whose accounts are enrolled
 * from a roster and often have no email at all).
 */
function accountDomain(role, schoolSlug) {
  const label = ROLE_LABEL[role];
  if (!label) return null;
  const slug = String(schoolSlug ?? '').trim().toLowerCase();
  if (!slug) return LEGACY_DOMAIN_BY_ROLE[role] || null;
  return `${label}.${slug}.${ACCOUNT_EMAIL_TLD}`;
}

/** Back-compat alias. Callers that predate school codes pass one argument and
 *  get the legacy domain, which is the answer they were always getting. */
function requiredDomainFor(role, schoolSlug) {
  return accountDomain(role, schoolSlug);
}

/** Whether an address sits on a domain this platform issues logins on — old
 *  flat shape or new per-school shape. Used to keep a login out of the fields
 *  that need a real, deliverable mailbox. */
function isSyntheticLoginDomain(domain) {
  const value = String(domain ?? '').trim().toLowerCase();
  return value === LEGACY_ADMIN_EMAIL_DOMAIN
    || value === LEGACY_TEACHER_EMAIL_DOMAIN
    || SYNTHETIC_LOGIN_DOMAIN.test(value);
}

/**
 * Checks one address against the rule for a role at a school.
 *
 * Returns `{ ok, email, error }` rather than throwing: every caller wants to
 * answer with a 400 carrying the message, and the normalized address is what
 * they go on to write, so handing both back keeps the "validate then normalize
 * then write" sequence from being spelled out four times.
 *
 * A bare local part is *not* accepted, though the split fields in the UI mean
 * one would be easy to complete here. The screens already build the whole
 * address before they send it (buildAccountEmail in the client mirror), so
 * completing it a second time on the server would only widen what the API
 * accepts without any screen needing it — and "principal" reaching this
 * function at all means a caller has lost the domain somewhere, which is worth
 * a 400 rather than a guess. There is a test for it.
 *
 * A role with no rule passes any well-formed address.
 */
function validateAccountEmail(raw, role, schoolSlug) {
  const required = accountDomain(role, schoolSlug);
  const email = normalizeEmail(raw);
  if (!email) {
    return { ok: false, email: '', error: 'An email address is required.' };
  }

  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@') || at === email.length - 1 || !LOCAL_PART.test(email.slice(0, at))) {
    return { ok: false, email, error: `"${raw}" is not a valid email address.` };
  }

  const domain = email.slice(at + 1);
  if (required && domain !== required) {
    const legacy = LEGACY_DOMAIN_BY_ROLE[role];
    // An address on the old flat domain is a special case worth naming. It is
    // not a typo — it is what this school's existing staff all use — so the
    // message says the rule has moved rather than implying they got it wrong.
    const wasLegacy = legacy && domain === legacy && required !== legacy;
    return {
      ok: false,
      email,
      // Names the required form rather than only the rule: someone who has just
      // been refused needs to know what to type, not what was wrong.
      error: wasLegacy
        ? `New ${role === 'TEACHER' ? 'teacher' : 'admin'} accounts at this school are on @${required}, `
          + `not @${domain}. Existing @${domain} logins keep working.`
        : `${role === 'TEACHER' ? 'Teacher' : 'Admin'} accounts at this school must use a @${required} address `
          + `— for example ${role === 'TEACHER' ? 'juan.delacruz' : 'principal'}@${required}. "${email}" is on @${domain}.`,
    };
  }

  return { ok: true, email, error: null };
}

/**
 * Checks the *contact* address a school gives at registration — a different
 * question from the one above, and the reason this function exists separately.
 *
 * The addresses validateAccountEmail() governs are logins. They sit on domains
 * that are synthetic: this server has no SMTP and those domains are not ours,
 * so nothing was ever deliverable to them. That was fine while they were only
 * usernames wearing an email's shape, but it left a school registration with no
 * reachable address on it at all — an operator deciding whether a school was
 * real had nothing to reach out to but a name somebody typed.
 *
 * So a registering school also gives an address that can actually receive mail,
 * and the one rule that matters here is that it is *not* one of the synthetic
 * login domains. Someone copying their new admin login into this field is the
 * obvious mistake, and it would put the field straight back to being decorative.
 *
 * Note the check is now a pattern, not a pair of constants: the login domains
 * vary per school, and `principal@admin.mes-maba.edu.ph` has to be caught here
 * as surely as the old `principal@admin.com` was. Real school addresses on
 * `.edu.ph` are untouched — the pattern requires the `admin.`/`teacher.` label
 * this platform puts in front, which a genuine school domain does not have.
 *
 * Still only format validation — no confirmation link is sent, because there is
 * still no SMTP. What it buys is a channel for a human to use, and one more
 * thing a flood of fake registrations has to manufacture.
 */
function validateContactEmail(raw) {
  const email = normalizeEmail(raw);
  if (!email) {
    return { ok: false, email: '', error: 'A contact email address is required.' };
  }

  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@') || at === email.length - 1 || !LOCAL_PART.test(email.slice(0, at))) {
    return { ok: false, email, error: `"${raw}" is not a valid email address.` };
  }

  const domain = email.slice(at + 1);
  // A domain with no dot cannot be reached from outside this machine —
  // "principal@localhost" and "office@school" are typos, not addresses.
  if (!/^[^\s@.]+(\.[^\s@.]+)+$/.test(domain)) {
    return { ok: false, email, error: `"${raw}" is not a valid email address.` };
  }
  if (isSyntheticLoginDomain(domain)) {
    return {
      ok: false,
      email,
      error: `@${domain} addresses are sign-in names, not mailboxes — nothing can be sent to them. `
        + `Please give a real school email we can reach you on, like your DepEd or school address.`,
    };
  }

  return { ok: true, email, error: null };
}

module.exports = {
  ACCOUNT_EMAIL_TLD,
  LEGACY_TEACHER_EMAIL_DOMAIN,
  LEGACY_ADMIN_EMAIL_DOMAIN,
  // The old names, still exported so callers that only ever meant "the flat
  // admin domain" (the promotion route's already-an-admin-address check) keep
  // reading the way they did.
  TEACHER_EMAIL_DOMAIN: LEGACY_TEACHER_EMAIL_DOMAIN,
  ADMIN_EMAIL_DOMAIN: LEGACY_ADMIN_EMAIL_DOMAIN,
  normalizeEmail,
  accountDomain,
  requiredDomainFor,
  isSyntheticLoginDomain,
  validateAccountEmail,
  validateContactEmail,
};
